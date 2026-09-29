const fs = require('fs');
const path = require('path');

const DATA_ROOT = process.env.FASTBUG_DATA_ROOT || path.resolve(__dirname, '..', '..', 'collector-data');
const CONFIG_PATH = path.join(DATA_ROOT, 'yunxiao.config.json');
const REQUIRED = ['domain', 'edition', 'spaceId', 'workitemTypeId', 'assignedTo'];
let optionsCache = { expiresAt: 0, value: null };

function readConfig() {
  let config = {};
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`无法读取云效配置：${error.message}`);
  }
  const token = process.env.YUNXIAO_TOKEN || '';
  const missing = REQUIRED.filter(key => !String(config[key] || '').trim());
  if (config.edition === 'center' && !String(config.organizationId || '').trim()) missing.push('organizationId');
  if (!token) missing.push('YUNXIAO_TOKEN（环境变量）');
  return { config, token, missing, ready: missing.length === 0 };
}

function status() {
  const { config, missing, ready } = readConfig();
  return {
    ready,
    missing,
    edition: config.edition || null,
    domain: config.domain || null,
    spaceId: config.spaceId || null,
    workitemTypeId: config.workitemTypeId || null,
    assignedTo: config.assignedTo || null
  };
}

function evidenceDescription(draft) {
  const steps = Array.isArray(draft.reproductionSteps) && draft.reproductionSteps.length
    ? draft.reproductionSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')
    : '待补充。';
  return [
    '## 环境',
    `- 设备：${draft.environment.deviceModel}`,
    `- App：${draft.environment.packageName}`,
    `- 触发时间：${draft.environment.triggeredAt}`,
    '', '## 复现步骤', steps,
    '', '## 预期结果', draft.expectedResult || '待确认。',
    '', '## 实际结果', draft.actualResult || '待确认。',
    '', '## 技术证据',
    `- FastBug capture_id：${draft.captureId}`,
    '- 本地证据包包含 replay.mp4、截图、logcat、UI XML 和 manifest。',
    draft.evidenceUpload?.downloadUrl
      ? `- [下载完整证据包（有效至 ${draft.evidenceUpload.expiresAt}）](${draft.evidenceUpload.downloadUrl})`
      : '- 完整证据包将在提交前上传到对象存储。',
    '', '## 人工确认',
    `- 严重程度：${draft.severity || '待确认'}`,
    `- 模块：${draft.module || '待确认'}`,
    `- 指派人/小组：${draft.assignee || '待确认'}`,
    `- 验证者：${draft.verifier || '待确认'}`,
    `- 参与者：${(draft.participants || []).join('、') || '待确认'}`,
    `- 测试说明：${draft.testerNote || '无'}`
  ].join('\n');
}

function apiBase(config) {
  const domain = String(config.domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const orgPrefix = config.edition === 'center' ? `/oapi/v1/projex/organizations/${encodeURIComponent(config.organizationId)}` : '/oapi/v1/projex';
  return { domain, orgPrefix };
}

function collaborators(config, draft) {
  const defaults = config.defaults || {};
  return {
    // Defaults only prefill a new draft. Once the user changes a collaborator
    // in the desktop application, preserve that selection when creating or updating the work item.
    verifierId: draft.verifierId || defaults.verifierId || '',
    participantIds: Array.isArray(draft.participantIds) && draft.participantIds.length
      ? draft.participantIds
      : (defaults.participantIds || [])
  };
}

async function apiGet(config, token, suffix) {
  const { domain, orgPrefix } = apiBase(config);
  const response = await fetch(`https://${domain}${orgPrefix}${suffix}`, { headers: { 'x-yunxiao-token': token, 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.errorMessage || `云效读取失败（HTTP ${response.status}）`);
  return body;
}

async function listProjectOptions() {
  const { config, token, missing } = readConfig();
  const discoveryMissing = missing.filter(item => item !== 'assignedTo');
  if (discoveryMissing.length) throw new Error(`云效配置尚未完成：${discoveryMissing.join('、')}`);
  if (optionsCache.value && optionsCache.expiresAt > Date.now()) return optionsCache.value;
  const [fields, members] = await Promise.all([
    apiGet(config, token, `/projects/${encodeURIComponent(config.spaceId)}/workitemTypes/${encodeURIComponent(config.workitemTypeId)}/fields`),
    apiGet(config, token, `/projects/${encodeURIComponent(config.spaceId)}/members`)
  ]);
  const appField = fields.find(field => field.id === 'a824eb4ad3fa91804c759badd9');
  const assigneeMap = new Map();
  for (const member of members || []) {
    if (!assigneeMap.has(member.userId)) assigneeMap.set(member.userId, { id: member.userId, name: member.userName, roles: [] });
    const person = assigneeMap.get(member.userId);
    if (member.roleName && !person.roles.includes(member.roleName)) person.roles.push(member.roleName);
  }
  const people = [...assigneeMap.values()].map(person => ({ id: person.id, name: person.name, role: person.roles.join(' / ') }));
  const value = {
    applications: (appField?.options || []).map(option => ({ id: option.id, name: option.displayValue || option.value })),
    assignees: people,
    verifiers: people,
    participants: people,
    fixedCollaborators: {
      verifierId: config.defaults?.verifierId || null,
      participantIds: config.defaults?.participantIds || []
    }
  };
  optionsCache = { value, expiresAt: Date.now() + 5 * 60_000 };
  return value;
}

async function createWorkitem(draft) {
  const { config, token, missing, ready } = readConfig();
  const unresolved = missing.filter(item => item !== 'assignedTo' || !draft.assigneeId);
  if (unresolved.length) throw new Error(`云效配置尚未完成：${unresolved.join('、')}`);
  if (!draft.application) throw new Error('请选择云效必填字段“应用”。');
  const fixedCollaborators = collaborators(config, draft);
  if (!['center', 'region'].includes(config.edition)) throw new Error('edition 只能是 center 或 region');
  const domain = String(config.domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const endpoint = config.edition === 'center'
    ? `https://${domain}/oapi/v1/projex/organizations/${encodeURIComponent(config.organizationId)}/workitems`
    : `https://${domain}/oapi/v1/projex/workitems`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-yunxiao-token': token },
    body: JSON.stringify({
      subject: draft.title,
      description: evidenceDescription(draft),
      formatType: 'MARKDOWN',
      spaceId: config.spaceId,
      workitemTypeId: config.workitemTypeId,
      assignedTo: draft.assigneeId || config.assignedTo,
      ...(fixedCollaborators.verifierId ? { verifier: fixedCollaborators.verifierId } : {}),
      ...(fixedCollaborators.participantIds.length ? { participants: fixedCollaborators.participantIds } : {}),
      customFieldValues: {
        priority: config.defaults?.priority,
        seriousLevel: config.defaults?.seriousLevel?.[draft.severity || '一般'] || config.defaults?.seriousLevel?.['一般'],
        'a824eb4ad3fa91804c759badd9': draft.application,
        '57015ed5e33efd1d64fa0b9a68': config.defaults?.classification || '测试执行',
        '6be18667524b04e293c3438796': config.defaults?.sourceEnvironment || '测试环境'
      }
    })
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch (_) { body = { raw }; }
  if (!response.ok || body.success === false) throw new Error(body.errorMessage || body.errorMsg || `云效请求失败（HTTP ${response.status}）`);
  return { endpoint, result: body };
}

function submittedWorkitemId(submission) {
  const result = submission?.yunxiao;
  return result?.id || result?.workitemId || result?.data?.id || null;
}

async function updateWorkitem(draft) {
  const { config, token, missing } = readConfig();
  const unresolved = missing.filter(item => item !== 'assignedTo' || !draft.assigneeId);
  if (unresolved.length) throw new Error(`云效配置尚未完成：${unresolved.join('、')}`);
  if (!draft.application) throw new Error('请选择云效必填字段“应用”。');
  const fixedCollaborators = collaborators(config, draft);
  if (!['center', 'region'].includes(config.edition)) throw new Error('edition 只能是 center 或 region');
  const workitemId = submittedWorkitemId(draft.submission);
  if (!workitemId) throw new Error('本地记录缺少已提交的云效缺陷 ID，无法安全更新。');

  const { domain, orgPrefix } = apiBase(config);
  const endpoint = `https://${domain}${orgPrefix}/workitems/${encodeURIComponent(workitemId)}`;
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-yunxiao-token': token },
    // 更新接口要求把系统字段和自定义字段直接放在请求体中，而不是放在 customFieldValues 中。
    body: JSON.stringify({
      subject: draft.title,
      description: evidenceDescription(draft),
      formatType: 'MARKDOWN',
      assignedTo: draft.assigneeId || config.assignedTo,
      ...(fixedCollaborators.verifierId ? { verifier: fixedCollaborators.verifierId } : {}),
      ...(fixedCollaborators.participantIds.length ? { participants: fixedCollaborators.participantIds } : {}),
      priority: config.defaults?.priority,
      seriousLevel: config.defaults?.seriousLevel?.[draft.severity || '一般'] || config.defaults?.seriousLevel?.['一般'],
      'a824eb4ad3fa91804c759badd9': draft.application,
      '57015ed5e33efd1d64fa0b9a68': config.defaults?.classification || '测试执行',
      '6be18667524b04e293c3438796': config.defaults?.sourceEnvironment || '测试环境'
    })
  });
  const raw = await response.text();
  let body = null;
  if (raw) { try { body = JSON.parse(raw); } catch (_) { body = { raw }; } }
  if (!response.ok || body?.success === false) throw new Error(body?.errorMessage || body?.errorMsg || `云效更新失败（HTTP ${response.status}）`);
  return { endpoint, result: body || { id: workitemId }, workitemId };
}

module.exports = { status, listProjectOptions, createWorkitem, updateWorkitem };
