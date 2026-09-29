#!/usr/bin/env node
/*
 * FastBug POC Collector. Intentionally has no npm dependencies: Node.js + adb
 * are sufficient to prove the USB-triggered evidence chain.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { status: yunxiaoStatus, listProjectOptions, createWorkitem, updateWorkitem } = require('./yunxiao');
const { uploadEvidencePackage } = require('./oss');
const { dashboardHtml } = require('./dashboard');
const execFileAsync = promisify(execFile);

// The desktop application provides this directory so evidence is kept in one predictable location.
const ROOT = process.env.FASTBUG_DATA_ROOT || path.resolve(__dirname, '..', '..', 'collector-data');
const PORT = 52741;
const MAX_LOG_BYTES = 12 * 1024 * 1024;
const REQUIRED_RUNTIME_ENV = ['YUNXIAO_TOKEN', 'FASTBUG_OSS_ENDPOINT', 'FASTBUG_OSS_ACCESS_KEY_ID', 'FASTBUG_OSS_ACCESS_KEY_SECRET'];

function options(argv) {
  const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  return { serial: value('--serial'), packageName: value('--package'), sessionId: value('--session') || crypto.randomUUID(), port: Number(value('--port') || PORT) };
}
function usage() {
  console.log('Usage: node collector/index.js start --serial <adb serial> --package <app package> [--session <id>]');
}
function validateRuntimeEnvironment() {
  const missing = REQUIRED_RUNTIME_ENV.filter(name => !String(process.env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Collector 启动失败：当前进程缺少用户环境变量 ${missing.join('、')}。请使用 collector\\start.ps1 启动，或先将这些变量注入当前终端。`);
  }
}
function safeId(value) {
  if (!/^cap_[a-zA-Z0-9]+$/.test(value || '')) throw new Error('Invalid captureId');
  return value;
}
async function adb(serial, args, { encoding = 'utf8', timeout = 12_000 } = {}) {
  return execFileAsync('adb', ['-s', serial, ...args], { encoding, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
}
async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', c => hash.update(c)).on('end', () => resolve(hash.digest('hex')));
  });
}
async function writeJson(file, value) { await fsp.writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
function iso(ms) { return new Date(ms || Date.now()).toISOString(); }
function safePathPart(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_ .-]+|[_ .-]+$/g, '');
  return cleaned || fallback;
}
function captureDirectoryName(event, deviceModel, packageName) {
  // Local wall time is intentionally used for human navigation; manifest keeps the
  // original epoch and monotonic clocks for evidence correlation.
  const date = new Date(event.triggeredAtWallMs || Date.now());
  const pad = value => String(value).padStart(2, '0');
  const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const shortId = String(event.captureId).replace(/^cap_/, '').slice(0, 6);
  return `${timestamp}_${safePathPart(deviceModel, 'unknown-device')}_${safePathPart(packageName, 'unknown-app')}_cap_${shortId}`;
}

class Collector {
  constructor(config) {
    this.config = config;
    this.logChunks = [];
    this.logBytes = 0;
    this.captures = new Map();
    this.logProcess = null;
    this.deviceModel = 'unknown-device';
    this.reverseTimer = null;
    this.agent = {
      status: 'unchecked',
      sessionId: '',
      message: '尚未校验 FastBug Android Agent'
    };
  }

  async start() {
    await fsp.mkdir(path.join(ROOT, 'captures'), { recursive: true });
    await adb(this.config.serial, ['get-state']);
    try {
      const { stdout } = await adb(this.config.serial, ['shell', 'getprop', 'ro.product.model']);
      this.deviceModel = safePathPart(stdout, 'unknown-device');
    } catch (error) {
      console.warn(`Could not read device model; using fallback in evidence folder name: ${error.message}`);
    }
    await this.ensureReverse();
    // USB reconnects and some device restarts clear adb reverse rules. Reapply the
    // rule periodically so the Agent's localhost callback always reaches this PC.
    this.reverseTimer = setInterval(() => {
      this.ensureReverse().catch(error => console.error(`[adb reverse] ${error.message}`));
    }, 10_000);
    this.startLogcat();
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise(resolve => this.server.listen(this.config.port, '127.0.0.1', resolve));
    await this.configureAgent();
    console.log(`Collector ready on http://127.0.0.1:${this.config.port}`);
    console.log(`Serial: ${this.config.serial}`);
    console.log(`Package: ${this.config.packageName}`);
    console.log(`Device model: ${this.deviceModel}`);
    console.log(`Session ID: ${this.config.sessionId}`);
    console.log('\nConfigure the Agent automatically with:');
    console.log(`adb -s ${this.config.serial} shell am start -n com.fastbug.captureagent/.MainActivity --es collector_url http://127.0.0.1:${this.config.port} --es session_id ${this.config.sessionId}`);
  }

  startLogcat() {
    this.logProcess = spawn('adb', ['-s', this.config.serial, 'logcat', '-v', 'epoch'], { windowsHide: true });
    this.logProcess.stdout.on('data', chunk => {
      this.logChunks.push(chunk);
      this.logBytes += chunk.length;
      while (this.logBytes > MAX_LOG_BYTES && this.logChunks.length > 1) this.logBytes -= this.logChunks.shift().length;
    });
    this.logProcess.stderr.on('data', chunk => console.error(`[logcat] ${chunk.toString().trim()}`));
    this.logProcess.on('exit', code => console.error(`[logcat] exited (${code}); collector remains available but logs will be incomplete.`));
  }
  async ensureReverse() {
    await adb(this.config.serial, ['reverse', `tcp:${this.config.port}`, `tcp:${this.config.port}`], { timeout: 4_000 });
  }
  async configureAgent() {
    const agentPackage = 'com.fastbug.captureagent';
    try {
      const { stdout } = await adb(this.config.serial, ['shell', 'pm', 'path', agentPackage], { timeout: 5_000 });
      if (!stdout.trim().startsWith('package:')) {
        this.agent = {
          status: 'missing',
          sessionId: '',
          message: '设备未安装 FastBug Android Agent（com.fastbug.captureagent）'
        };
        console.warn(this.agent.message);
        return;
      }
      await adb(this.config.serial, [
        'shell', 'am', 'start', '-W', '-n', `${agentPackage}/.MainActivity`,
        '--es', 'collector_url', `http://127.0.0.1:${this.config.port}`,
        '--es', 'session_id', this.config.sessionId
      ], { timeout: 10_000 });
      this.agent = {
        status: 'synced',
        sessionId: this.config.sessionId,
        message: '已启动 FastBug Android Agent，并同步当前 Collector 会话 ID'
      };
      console.log(`${this.agent.message}: ${this.config.sessionId}`);
    } catch (error) {
      this.agent = {
        status: 'sync_failed',
        sessionId: '',
        message: `FastBug Android Agent 配置失败：${error.message}`
      };
      console.warn(this.agent.message);
    }
  }
  currentLogs() { return Buffer.concat(this.logChunks); }

  async handle(req, res) {
    const requestUrl = new URL(req.url, `http://127.0.0.1:${this.config.port}`);
    if (req.method === 'GET' && requestUrl.pathname === '/') return this.html(res, dashboardHtml());
    if (req.method === 'GET' && requestUrl.pathname === '/health') return this.json(res, 200, { ok: true, sessionId: this.config.sessionId });
    if (req.method === 'GET' && requestUrl.pathname === '/v1/connection') return this.connectionStatus(res);
    if (req.method === 'GET' && requestUrl.pathname === '/v1/yunxiao/status') return this.json(res, 200, yunxiaoStatus());
    if (req.method === 'GET' && requestUrl.pathname === '/v1/yunxiao/options') return this.yunxiaoOptions(res);
    if (req.method === 'GET' && requestUrl.pathname === '/v1/captures') return this.json(res, 200, { captures: await this.listCaptures() });
    const evidenceMatch = requestUrl.pathname.match(/^\/evidence\/([^/]+)\/(.+)$/);
    if (evidenceMatch && req.method === 'GET') return this.serveEvidence(req, res, decodeURIComponent(evidenceMatch[1]), decodeURIComponent(evidenceMatch[2]));
    const draftMatch = requestUrl.pathname.match(/^\/v1\/captures\/([^/]+)\/draft$/);
    const captureMatch = requestUrl.pathname.match(/^\/v1\/captures\/([^/]+)$/);
    const openFolderMatch = requestUrl.pathname.match(/^\/v1\/captures\/([^/]+)\/open-folder$/);
    if (openFolderMatch && req.method === 'POST') return this.openCaptureFolder(res, decodeURIComponent(openFolderMatch[1]));
    if (captureMatch && req.method === 'DELETE') return this.deleteUneditedCapture(res, decodeURIComponent(captureMatch[1]));
    if (draftMatch && req.method === 'GET') return this.getDraft(res, decodeURIComponent(draftMatch[1]));
    if (draftMatch && req.method === 'PUT') return this.updateDraft(req, res, decodeURIComponent(draftMatch[1]));
    if (draftMatch && req.method === 'POST' && requestUrl.searchParams.get('action') === 'upload-oss') return this.uploadOss(res, decodeURIComponent(draftMatch[1]));
    if (draftMatch && req.method === 'POST' && requestUrl.searchParams.get('action') === 'submit-yunxiao') return this.submitYunxiao(res, decodeURIComponent(draftMatch[1]));
    if (req.method !== 'POST' || req.url !== '/v1/events') return this.json(res, 404, { error: 'not found' });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (event.sessionId !== this.config.sessionId) throw new Error('Session ID mismatch');
      safeId(event.captureId);
      if (event.type === 'triggered') await this.captureTriggered(event);
      else if (event.type === 'ready') await this.captureReady(event);
      else throw new Error('Unsupported event type');
      this.json(res, 200, { ok: true });
    } catch (error) {
      console.error(`event failed: ${error.stack || error.message}`);
      this.json(res, 400, { ok: false, error: error.message });
    }
  }
  json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
  html(res, body) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }

  captureDirectory(folder) {
    const name = path.basename(String(folder || ''));
    if (name !== folder || !(/^(\d{8}_\d{6}_[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+_cap_[a-zA-Z0-9]+|cap_[a-zA-Z0-9]+)$/).test(name)) throw new Error('Invalid evidence directory');
    return path.join(ROOT, 'captures', name);
  }
  async listCaptures() {
    const base = path.join(ROOT, 'captures');
    const entries = await fsp.readdir(base, { withFileTypes: true });
    const captures = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      try {
        let manifest;
        try { manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest', 'manifest.json'), 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const trigger = JSON.parse(await fsp.readFile(path.join(dir, 'manifest', 'trigger.json'), 'utf8'));
          let progress = { stage: 'collecting', label: '正在采集现场证据' };
          try { progress = JSON.parse(await fsp.readFile(path.join(dir, 'manifest', 'progress.json'), 'utf8')); } catch (_) {}
          captures.push({ directory: entry.name, captureId: trigger.captureId, triggeredAt: trigger.triggeredAtWallMs, status: 'in_progress', draftStatus: 'in_progress', title: '正在捕获现场证据', progress });
          continue;
        }
        let draft = null;
        try { draft = JSON.parse(await fsp.readFile(path.join(dir, 'draft', 'draft.json'), 'utf8')); }
        catch (_) {
          // Make earlier POC captures editable too; they already contain immutable evidence.
          await this.writeLocalDraft({ dir, event: manifest.trigger, artifacts: manifest.artifacts || {} }, manifest.ready);
          draft = JSON.parse(await fsp.readFile(path.join(dir, 'draft', 'draft.json'), 'utf8'));
        }
        captures.push({
          directory: entry.name,
          captureId: manifest.captureId,
          triggeredAt: manifest.trigger?.triggeredAtWallMs,
          status: manifest.status,
          draftStatus: draft?.status || 'not_ready',
        yunxiaoStatus: draft?.submission?.state || 'not_submitted',
          title: draft?.title || '草稿尚未生成',
          progress: { stage: 'complete', label: '证据已就绪' }
        });
      } catch (_) { /* An in-progress capture has no manifest yet. */ }
    }
    return captures.sort((a, b) => (b.triggeredAt || 0) - (a.triggeredAt || 0));
  }
  async getDraft(res, folder) {
    try {
      const draft = JSON.parse(await fsp.readFile(path.join(this.captureDirectory(folder), 'draft', 'draft.json'), 'utf8'));
      this.json(res, 200, draft);
    } catch (error) { this.json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
  }
  async updateDraft(req, res, folder) {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const update = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const dir = this.captureDirectory(folder);
      const draftFile = path.join(dir, 'draft', 'draft.json');
      const draft = JSON.parse(await fsp.readFile(draftFile, 'utf8'));
      for (const field of ['title', 'reproductionSteps', 'expectedResult', 'actualResult', 'severity', 'module', 'assignee', 'assigneeId', 'application', 'verifier', 'verifierId', 'participants', 'participantIds', 'testerNote']) {
        if (Object.prototype.hasOwnProperty.call(update, field)) draft[field] = update[field];
      }
      draft.status = 'confirmed_locally';
      draft.lastEditedAt = iso();
      await Promise.all([writeJson(draftFile, draft), fsp.writeFile(path.join(dir, 'draft', 'draft.md'), draftMarkdown(draft), 'utf8')]);
      this.json(res, 200, { ok: true, draft });
    } catch (error) { this.json(res, 400, { ok: false, error: error.message }); }
  }
  async openCaptureFolder(res, folder) {
    try {
      const dir = this.captureDirectory(folder);
      await fsp.access(dir);
      const explorer = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
      await execFileAsync(explorer, [dir], { windowsHide: false });
      this.json(res, 200, { ok: true });
    } catch (error) { this.json(res, 400, { ok: false, error: error.message }); }
  }
  async deleteUneditedCapture(res, folder) {
    try {
      const dir = this.captureDirectory(folder);
      const draft = JSON.parse(await fsp.readFile(path.join(dir, 'draft', 'draft.json'), 'utf8'));
      if (draft.status !== 'local_draft') throw new Error('只能清理尚未保存修改的草稿。');
      await fsp.rm(dir, { recursive: true, force: false });
      this.json(res, 200, { ok: true });
    } catch (error) { this.json(res, 400, { ok: false, error: error.message }); }
  }
  async yunxiaoOptions(res) {
    try { this.json(res, 200, await listProjectOptions()); }
    catch (error) { this.json(res, 400, { error: error.message }); }
  }
  async connectionStatus(res) {
    try {
      const { stdout } = await adb(this.config.serial, ['get-state'], { timeout: 4_000 });
      this.json(res, 200, {
        connected: stdout.trim() === 'device',
        adbState: stdout.trim() || 'unknown',
        serial: this.config.serial,
        deviceModel: this.deviceModel || '读取中',
        packageName: this.config.packageName,
        sessionId: this.config.sessionId,
        collectorUrl: `http://127.0.0.1:${this.config.port}`,
        agentStatus: this.agent.status,
        agentSessionId: this.agent.sessionId,
        agentMessage: this.agent.message
      });
    } catch (error) {
      this.json(res, 200, {
        connected: false,
        adbState: 'disconnected',
        serial: this.config.serial,
        deviceModel: this.deviceModel || '未知设备',
        packageName: this.config.packageName,
        sessionId: this.config.sessionId,
        collectorUrl: `http://127.0.0.1:${this.config.port}`,
        agentStatus: this.agent.status,
        agentSessionId: this.agent.sessionId,
        agentMessage: this.agent.message
      });
    }
  }
  async submitYunxiao(res, folder) {
    let draft;
    let draftFile;
    let dir;
    let submissionStarted = false;
    try {
      dir = this.captureDirectory(folder);
      draftFile = path.join(dir, 'draft', 'draft.json');
      draft = JSON.parse(await fsp.readFile(draftFile, 'utf8'));
      if (draft.status !== 'confirmed_locally') throw new Error('请先保存并确认本地草稿，再创建云效缺陷。');
      const alreadySubmitted = draft.submission?.state === 'submitted';
      draft.submission = {
        ...(draft.submission || {}),
        state: 'submitting',
        startedAt: iso(),
        lastError: null
      };
      submissionStarted = true;
      await Promise.all([writeJson(draftFile, draft), fsp.writeFile(path.join(dir, 'draft', 'draft.md'), draftMarkdown(draft), 'utf8')]);
      if (!draft.evidenceUpload?.downloadUrl || new Date(draft.evidenceUpload.expiresAt) <= new Date()) {
        draft.evidenceUpload = { ...(await uploadEvidencePackage(dir, folder)), uploadedAt: iso() };
      }
      const evidenceLine = `完整证据包下载：${draft.evidenceUpload.downloadUrl}`;
      if (String(draft.actualResult || '').includes(evidenceLine)) {
        draft.actualResult = String(draft.actualResult).replace(evidenceLine, '').replace(/\n{3,}/g, '\n\n').trim();
      }
      await Promise.all([writeJson(draftFile, draft), fsp.writeFile(path.join(dir, 'draft', 'draft.md'), draftMarkdown(draft), 'utf8')]);
      const submission = alreadySubmitted ? await updateWorkitem(draft) : await createWorkitem(draft);
      draft.submission = {
        ...(draft.submission || {}),
        state: 'submitted',
        submittedAt: alreadySubmitted ? draft.submission.submittedAt : iso(),
        syncedAt: iso(),
        yunxiao: alreadySubmitted ? { ...draft.submission.yunxiao, ...(submission.result || {}) } : submission.result
      };
      await Promise.all([writeJson(draftFile, draft), fsp.writeFile(path.join(dir, 'draft', 'draft.md'), draftMarkdown(draft), 'utf8')]);
      this.json(res, 200, { ok: true, action: alreadySubmitted ? 'updated' : 'created', submission: draft.submission });
    } catch (error) {
      if (submissionStarted && draft && draftFile && dir) {
        draft.submission = { ...(draft.submission || {}), state: 'submission_failed', failedAt: iso(), lastError: error.message };
        await Promise.allSettled([writeJson(draftFile, draft), fsp.writeFile(path.join(dir, 'draft', 'draft.md'), draftMarkdown(draft), 'utf8')]);
      }
      this.json(res, 400, { ok: false, error: error.message });
    }
  }
  async uploadOss(res, folder) {
    try {
      const dir = this.captureDirectory(folder);
      const draftFile = path.join(dir, 'draft', 'draft.json');
      const draft = JSON.parse(await fsp.readFile(draftFile, 'utf8'));
      if (draft.status !== 'confirmed_locally') throw new Error('请先保存本地草稿，再上传完整证据包。');
      draft.evidenceUpload = { ...(await uploadEvidencePackage(dir, folder)), uploadedAt: iso() };
      await Promise.all([writeJson(draftFile, draft), fsp.writeFile(path.join(dir, 'draft', 'draft.md'), draftMarkdown(draft), 'utf8')]);
      this.json(res, 200, { ok: true, evidenceUpload: draft.evidenceUpload });
    } catch (error) { this.json(res, 400, { ok: false, error: error.message }); }
  }
  serveEvidence(req, res, folder, relativePath) {
    try {
      const dir = this.captureDirectory(folder);
      const file = path.resolve(dir, relativePath);
      if (!file.startsWith(dir + path.sep)) throw new Error('Invalid evidence path');
      const types = { '.mp4': 'video/mp4', '.png': 'image/png', '.xml': 'text/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8' };
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error('Not a file');
      const headers = { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
      const range = req.headers.range;
      if (!range) {
        res.writeHead(200, { ...headers, 'Content-Length': stat.size });
        fs.createReadStream(file).pipe(res);
        return;
      }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
      let start;
      let end;
      if (match[1] === '') {
        const suffix = Number(match[2]);
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
      fs.createReadStream(file, { start, end }).pipe(res);
    } catch (error) { this.json(res, 404, { error: error.message }); }
  }

  async captureTriggered(event) {
    if (this.captures.has(event.captureId)) return;
    const dir = path.join(ROOT, 'captures', captureDirectoryName(event, this.deviceModel, this.config.packageName));
    const raw = path.join(dir, 'raw');
    const manifestDir = path.join(dir, 'manifest');
    await Promise.all([fsp.mkdir(raw, { recursive: true }), fsp.mkdir(manifestDir, { recursive: true })]);
    const capture = { event, dir, raw, manifestDir, startedAt: Date.now(), artifacts: {}, failures: [] };
    this.captures.set(event.captureId, capture);
    await writeJson(path.join(manifestDir, 'trigger.json'), event);
    await this.writeProgress(capture, { stage: 'collecting', label: '正在采集截图、日志和页面信息' });
    await fsp.writeFile(path.join(raw, 'logcat-at-trigger.txt'), this.currentLogs());
    await Promise.allSettled([
      this.captureScreenshot(capture), this.captureText(capture, 'ui.xml', ['exec-out', 'uiautomator', 'dump', '/dev/tty']),
      this.captureText(capture, 'window.txt', ['shell', 'dumpsys', 'window', 'windows']),
      this.captureText(capture, 'device.txt', ['shell', 'getprop']),
      this.captureText(capture, 'app.txt', ['shell', 'dumpsys', 'package', this.config.packageName])
    ]);
    await this.writeProgress(capture, { stage: 'recording_tail', label: '正在保留触发后的录像（约 10 秒）' });
    console.log(`[${event.captureId}] trigger received; collecting immediate ADB evidence.`);
  }

  async captureScreenshot(capture) {
    try {
      const { stdout } = await adb(this.config.serial, ['exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 8_000 });
      await fsp.writeFile(path.join(capture.raw, 'screenshot.png'), stdout);
      capture.artifacts.screenshot = 'raw/screenshot.png';
    } catch (error) { capture.failures.push({ artifact: 'screenshot', error: error.message }); }
  }
  async captureText(capture, filename, args) {
    try {
      const { stdout } = await adb(this.config.serial, args);
      await fsp.writeFile(path.join(capture.raw, filename), stdout);
      capture.artifacts[filename] = `raw/${filename}`;
    } catch (error) { capture.failures.push({ artifact: filename, error: error.message }); }
  }

  async captureReady(event) {
    const capture = this.captures.get(event.captureId);
    if (!capture) throw new Error('Ready event received before triggered event');
    await fsp.writeFile(path.join(capture.raw, 'logcat.txt'), this.currentLogs());
    capture.artifacts.logcat = 'raw/logcat.txt';
    const segmentsDir = path.join(capture.raw, 'video-segments');
    await fsp.mkdir(segmentsDir, { recursive: true });
    const pulled = [];
    const totalVideos = (event.videoPaths || []).length + (event.replayPath ? 1 : 0);
    await this.writeProgress(capture, { stage: 'transferring', label: `正在传输录像 0/${totalVideos}`, completed: 0, total: totalVideos });
    for (let index = 0; index < (event.videoPaths || []).length; index++) {
      const remote = String(event.videoPaths[index]);
      if (!remote.startsWith('/sdcard/Android/data/com.fastbug.captureagent/files/Movies/fastbug/') || remote.includes('..')) {
        capture.failures.push({ artifact: 'video', error: `Rejected unexpected remote path: ${remote}` });
        continue;
      }
      const local = path.join(segmentsDir, `${String(index).padStart(2, '0')}-${path.basename(remote)}`);
      try {
        await adb(this.config.serial, ['pull', remote, local], { timeout: 30_000 });
        const stat = await fsp.stat(local);
        if (!stat.size) throw new Error('pulled file is empty');
        pulled.push(path.relative(capture.dir, local).replaceAll('\\', '/'));
      } catch (error) { capture.failures.push({ artifact: `video:${path.basename(remote)}`, error: error.message }); }
      await this.writeProgress(capture, { stage: 'transferring', label: `正在传输录像 ${index + 1}/${totalVideos}`, completed: index + 1, total: totalVideos });
    }
    capture.artifacts.videoSegments = pulled;
    if (event.replayPath) {
      const remote = String(event.replayPath);
      if (remote.startsWith('/sdcard/Android/data/com.fastbug.captureagent/files/Movies/fastbug/') && !remote.includes('..')) {
        try {
          const replay = path.join(capture.raw, 'replay.mp4');
          await adb(this.config.serial, ['pull', remote, replay], { timeout: 60_000 });
          if (!(await fsp.stat(replay)).size) throw new Error('pulled replay is empty');
          capture.artifacts.replay = 'raw/replay.mp4';
        } catch (error) { capture.failures.push({ artifact: 'replay.mp4', error: error.message }); }
      } else capture.failures.push({ artifact: 'replay.mp4', error: 'Rejected unexpected replay path' });
    } else {
      capture.failures.push({ artifact: 'replay.mp4', error: 'Agent remux failed; original MP4 segments were retained.' });
    }
    if (event.replayPath) await this.writeProgress(capture, { stage: 'transferring', label: `正在传输录像 ${totalVideos}/${totalVideos}`, completed: totalVideos, total: totalVideos });
    await this.finalize(capture, event);
    console.log(`[${event.captureId}] evidence package ready: ${capture.dir}`);
  }

  async finalize(capture, readyEvent) {
    await this.writeLocalDraft(capture, readyEvent);
    const fileEntries = [];
    const walk = async dir => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!full.endsWith('manifest.json')) fileEntries.push({ path: path.relative(capture.dir, full).replaceAll('\\', '/'), sha256: await sha256(full), bytes: (await fsp.stat(full)).size });
      }
    };
    await walk(capture.dir);
    const manifest = {
      schemaVersion: 1,
      captureId: capture.event.captureId,
      evidenceDirectory: path.basename(capture.dir),
      sessionId: capture.event.sessionId,
      packageName: this.config.packageName,
      serialHash: crypto.createHash('sha256').update(this.config.serial).digest('hex'),
      trigger: capture.event,
      ready: readyEvent,
      collectorReceivedAt: iso(capture.startedAt),
      finalizedAt: iso(),
      artifacts: capture.artifacts,
      failures: capture.failures,
      files: fileEntries,
      status: capture.failures.length ? 'partial_success' : 'success',
      notes: ['replay.mp4 is a no-reencode remux of agent-generated H.264 segments. Original segments are retained for verification.']
    };
    await writeJson(path.join(capture.manifestDir, 'manifest.json'), manifest);
    await this.writeProgress(capture, { stage: 'complete', label: '证据已就绪' });
    this.captures.delete(capture.event.captureId);
  }

  async writeProgress(capture, progress) {
    await writeJson(path.join(capture.manifestDir, 'progress.json'), { ...progress, updatedAt: iso() });
  }

  async writeLocalDraft(capture, readyEvent) {
    const draftDir = path.join(capture.dir, 'draft');
    await fsp.mkdir(draftDir, { recursive: true });
    const timestamp = new Date(capture.event.triggeredAtWallMs).toLocaleString('zh-CN', { hour12: false });
    const draft = {
      schemaVersion: 1,
      captureId: capture.event.captureId,
      status: 'local_draft',
      generatedAt: iso(),
      generatedBy: 'fastbug-collector-poc',
      title: `【待确认】${this.config.packageName} 可观察异常`,
      environment: {
        packageName: this.config.packageName,
        deviceModel: this.deviceModel,
        triggeredAt: timestamp
      },
      reproductionSteps: ['待测试人员根据录像和测试用例补充。'],
      expectedResult: '待测试人员确认。',
      actualResult: '已捕获现场证据；请依据录像、截图和日志确认可观察现象。',
      technicalEvidence: {
        replay: fs.existsSync(path.join(capture.dir, 'raw', 'replay.mp4')) ? 'raw/replay.mp4' : ((capture.artifacts.videoSegments || [])[0] || 'raw/replay.mp4'),
        screenshot: 'raw/screenshot.png',
        logcat: 'raw/logcat.txt',
        uiXml: 'raw/ui.xml',
        manifest: 'manifest/manifest.json'
      },
      manualFields: ['title', 'reproductionSteps', 'expectedResult', 'severity', 'module', 'assignee', 'verifier', 'participants', 'testerNote'],
      submission: { state: 'not_submitted', target: null }
    };
    await Promise.all([
      writeJson(path.join(draftDir, 'draft.json'), draft),
      fsp.writeFile(path.join(draftDir, 'draft.md'), draftMarkdown(draft), 'utf8')
    ]);
    capture.artifacts.draft = 'draft/draft.md';
  }

  async stop() {
    if (this.reverseTimer) clearInterval(this.reverseTimer);
    if (this.logProcess) this.logProcess.kill();
    if (this.server) await new Promise(resolve => this.server.close(resolve));
  }
}

function draftMarkdown(draft) {
  const evidence = draft.technicalEvidence;
  return [
      '# 本地缺陷草稿（待人工确认）', '',
      `- 捕获 ID：${draft.captureId}`,
      `- 触发时间：${draft.environment.triggeredAt}`,
      `- 设备：${draft.environment.deviceModel}`,
      `- App：${draft.environment.packageName}`, '',
      '## 标题', '', draft.title, '',
      '## 复现步骤', '', ...(Array.isArray(draft.reproductionSteps) ? draft.reproductionSteps.map((step, index) => `${index + 1}. ${step}`) : ['1. 待补充。']), '',
      '## 预期结果', '', draft.expectedResult || '待确认。', '',
      '## 实际结果', '', draft.actualResult || '待确认。', '',
      '## 技术证据', '',
      `- [完整录像](../${evidence.replay})`,
      `- [触发截图](../${evidence.screenshot})`,
      `- [完整日志](../${evidence.logcat})`,
      `- [UI 层级](../${evidence.uiXml})`,
      '- [证据清单](../manifest/manifest.json)', '',
      '## 人工确认', '',
      `- 严重程度：${draft.severity || '待确认'}`,
      `- 应用：${draft.application || '待确认'}`,
      `- 模块：${draft.module || '待确认'}`,
      `- 指派人：${draft.assignee || '待确认'}`,
      `- 验证者：${draft.verifier || '待确认'}`,
      `- 参与者：${(draft.participants || []).join('、') || '待确认'}`,
      `- 测试人员说明：${draft.testerNote || '待补充'}`, ''
    ].join('\n');
}

function legacyDashboardHtml() {
  return String.raw`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FastBug · 缺陷草稿</title>
<style>
:root{--ink:#172033;--muted:#708097;--line:#e5eaf1;--navy:#111c32;--blue:#356dff;--blue-pale:#edf3ff;--bg:#f4f6fa;--surface:#fff;--shadow:0 14px 40px rgba(25,43,76,.08)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 Inter,"Microsoft YaHei",system-ui,sans-serif}.topbar{height:72px;background:linear-gradient(110deg,#101a2e,#1c3157);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 max(28px,calc((100vw - 1420px)/2));box-shadow:0 2px 12px #111a2a33}.brand{display:flex;gap:13px;align-items:center}.brand-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#75a5ff,#3165ff);display:grid;place-items:center;font-weight:800;font-size:18px}.brand h1{font-size:17px;letter-spacing:.2px;margin:0}.brand small{display:block;margin-top:1px;color:#bfcce2}.local{color:#c9d6ee;font-size:12px}.local i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#65db9c;margin-right:7px}.workspace{max-width:1420px;margin:0 auto;padding:24px;display:grid;grid-template-columns:340px minmax(0,1fr);gap:22px}.panel{background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:16px}.sidebar{padding:18px;height:calc(100vh - 120px);min-height:600px;position:sticky;top:18px;overflow:auto;user-select:none;-webkit-user-select:none}.panel-head{display:flex;align-items:center;justify-content:space-between;margin:2px 2px 15px}.panel-head h2{font-size:15px;margin:0}.counter{background:var(--blue-pale);color:#3565d9;padding:3px 8px;border-radius:999px;font-size:12px;font-weight:700}.capture{border:1px solid transparent;border-radius:12px;padding:13px 12px;margin:7px 0;cursor:pointer;transition:.16s ease}.capture:hover{background:#f8faff;border-color:#e5ecff}.capture.active{background:var(--blue-pale);border-color:#adc6ff;box-shadow:inset 3px 0 var(--blue)}.capture-title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.capture-meta{margin-top:5px;color:var(--muted);font-size:12px}.capture-tags{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px}.tag{display:inline-block;font-size:11px;color:#2d65d8;background:#e8f0ff;border-radius:5px;padding:1px 6px}.tag.yunxiao{color:#248954;background:#e8f8ef}.tag.submitting{color:#9a6700;background:#fff4d6}.tag.failed{color:#c4453f;background:#fff0ef}.tag.pending{color:#8a6270;background:#f4eef0}.capture-directory{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.empty{color:var(--muted);text-align:center;padding:44px 10px}.content{min-width:0}.draft-shell{padding:28px 30px}.draft-top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:21px;margin-bottom:24px}.draft-top h2{margin:0;font-size:21px;letter-spacing:-.2px}.draft-id{margin-top:6px;color:var(--muted);font-size:12px}.evidence{display:flex;gap:8px;flex-wrap:wrap}.evidence a{color:#2a5ed8;text-decoration:none;border:1px solid #d9e4ff;background:#f7f9ff;padding:7px 10px;border-radius:8px;font-size:12px;font-weight:600}.evidence a:hover{background:#edf3ff}.section-label{font-size:12px;font-weight:800;letter-spacing:.8px;color:#7a899d;text-transform:uppercase;margin:23px 0 9px}label{display:block;font-weight:700;color:#31405a}label span{font-weight:400;color:var(--muted);margin-left:5px}input,textarea,select{display:block;width:100%;margin-top:7px;border:1px solid #d7dfeb;border-radius:9px;padding:10px 12px;background:#fff;color:var(--ink);font:inherit;outline:none;transition:border .15s,box-shadow .15s}input:focus,textarea:focus,select:focus{border-color:#7498ff;box-shadow:0 0 0 3px #dfe9ff}textarea{resize:vertical;min-height:94px}.title-input{font-size:16px;font-weight:650}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid.three{grid-template-columns:1fr 1fr 1fr}.savebar{position:sticky;bottom:0;margin:26px -30px -28px;padding:16px 30px;background:#ffffffed;backdrop-filter:blur(8px);border-top:1px solid var(--line);display:flex;gap:12px;align-items:center}.savebar button{border:0;border-radius:9px;padding:11px 18px;background:linear-gradient(135deg,#4478ff,#2559e5);color:white;font:700 14px inherit;cursor:pointer;box-shadow:0 5px 13px #2e61d93d}.savebar button:hover{filter:brightness(1.05)}.saved{color:#2e9b63;font-size:12px}.welcome{padding:48px;min-height:520px;display:grid;place-content:center;text-align:center}.welcome-icon{width:58px;height:58px;border-radius:17px;background:var(--blue-pale);color:#356dff;display:grid;place-items:center;font-size:27px;margin:auto}.welcome h2{margin:16px 0 7px;font-size:20px}.welcome p{margin:0;color:var(--muted);max-width:360px}@media(max-width:850px){.workspace{padding:12px;grid-template-columns:1fr}.sidebar{height:auto;min-height:0;position:static}.draft-shell{padding:20px}.savebar{margin:22px -20px -20px;padding:14px 20px}.topbar{padding:0 16px}.local{display:none}.grid,.grid.three{grid-template-columns:1fr}.draft-top{gap:14px;flex-direction:column}}
@media(max-width:850px){.sidebar{max-height:300px;overflow:auto}}.connection{max-width:1420px;margin:20px auto -2px;padding:16px 20px;display:flex;align-items:center;gap:22px}.connection-title{font-weight:800}.connection-title small{display:block;margin-top:2px;color:var(--muted);font-weight:400}.connection-detail{min-width:0;display:flex;gap:14px;align-items:center;flex:1;color:#526177;font-size:12px}.connection-detail span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.connection code{font:12px ui-monospace,Consolas,monospace;color:#33415b}.connection-state{padding:4px 9px;border-radius:99px;background:#fff0ef;color:#c4453f;font-size:12px;font-weight:700;white-space:nowrap}.connection-state.ok{background:#e8f8ef;color:#248954}.connection button{border:1px solid #d7dfeb;border-radius:8px;background:#fff;padding:7px 10px;color:#40516d;cursor:pointer;font:600 12px inherit;white-space:nowrap}@media(max-width:850px){.connection{margin:12px;padding:14px;display:grid;gap:8px}.connection-detail{display:grid;gap:4px}.connection button{width:max-content}}</style>
<style>#openFolder{color:#2a5ed8;border:1px solid #d9e4ff;background:#f7f9ff;padding:7px 10px;border-radius:8px;font:600 12px inherit;cursor:pointer}#openFolder:hover{background:#edf3ff}</style>
<style>
/* Visual language: layered cards and restrained motion inspired by the local Galaxy UI collection. */
:root{--canvas:#f1f5fb;--canvas-glow:#e6efff;--ink-strong:#14213a;--violet:#7b5cff;--cyan:#50c8ff;--success:#20b879;--panel-border:rgba(216,226,241,.92)}
body{min-height:100vh;background:radial-gradient(circle at 88% -12%,#dbe8ff 0,transparent 30%),radial-gradient(circle at -8% 53%,#e9edff 0,transparent 25%),var(--canvas)}
body:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.35;background-image:linear-gradient(#cfd9ea35 1px,transparent 1px),linear-gradient(90deg,#cfd9ea35 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(to bottom,black,transparent 78%)}
.topbar{height:76px;background:linear-gradient(116deg,#0d1730 0%,#162b52 55%,#213d70 100%);box-shadow:0 12px 30px #0b1a3733}
.brand-mark{width:38px;height:38px;border-radius:13px;background:linear-gradient(140deg,#8f7dff,#3c95ff);box-shadow:inset 0 1px #ffffff75,0 8px 18px #2e6ee15e}
.brand h1{font-size:18px}.brand small{font-size:11px;letter-spacing:.08em;text-transform:uppercase}.local{display:flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid #ffffff1f;border-radius:999px;background:#ffffff0b}.local i{margin-right:0;box-shadow:0 0 0 4px #65db9c20}
.dashboard-intro{max-width:1420px;margin:0 auto;padding:32px 24px 0;display:flex;align-items:end;justify-content:space-between;gap:28px}.eyebrow{display:flex;align-items:center;gap:7px;margin:0 0 8px;color:#5670a6;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.eyebrow:before{content:"";width:18px;height:2px;border-radius:9px;background:linear-gradient(90deg,var(--violet),var(--cyan))}.dashboard-intro h2{margin:0;color:var(--ink-strong);font-size:28px;line-height:1.2;letter-spacing:-.8px}.dashboard-intro p{margin:9px 0 0;color:#657793}.overview{display:grid;grid-template-columns:repeat(3,minmax(100px,1fr));gap:10px;min-width:350px}.metric{padding:12px 14px;border:1px solid #dce6f4;border-radius:14px;background:#ffffffb8;box-shadow:0 8px 20px #233b6710;backdrop-filter:blur(10px)}.metric b{display:block;color:#17284a;font-size:20px;line-height:1}.metric span{display:block;margin-top:5px;color:#71829d;font-size:11px;font-weight:650}.metric.ready b{color:#179865}.metric.pending b{color:#8165e7}
.connection{margin-top:18px;margin-bottom:-1px;border-color:var(--panel-border);border-radius:18px;background:linear-gradient(105deg,#ffffffef,#f8faffd9);box-shadow:0 12px 30px #233b6712}.connection-title{color:#233657}.connection-state{box-shadow:inset 0 0 0 1px currentColor}.connection-state.ok{background:#e8fbf2}.connection button,#openFolder{transition:transform .15s ease,box-shadow .15s ease}.connection button:hover,#openFolder:hover{transform:translateY(-1px);box-shadow:0 5px 12px #2f5fb425}
.workspace{padding-top:20px;gap:20px}.panel{border-color:var(--panel-border);box-shadow:0 14px 36px #233b6710}.sidebar{border-radius:18px;background:#ffffffdc;backdrop-filter:blur(12px)}.panel-head{padding-bottom:12px;border-bottom:1px solid #edf1f7}.counter{background:linear-gradient(135deg,#edf2ff,#e4f5ff)}.capture{position:relative;padding:14px 13px 14px 16px;background:#fff0}.capture:before{content:"";position:absolute;left:0;top:15px;bottom:15px;width:3px;border-radius:4px;background:#dbe4f5;transition:.16s ease}.capture:hover{transform:translateX(2px);box-shadow:0 6px 16px #233b670a}.capture.active{background:linear-gradient(100deg,#eef3ff,#f7faff);box-shadow:none}.capture.active:before{top:11px;bottom:11px;background:linear-gradient(#7b5cff,#4faaff)}.capture.processing:before{background:#f1b34e}.tag{border-radius:999px;padding:2px 7px;font-weight:700}.tag.yunxiao{background:#e5f9ef}.tag.pending{background:#f7eef3}.capture-directory{font:11px ui-monospace,Consolas,monospace;color:#8997ad}
.draft-shell{border-radius:18px;background:#ffffffef;backdrop-filter:blur(12px)}.draft-top{position:relative;padding:0 0 22px}.draft-top:after{content:"";position:absolute;left:0;bottom:-1px;width:62px;height:2px;border-radius:4px;background:linear-gradient(90deg,var(--violet),var(--cyan))}.draft-top h2{color:var(--ink-strong)}.evidence a,#openFolder{display:inline-flex;align-items:center;min-height:32px;border-radius:9px}.evidence a:first-child{color:#fff;background:linear-gradient(135deg,#4b7cff,#345ee5);border-color:transparent;box-shadow:0 5px 13px #2e61d93d}.evidence a:first-child:hover{background:linear-gradient(135deg,#3c70f6,#274cd0)}.section-label{display:flex;align-items:center;gap:7px;color:#647795}.section-label:before{content:"";width:5px;height:5px;border-radius:50%;background:#6e7fff;box-shadow:0 0 0 3px #e9edff}input,textarea,select{background:#fbfcff;border-color:#dce4f0}input:hover,textarea:hover,select:hover{border-color:#bdcce4}.savebar{border-top-color:#e3e9f3;background:#ffffffeb}.savebar button.submit-yunxiao{background:linear-gradient(135deg,#8266ff,#6248d5);box-shadow:0 5px 13px #6545c93d}.welcome{overflow:hidden;position:relative;background:linear-gradient(135deg,#ffffff,#f4f7ff)}.welcome:before,.welcome:after{content:"";position:absolute;border-radius:50%;filter:blur(3px);opacity:.6}.welcome:before{width:260px;height:260px;top:-130px;right:-100px;background:#dbe8ff}.welcome:after{width:180px;height:180px;bottom:-110px;left:-70px;background:#ede5ff}.welcome>div{position:relative;z-index:1}.welcome-icon{background:linear-gradient(135deg,#e5e9ff,#dff5ff);box-shadow:0 10px 25px #6476c330}
@media(max-width:850px){.dashboard-intro{padding:23px 16px 0;display:block}.dashboard-intro h2{font-size:23px}.overview{min-width:0;margin-top:18px}.workspace{padding-top:12px}.metric{padding:11px}.connection{margin-top:14px}.local{display:none}}@media(max-width:430px){.overview{gap:7px}.metric{padding:10px}.metric b{font-size:18px}.metric span{font-size:10px}.dashboard-intro p{font-size:12px}.evidence{gap:6px}.evidence a,#openFolder{padding:6px 8px;font-size:11px}}
</style>
<header class="topbar"><div class="brand"><div class="brand-mark">F</div><div><h1>FastBug</h1><small>Evidence command center</small></div></div><div class="local"><i></i>证据只保存在当前电脑</div></header>
<section class="dashboard-intro"><div><div class="eyebrow">Capture workspace</div><h2>让每次缺陷，都带着完整现场</h2><p>从设备状态到证据与云效草稿，在一个工作台里完成确认。</p></div><div class="overview" aria-label="捕获概览"><div class="metric"><b id="statTotal">—</b><span>全部捕获</span></div><div class="metric ready"><b id="statReady">—</b><span>证据已就绪</span></div><div class="metric pending"><b id="statDraft">—</b><span>待完善草稿</span></div></div></section>
<section class="panel connection"><div class="connection-title">设备连接<small>ADB USB · Collector 本机服务</small></div><span class="connection-state" id="connectionState">检查中…</span><div class="connection-detail"><span id="connectionDevice">设备：—</span><span>会话 ID：<code id="connectionSession">—</code></span></div><button type="button" id="refreshConnection">刷新状态</button></section>
<main class="workspace"><aside class="panel sidebar"><div class="panel-head"><h2>捕获记录</h2><span class="counter" id="count">—</span></div><div id="list"><div class="empty">正在同步捕获记录…</div></div></aside><section class="content"><form class="panel draft-shell" id="editor" hidden><div class="draft-top"><div><h2 id="heading">缺陷草稿</h2><div class="draft-id" id="meta"></div></div><div class="evidence"><a id="video" target="_blank">▶ 查看录像</a><a id="shot" target="_blank">▣ 截图</a><a id="logs" target="_blank">⌁ 日志</a></div></div><div class="section-label">问题描述</div><label>缺陷标题<input class="title-input" id="title" placeholder="例如：支付成功后订单状态未刷新" required></label><div class="grid"><label>预期结果<textarea id="expected" placeholder="应该发生什么？"></textarea></label><label>实际结果<textarea id="actual" placeholder="实际观察到了什么？"></textarea></label></div><label class="section-label">复现步骤 <span>每行一步</span><textarea id="steps" placeholder="1. 进入订单页&#10;2. 完成支付&#10;3. 观察订单状态"></textarea></label><div class="section-label">云效必填字段</div><div class="grid three"><label>应用 <span>输入关键词筛选</span><input id="applicationQuery" list="applicationOptions" placeholder="输入应用名称" autocomplete="off" required><input id="application" type="hidden"><datalist id="applicationOptions"></datalist></label><label>严重程度<select id="severity"><option value="">待确认</option><option>致命</option><option>严重</option><option>一般</option><option>轻微</option></select></label><label>负责人 <span>输入姓名筛选</span><input id="assigneeQuery" list="assigneeOptions" placeholder="输入负责人姓名" autocomplete="off" required><input id="assignee" type="hidden"><datalist id="assigneeOptions"></datalist></label></div><div class="section-label">云效协作人</div><div class="grid"><label>验证者 <span>可选，输入姓名选择</span><input id="verifierQuery" list="verifierOptions" placeholder="输入验证者姓名" autocomplete="off"><input id="verifier" type="hidden"><datalist id="verifierOptions"></datalist></label><label>参与者 <span>单选</span><select id="participants"></select></label></div><div class="section-label">路由与补充</div><label>模块<input id="module" placeholder="例如：订单中心"></label><label>测试说明<textarea id="note" placeholder="补充环境、测试账号或其他线索"></textarea></label><div class="savebar"><button>保存本地草稿</button><button type="button" class="submit-yunxiao" id="submitYunxiao">提交到云效</button><span class="saved" id="saved"></span></div></form><div class="panel welcome" id="hint"><div><div class="welcome-icon">✦</div><h2>从一条捕获开始</h2><p>选择左侧记录，依据录像、截图和日志补全缺陷草稿。保存后可随时继续编辑。</p></div></div></section></main>
<script>
let activeFolder='',activeDraft=null,yunxiaoOptions=null,yunxiaoAvailable=true,captureRecords=[];
const $=id=>document.getElementById(id);
const openFolderButton=document.createElement('button');openFolderButton.type='button';openFolderButton.id='openFolder';openFolderButton.textContent='▤ 打开文件夹';document.querySelector('.evidence').append(openFolderButton);
const cleanupStyle=document.createElement('style');cleanupStyle.textContent='#cleanupDrafts{border:0;background:transparent;color:#708097;font:600 12px inherit;cursor:pointer;padding:5px 2px}.cleanup-mask{position:fixed;inset:0;background:#111b2b70;display:grid;place-items:center;padding:18px;z-index:10}.cleanup-mask[hidden]{display:none}.cleanup-dialog{width:min(520px,100%);max-height:80vh;overflow:auto;background:#fff;border-radius:16px;padding:22px;box-shadow:0 20px 60px #14213d44}.cleanup-dialog h3{margin:0;font-size:18px}.cleanup-dialog p{color:#708097;margin:6px 0 16px}.cleanup-list{border:1px solid #e5eaf1;border-radius:10px;overflow:hidden;max-height:360px;overflow-y:auto}.cleanup-item{display:flex;gap:10px;align-items:flex-start;padding:12px;border-bottom:1px solid #edf0f5;cursor:pointer}.cleanup-item:last-child{border:0}.cleanup-item input{margin-top:3px}.cleanup-item b{display:block;font-size:13px}.cleanup-item small{display:block;color:#708097;margin-top:2px;word-break:break-all}.cleanup-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:17px}.cleanup-actions button{border:1px solid #d7dfeb;border-radius:8px;background:#fff;padding:8px 11px;color:#40516d;font:600 13px inherit;cursor:pointer}.cleanup-actions .danger{background:#c4453f;border-color:#c4453f;color:#fff}.cleanup-empty{padding:22px;color:#708097;text-align:center}';document.head.append(cleanupStyle);
const cleanupButton=document.createElement('button');cleanupButton.type='button';cleanupButton.id='cleanupDrafts';cleanupButton.textContent='清理未保存';document.querySelector('.panel-head').append(cleanupButton);
const cleanupDialog=document.createElement('div');cleanupDialog.className='cleanup-mask';cleanupDialog.hidden=true;cleanupDialog.innerHTML='<section class="cleanup-dialog" role="dialog" aria-modal="true"><h3>清理未保存草稿</h3><p id="cleanupHint"></p><div class="cleanup-list" id="cleanupList"></div><div class="cleanup-actions"><button type="button" id="cleanupCancel">取消</button><button type="button" id="cleanupSelected" class="danger">删除选中</button><button type="button" id="cleanupAll" class="danger">全部删除</button></div></section>';document.body.append(cleanupDialog);
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function loadConnection(){const state=$('connectionState');state.textContent='检查中…';state.classList.remove('ok');try{const r=await fetch('/v1/connection');const data=await r.json();const connected=data.connected===true;state.textContent=connected?'已连接':'未连接';state.classList.toggle('ok',connected);$('connectionDevice').textContent='设备：'+data.deviceModel+' · '+data.serial+' · '+data.adbState;$('connectionSession').textContent=data.sessionId||'—'}catch(_){state.textContent='无法连接 Collector';$('connectionDevice').textContent='设备：—';$('connectionSession').textContent='—'}}
function evidence(p){return '/evidence/'+encodeURIComponent(activeFolder)+'/'+p.split('/').map(encodeURIComponent).join('/')}
function badges(c){
  if(c.status==='in_progress')return [{label:c.progress?.label||'正在处理',kind:'pending'}];
  const yunxiaoStatus={submitted:{label:'已提交到云效',kind:'yunxiao'},submitting:{label:'提交到云效中',kind:'submitting'},submission_failed:{label:'云效提交失败',kind:'failed'}}[c.yunxiaoStatus]||{label:'未提交云效',kind:'pending'};
  return [
    {label:c.draftStatus==='confirmed_locally'?'已保存':'待完善',kind:c.draftStatus==='confirmed_locally'?'':'pending'},
    yunxiaoStatus
  ];
}
function isReady(c){return c.status!=='in_progress'}
function optionLabel(item){const role=item.name==='江平进'?'参与人':item.role;return item.name+(role?' · '+role:'')}
function addAutocompleteOptions(id,items){$(id).innerHTML=items.map(item=>'<option value="'+esc(optionLabel(item))+'"></option>').join('')}
function matchOption(items,text){return items.find(item=>optionLabel(item)===text)||null}
function setAutocomplete(kind,id){const items=yunxiaoOptions?.[kind]||[];const target={applications:['application','applicationQuery'],assignees:['assignee','assigneeQuery'],verifiers:['verifier','verifierQuery']}[kind];if(!target)return;const fallback=kind==='applications'?items.find(item=>item.name==='数学一对一'):kind==='assignees'?items.find(item=>item.name==='江平进'&&item.role.includes('参与人'))||items.find(item=>item.name==='江平进'):null;const item=items.find(item=>item.id===id)||(!id?fallback:null);$(target[0]).value=item?.id||'';$(target[1]).value=item?optionLabel(item):''}
function setParticipants(ids){const selected=new Set(ids||[]);$('participants').innerHTML=(yunxiaoOptions?.participants||[]).map(item=>'<option value="'+esc(item.id)+'"'+(selected.has(item.id)?' selected':'')+'>'+esc(optionLabel(item))+'</option>').join('')}
function bindAutocomplete(queryId,hiddenId,kind){$(queryId).addEventListener('input',()=>{$(hiddenId).value='';});$(queryId).addEventListener('change',()=>{const item=matchOption(yunxiaoOptions?.[kind]||[],$(queryId).value);$(hiddenId).value=item?.id||'';});}
async function loadYunxiaoOptions(){if(yunxiaoOptions)return yunxiaoOptions;const r=await fetch('/v1/yunxiao/options');if(!r.ok)throw new Error((await r.json()).error||'无法读取云效选项');yunxiaoOptions=await r.json();addAutocompleteOptions('applicationOptions',yunxiaoOptions.applications);addAutocompleteOptions('assigneeOptions',yunxiaoOptions.assignees);addAutocompleteOptions('verifierOptions',yunxiaoOptions.verifiers);return yunxiaoOptions}
async function load(){
  const r=await fetch('/v1/captures');const d=await r.json();captureRecords=d.captures;$('count').textContent=d.captures.length+' 条';$('statTotal').textContent=d.captures.length;$('statReady').textContent=d.captures.filter(isReady).length;$('statDraft').textContent=d.captures.filter(c=>isReady(c)&&c.draftStatus!=='confirmed_locally').length;
  $('list').innerHTML=d.captures.length?d.captures.map(c=>'<article class="capture'+(activeFolder===c.directory?' active':'')+(isReady(c)?'':' processing')+'" data-folder="'+esc(c.directory)+'"><div class="capture-title">'+esc(c.title)+'</div><div class="capture-meta"><div class="capture-tags">'+badges(c).map(item=>'<span class="tag '+item.kind+'">'+esc(item.label)+'</span>').join('')+'</div><span class="capture-directory">'+esc(c.directory)+'</span></div></article>').join(''):'<div class="empty">还没有完成的捕获记录。</div>';
  document.querySelectorAll('.capture').forEach(x=>x.onclick=()=>{const c=d.captures.find(item=>item.directory===x.dataset.folder);if(c&&isReady(c))openDraft(x.dataset.folder)});
}
async function openDraft(folder){
  const r=await fetch('/v1/captures/'+encodeURIComponent(folder)+'/draft');if(!r.ok){alert('此捕获还没有准备好草稿，请稍后重试。');return}
  try{await loadYunxiaoOptions();yunxiaoAvailable=true}catch(_){yunxiaoAvailable=false}
  activeFolder=folder;activeDraft=await r.json();$('editor').hidden=false;$('hint').hidden=true;$('heading').textContent=activeDraft.title||'缺陷草稿';$('meta').textContent=activeDraft.environment.deviceModel+'  ·  '+activeDraft.environment.packageName+'  ·  '+activeDraft.environment.triggeredAt;
  const fixedCollaborators=yunxiaoOptions?.fixedCollaborators||{};const verifierId=fixedCollaborators.verifierId||activeDraft.verifierId||'';const participantIds=fixedCollaborators.participantIds?.length?fixedCollaborators.participantIds:(activeDraft.participantIds||[]);$('title').value=activeDraft.title||'';$('steps').value=(activeDraft.reproductionSteps||[]).join('\n');$('expected').value=activeDraft.expectedResult||'';$('actual').value=activeDraft.actualResult||'';$('severity').value=activeDraft.severity||'';setAutocomplete('applications',activeDraft.application||'');$('module').value=activeDraft.module||'';setAutocomplete('assignees',activeDraft.assigneeId||'');setAutocomplete('verifiers',verifierId);setParticipants(participantIds);$('note').value=activeDraft.testerNote||'';$('applicationQuery').disabled=!yunxiaoAvailable;$('assigneeQuery').disabled=!yunxiaoAvailable;$('verifierQuery').disabled=!yunxiaoAvailable||Boolean(fixedCollaborators.verifierId);$('participants').disabled=!yunxiaoAvailable||Boolean(fixedCollaborators.participantIds?.length);$('submitYunxiao').disabled=!yunxiaoAvailable;$('submitYunxiao').title=yunxiaoAvailable?'':'请先完成云效配置';if(!yunxiaoAvailable){$('applicationQuery').value=activeDraft.application||'未配置';$('assigneeQuery').value=activeDraft.assignee||'未配置';$('saved').textContent='云效尚未配置：可继续保存本地草稿';}else $('saved').textContent='';$('video').href=evidence(activeDraft.technicalEvidence.replay);$('shot').href=evidence(activeDraft.technicalEvidence.screenshot);$('logs').href=evidence(activeDraft.technicalEvidence.logcat);load();
}
bindAutocomplete('applicationQuery','application','applications');bindAutocomplete('assigneeQuery','assignee','assignees');bindAutocomplete('verifierQuery','verifier','verifiers');
function currentDraft(){const application=matchOption(yunxiaoOptions?.applications||[],$('applicationQuery').value);const assignee=matchOption(yunxiaoOptions?.assignees||[],$('assigneeQuery').value);const verifier=matchOption(yunxiaoOptions?.verifiers||[],$('verifierQuery').value);const participantIds=Array.from($('participants').selectedOptions).map(option=>option.value);const participants=(yunxiaoOptions?.participants||[]).filter(person=>participantIds.includes(person.id));if(yunxiaoAvailable&&!application){alert('请从联想列表中选择应用。');$('applicationQuery').focus();return null}if(yunxiaoAvailable&&!assignee){alert('请从联想列表中选择负责人。');$('assigneeQuery').focus();return null}if(yunxiaoAvailable&&$('verifierQuery').value&&!verifier){alert('请从联想列表中选择验证者。');$('verifierQuery').focus();return null}$('application').value=application?.id||activeDraft.application||'';$('assignee').value=assignee?.id||activeDraft.assigneeId||'';$('verifier').value=verifier?.id||'';return {title:$('title').value.trim(),reproductionSteps:$('steps').value.split('\n').map(x=>x.trim()).filter(Boolean),expectedResult:$('expected').value.trim(),actualResult:$('actual').value.trim(),severity:$('severity').value,application:application?.id||activeDraft.application||'',module:$('module').value.trim(),assigneeId:assignee?.id||activeDraft.assigneeId||'',assignee:assignee?.name||activeDraft.assignee||'',verifierId:verifier?.id||'',verifier:verifier?.name||'',participantIds,participants:participants.map(person=>person.name),testerNote:$('note').value.trim()}}
async function saveCurrentDraft(){const body=currentDraft();if(!body)return null;const r=await fetch('/v1/captures/'+encodeURIComponent(activeFolder)+'/draft',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'保存失败，请检查 Collector 是否仍在运行。');activeDraft=data.draft;$('saved').textContent='✓ 已保存于 '+new Date().toLocaleTimeString();$('heading').textContent=body.title||'缺陷草稿';await load();return data.draft}
$('editor').onsubmit=async e=>{e.preventDefault();try{await saveCurrentDraft()}catch(error){alert(error.message)}};
$('submitYunxiao').onclick=async()=>{if(!activeFolder)return;const button=$('submitYunxiao');button.disabled=true;button.textContent='保存中…';try{const savedDraft=await saveCurrentDraft();if(!savedDraft)return;const isUpdate=savedDraft.submission?.state==='submitted';button.textContent=isUpdate?'更新中…':'提交中…';$('saved').textContent=isUpdate?'正在更新云效缺陷…':'正在提交到云效…';const request=fetch('/v1/captures/'+encodeURIComponent(activeFolder)+'/draft?action=submit-yunxiao',{method:'POST'});await new Promise(resolve=>setTimeout(resolve,150));load();const r=await request;const data=await r.json();if(!r.ok)throw new Error(data.error||'云效提交失败');activeDraft.submission=data.submission;$('saved').textContent=data.action==='updated'?'✓ 云效缺陷已更新为最新版本':'✓ 已提交到云效';load()}catch(error){$('saved').textContent='云效提交失败：'+error.message;load()}finally{button.disabled=false;button.textContent='提交到云效'}};
$('refreshConnection').onclick=loadConnection;
openFolderButton.onclick=async()=>{if(!activeFolder)return;openFolderButton.disabled=true;try{const r=await fetch('/v1/captures/'+encodeURIComponent(activeFolder)+'/open-folder',{method:'POST'});const data=await r.json();if(!r.ok)throw new Error(data.error||'无法打开文件夹')}catch(error){alert(error.message)}finally{openFolderButton.disabled=false}};
function uneditedCaptures(){return captureRecords.filter(c=>c.draftStatus==='local_draft')}
function showCleanup(){const items=uneditedCaptures();$('cleanupHint').textContent=items.length?'发现 '+items.length+' 条从未保存修改的草稿；确认后将删除它们的全部本地证据。':'没有可清理的未保存草稿。';$('cleanupList').innerHTML=items.length?items.map(c=>'<label class="cleanup-item"><input type="checkbox" value="'+esc(c.directory)+'" checked><span><b>'+esc(c.title)+'</b><small>'+esc(c.directory)+'</small></span></label>').join(''):'<div class="cleanup-empty">所有记录都已保存，或仍在采集中。</div>';$('cleanupSelected').disabled=!items.length;$('cleanupAll').disabled=!items.length;cleanupDialog.hidden=false}
async function deleteCaptures(folders){if(!folders.length)return;const message=folders.length===uneditedCaptures().length?'确定删除全部 '+folders.length+' 条未保存草稿及其录像、截图和日志吗？':'确定删除选中的 '+folders.length+' 条未保存草稿及其证据吗？';if(!confirm(message))return;const results=await Promise.all(folders.map(folder=>fetch('/v1/captures/'+encodeURIComponent(folder),{method:'DELETE'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'删除失败')})));cleanupDialog.hidden=true;await load();if(activeFolder&&folders.includes(activeFolder)){activeFolder='';$('editor').hidden=true;$('hint').hidden=false}}
cleanupButton.onclick=showCleanup;$('cleanupCancel').onclick=()=>cleanupDialog.hidden=true;$('cleanupSelected').onclick=()=>deleteCaptures(Array.from(document.querySelectorAll('#cleanupList input:checked')).map(x=>x.value));$('cleanupAll').onclick=()=>deleteCaptures(uneditedCaptures().map(c=>c.directory));
load();loadConnection();setInterval(load,1000);setInterval(loadConnection,10000);
</script></html>`;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'start') { usage(); process.exitCode = 1; return; }
  const config = options(rest);
  if (!config.serial || !config.packageName) { usage(); process.exitCode = 1; return; }
  validateRuntimeEnvironment();
  const collector = new Collector(config);
  process.on('SIGINT', async () => { await collector.stop(); process.exit(0); });
  process.on('SIGTERM', async () => { await collector.stop(); process.exit(0); });
  await collector.start();
}
main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
