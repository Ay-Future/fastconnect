import { observer } from 'mobx-react-lite'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import LunaModal from 'luna-modal'
import LunaToolbar, { LunaToolbarSpace, LunaToolbarText } from 'luna-toolbar/react'
import className from 'licia/className'
import copy from 'licia/copy'
import dateFormat from 'licia/dateFormat'
import trim from 'licia/trim'
import toStr from 'licia/toStr'
import { IFastbugCollectorStatus } from 'common/types'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { notify } from 'share/renderer/lib/util'
import store from '../../store'
import Style from './TestSession.module.scss'

interface ICapture {
  directory: string
  captureId: string
  triggeredAt: number
  status: string
  draftStatus: string
  yunxiaoStatus: string
  title: string
  progress?: { label?: string }
}

interface IPersonOption {
  id: string
  name: string
  role?: string
}

interface IOptions {
  applications: IPersonOption[]
  assignees: IPersonOption[]
  verifiers: IPersonOption[]
  participants: IPersonOption[]
  fixedCollaborators?: {
    verifierId?: string | null
    participantIds?: string[]
  }
}

interface IDraft {
  title: string
  reproductionSteps: string[]
  expectedResult: string
  actualResult: string
  severity: string
  application: string
  module: string
  assigneeId: string
  assignee: string
  verifierId: string
  verifier: string
  participantIds: string[]
  participants: string[]
  testerNote: string
  status: string
  submission?: { state?: string; lastError?: string }
  environment: {
    deviceModel: string
    packageName: string
    triggeredAt: string
  }
  technicalEvidence: {
    replay: string
    screenshot: string
    logcat: string
    uiXml: string
    manifest: string
  }
}

const DEFAULT_STATUS: IFastbugCollectorStatus = {
  running: false,
  starting: false,
  managed: false,
  serial: '',
  packageName: '',
  sessionId: '',
  port: 52741,
  url: 'http://127.0.0.1:52741',
  dataRoot: 'D:\\project\\collector-data',
  agentStatus: 'unchecked',
  agentSessionId: '',
  agentMessage: '尚未校验 FastBug Android Agent',
  lastError: '',
  logs: [],
}

export default observer(function TestSession() {
  const { device } = store
  const [packageName, setPackageName] = useState('')
  const [status, setStatus] = useState(DEFAULT_STATUS)
  const [captures, setCaptures] = useState<ICapture[]>([])
  const [selectedCapture, setSelectedCapture] = useState<ICapture | null>(null)
  const [draft, setDraft] = useState<IDraft | null>(null)
  const [options, setOptions] = useState<IOptions | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isControlCardCollapsed, setIsControlCardCollapsed] = useState(false)
  const [applicationQuery, setApplicationQuery] = useState('')
  const [assigneeQuery, setAssigneeQuery] = useState('')
  const [activeAutocomplete, setActiveAutocomplete] = useState<'application' | 'assignee' | null>(null)
  const [isLoadingDraft, setIsLoadingDraft] = useState(false)
  const [yunxiaoReady, setYunxiaoReady] = useState(false)

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(refreshStatus, 2500)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!device) return
    if (status.running && status.serial === device.id) {
      setPackageName(status.packageName)
      return
    }
    main
      .getTopPackage(device.id)
      .then((topPackage) => {
        if (topPackage.name) setPackageName((current) => current || topPackage.name)
      })
      .catch(() => {})
  }, [device?.id, status.packageName, status.running, status.serial])

  useEffect(() => {
    if (!status.running) {
      setCaptures([])
      setSelectedCapture(null)
      setDraft(null)
      return
    }
    void refreshCaptures()
    const timer = window.setInterval(refreshCaptures, 1200)
    return () => clearInterval(timer)
  }, [status.running, status.url])

  async function refreshStatus() {
    try {
      setStatus(await main.getFastbugCollectorStatus())
    } catch (error: any) {
      setStatus((current) => ({
        ...current,
        lastError: error?.message || '无法读取 Collector 状态',
      }))
    }
  }

  async function startCollector(restart = false) {
    if (!device) {
      notify(t('deviceNotConnected'), { icon: 'error' })
      return
    }
    const pkg = trim(toStr(packageName))
    if (!pkg) {
      notify('请填写被测应用包名', { icon: 'error' })
      return
    }

    setIsStarting(true)
    try {
      const nextStatus = restart
        ? await main.restartFastbugCollector({ serial: device.id, packageName: pkg })
        : await main.startFastbugCollector({ serial: device.id, packageName: pkg })
      setStatus(nextStatus)
      notify(restart ? 'Collector 已重启' : 'Collector 已启动', { icon: 'success' })
    } catch (error: any) {
      const message = error?.message || 'Collector 启动失败'
      setStatus((current) => ({ ...current, lastError: message }))
      notify(message, { icon: 'error' })
      await refreshStatus()
    } finally {
      setIsStarting(false)
    }
  }

  async function stopCollector() {
    try {
      setStatus(await main.stopFastbugCollector())
      notify('Collector 已停止', { icon: 'success' })
    } catch (error: any) {
      notify(error?.message || '停止 Collector 失败', { icon: 'error' })
    }
  }

  function copyConnectionValue(label: string, value: string) {
    if (!value) return
    copy(value)
    notify(`${label}已复制`, { icon: 'success' })
  }

  async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${status.url}${pathname}`, init)
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(data?.error || `请求失败（HTTP ${response.status}）`)
    }
    return data as T
  }

  async function refreshCaptures() {
    try {
      const response = await request<{ captures: ICapture[] }>('/v1/captures')
      setCaptures(response.captures)
      setSelectedCapture((current) =>
        current
          ? response.captures.find((item) => item.directory === current.directory) || null
          : current
      )
    } catch {
      // The status banner shows service failures; keep the last capture list visible.
    }
  }

  async function openCapture(capture: ICapture) {
    if (capture.status === 'in_progress') return
    setIsLoadingDraft(true)
    try {
      const nextDraft = await request<IDraft>(
        `/v1/captures/${encodeURIComponent(capture.directory)}/draft`
      )
      setSelectedCapture(capture)
      const nextOptions = await loadYunxiaoOptions()
      const preparedDraft = applyDraftDefaults(nextDraft, nextOptions)
      setDraft(preparedDraft)
      setApplicationQuery(nextOptions?.applications.find((item) => item.id === preparedDraft.application)?.name || preparedDraft.application || '')
      setAssigneeQuery(personLabel(nextOptions?.assignees.find((item) => item.id === preparedDraft.assigneeId)) || preparedDraft.assignee || '')
    } catch (error: any) {
      notify(error?.message || '无法加载缺陷草稿', { icon: 'error' })
    } finally {
      setIsLoadingDraft(false)
    }
  }

  async function loadYunxiaoOptions(): Promise<IOptions | null> {
    try {
      const result = await request<IOptions>('/v1/yunxiao/options')
      setOptions(result)
      setYunxiaoReady(true)
      return result
    } catch {
      setOptions(null)
      setYunxiaoReady(false)
      return null
    }
  }

  function applyDraftDefaults(nextDraft: IDraft, nextOptions: IOptions | null): IDraft {
    // Captures created before these fields were added do not have the arrays.
    // Normalize them at the boundary so older local evidence remains editable.
    const participantIds = Array.isArray(nextDraft.participantIds)
      ? nextDraft.participantIds
      : []
    const participants = Array.isArray(nextDraft.participants)
      ? nextDraft.participants
      : []
    const reproductionSteps = Array.isArray(nextDraft.reproductionSteps)
      ? nextDraft.reproductionSteps
      : []
    const normalizedDraft = {
      ...nextDraft,
      participantIds,
      participants,
      reproductionSteps,
    }
    if (!nextOptions) return normalizedDraft
    const defaultApplication = nextOptions.applications.find((item) => item.name === '数学一对一')
    const defaultVerifier = nextOptions.verifiers.find((item) => item.name === '陈锦东')
    const defaultParticipantIds = participantIds.length
      ? participantIds
      : nextOptions.participants.filter((item) => item.name === '陈锦东').slice(0, 1).map((item) => item.id)
    const participantPeople = nextOptions.participants.filter((item) => defaultParticipantIds.includes(item.id))
    const verifierId = nextDraft.verifierId || defaultVerifier?.id || ''
    const verifier = nextOptions.verifiers.find((item) => item.id === verifierId)
    return {
      ...normalizedDraft,
      application: normalizedDraft.application || defaultApplication?.id || '',
      verifierId,
      verifier: verifier?.name || normalizedDraft.verifier || '',
      participantIds: defaultParticipantIds,
      participants: participantPeople.length ? participantPeople.map((item) => item.name) : participants,
    }
  }

  function updateDraft(update: Partial<IDraft>) {
    setDraft((current) => (current ? { ...current, ...update } : current))
  }

  async function saveDraft() {
    if (!draft || !selectedCapture || isSaving) return false
    setIsSaving(true)
    try {
      const saved = await request<{ draft: IDraft }>(
        `/v1/captures/${encodeURIComponent(selectedCapture.directory)}/draft`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        }
      )
      setDraft(saved.draft)
      notify('缺陷草稿已保存到本机', { icon: 'success' })
      await refreshCaptures()
      return true
    } catch (error: any) {
      notify(error?.message || '保存缺陷草稿失败', { icon: 'error' })
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function submitYunxiao() {
    if (!draft || !selectedCapture || isSubmitting || !yunxiaoReady) return
    setIsSubmitting(true)
    try {
      if (!(await saveDraft())) return
      const result = await request<{ submission: IDraft['submission'] }>(
        `/v1/captures/${encodeURIComponent(selectedCapture.directory)}/draft?action=submit-yunxiao`,
        { method: 'POST' }
      )
      setDraft((current) =>
        current ? { ...current, submission: result.submission } : current
      )
      notify('已提交到云效', { icon: 'success' })
      await refreshCaptures()
    } catch (error: any) {
      notify(error?.message || '云效提交失败', { icon: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function openCaptureFolder() {
    if (!selectedCapture) return
    main.openPath(`${status.dataRoot}\\captures\\${selectedCapture.directory}`)
  }

  async function cleanupUneditedCaptures() {
    const targets = captures.filter((item) => item.draftStatus === 'local_draft')
    if (!targets.length) {
      notify('没有可清理的未保存草稿', { icon: 'error' })
      return
    }
    const confirmed = await LunaModal.confirm(
      `确定删除 ${targets.length} 条未保存草稿及其完整本地证据吗？`
    )
    if (!confirmed) return
    try {
      await Promise.all(
        targets.map((item) =>
          request(`/v1/captures/${encodeURIComponent(item.directory)}`, {
            method: 'DELETE',
          })
        )
      )
      if (selectedCapture && targets.some((item) => item.directory === selectedCapture.directory)) {
        setSelectedCapture(null)
        setDraft(null)
      }
      await refreshCaptures()
      notify('未保存草稿已清理', { icon: 'success' })
    } catch (error: any) {
      notify(error?.message || '清理失败', { icon: 'error' })
    }
  }

  function openEvidence(relativePath: string) {
    if (!selectedCapture || !relativePath) return
    const safeParts = relativePath
      .split(/[\\/]/)
      .filter((part) => part && part !== '.' && part !== '..')
    if (!safeParts.length) return
    main.openPath(
      `${status.dataRoot}\\captures\\${selectedCapture.directory}\\${safeParts.join('\\')}`
    )
  }

  const summary = useMemo(() => ({
    total: captures.length,
    ready: captures.filter((item) => item.status !== 'in_progress').length,
    pending: captures.filter(
      (item) => item.status !== 'in_progress' && item.draftStatus !== 'confirmed_locally'
    ).length,
  }), [captures])
  const canStart = Boolean(device && trim(toStr(packageName)) && !isStarting && !status.running)
  const statusText = status.starting
    ? '正在启动 Collector…'
    : status.running
      ? `${status.managed ? `${PRODUCT_NAME} 托管运行中` : '已接入外部 Collector'} · ${status.url}`
      : '未启动'
  const agentStatusText = formatAgentStatus(status)
  const applicationSuggestions = filterOptions(options?.applications || [], applicationQuery)
  const assigneeSuggestions = filterOptions(options?.assignees || [], assigneeQuery)

  return (
    <div className={className('panel-with-toolbar', Style.container)}>
      <LunaToolbar className="panel-toolbar">
        <ToolbarIcon icon="refresh" title={t('refresh')} onClick={refreshStatus} />
        <ToolbarIcon icon="open-file" title="打开本机证据目录" onClick={() => main.openPath(status.dataRoot)} />
        <LunaToolbarSpace />
        <LunaToolbarText text={statusText} />
      </LunaToolbar>
      <div className={className('panel-body', Style.body)}>
        <section className={className(Style.controlCard, { [Style.controlCardCollapsed]: isControlCardCollapsed })}>
          <button className={Style.collapseButton} type="button" aria-expanded={!isControlCardCollapsed} onClick={() => setIsControlCardCollapsed((value) => !value)}>{isControlCardCollapsed ? '展开' : '收起'}</button>
          <div className={Style.controlIntro}>
            <h2>缺陷工作台</h2>
            <p>现场证据、缺陷草稿和云效流转，全部在 {PRODUCT_NAME} 内完成。</p>
            {isControlCardCollapsed ? <span className={Style.collapsedState}>{statusText} · {agentStatusText}</span> : null}
          </div>
          {!isControlCardCollapsed ? <>
            <div className={Style.controls}>
              <label><span>已连接设备</span><input value={device ? `${device.name} · ${device.id}` : '未连接设备'} readOnly /></label>
              <label><span>被测应用包名</span><input value={packageName} placeholder="例如：com.example.app" onChange={(event) => setPackageName(event.target.value)} /></label>
              <div className={Style.controlActions}>
                <button className={Style.primaryButton} disabled={!canStart} onClick={() => startCollector(false)}>{isStarting ? '启动中...' : '启动 Collector'}</button>
                <button className={Style.secondaryButton} disabled={!device || !trim(toStr(packageName)) || isStarting || !status.running || !status.managed} onClick={() => startCollector(true)}>重启 Collector</button>
                <button className={Style.secondaryButton} disabled={!status.running || !status.managed} onClick={stopCollector}>停止</button>
              </div>
            </div>
            <div className={Style.statusRow}>
              <span className={className(Style.statusDot, { [Style.statusDotOn]: status.running })} />
              <span>{statusText}</span><span>证据目录：{status.dataRoot}</span>
            </div>
            <section className={Style.connectionInfo} aria-label="链接信息">
              <span className={Style.connectionTitle}>链接信息</span>
              <span className={Style.connectionItem}><b>Collector</b><code>{status.url}</code><button className={Style.copyButton} onClick={() => copyConnectionValue('Collector 链接', status.url)}>复制</button></span>
              <span className={Style.connectionItem}><b>会话 ID</b><code>{status.sessionId || '等待 Collector 建立会话'}</code><button className={Style.copyButton} disabled={!status.sessionId} onClick={() => copyConnectionValue('会话 ID', status.sessionId)}>复制</button></span>
              <span className={Style.connectionItem}><b>Android Agent</b><em className={className(Style.agentState, Style[`agent${status.agentStatus}`])}>{agentStatusText}</em></span>
              {status.agentMessage ? <span className={Style.agentMessage}>{status.agentMessage}</span> : null}
            </section>
            {status.lastError ? <div className={Style.error}>{status.lastError}</div> : null}
          </> : null}
        </section>

        {status.running ? (
          <section className={Style.workspace}>
            <aside className={Style.sidebar}>
              <div className={Style.sidebarHead}>
                <div><h3>捕获记录</h3></div>
                <button className={Style.textButton} onClick={cleanupUneditedCaptures}>清理未保存</button>
              </div>
              <div className={Style.metrics}>
                <Metric value={summary.total} label="全部捕获" />
                <Metric value={summary.ready} label="证据已就绪" />
                <Metric value={summary.pending} label="待完善草稿" />
              </div>
              <div className={Style.captureList}>
                {captures.length ? captures.map((capture) => (
                  <button key={capture.directory} className={className(Style.capture, { [Style.captureActive]: selectedCapture?.directory === capture.directory })} onClick={() => openCapture(capture)} disabled={capture.status === 'in_progress'}>
                    <strong>{capture.title}</strong>
                    <span className={Style.captureTags}>{captureStatusTags(capture).map((tag) => <i key={tag.label} className={className(Style.captureTag, Style[`captureTag${tag.kind}`])}>{tag.label}</i>)}</span>
                    <small>{formatCaptureTime(capture.triggeredAt)}</small>
                  </button>
                )) : <div className={Style.placeholder}>等待 Android Agent 上报缺陷事件…</div>}
              </div>
            </aside>

            <section className={Style.editor}>
              {isLoadingDraft ? <div className={Style.placeholder}>正在加载缺陷草稿…</div> : draft && selectedCapture ? (
                <>
                  <div className={Style.editorHead}>
                    <div><h3>{draft.title || '缺陷草稿'}</h3><p>{draft.environment.deviceModel} · {draft.environment.packageName} · {draft.environment.triggeredAt}</p></div>
                    <div className={Style.evidenceActions}>
                      <button className={Style.secondaryButton} onClick={() => openEvidence(draft.technicalEvidence.replay)}>录像</button>
                      <button className={Style.secondaryButton} onClick={() => openEvidence(draft.technicalEvidence.screenshot)}>截图</button>
                      <button className={Style.secondaryButton} onClick={() => openEvidence(draft.technicalEvidence.logcat)}>日志</button>
                      <button className={Style.secondaryButton} onClick={() => openEvidence(draft.technicalEvidence.uiXml)}>UI XML</button>
                      <button className={Style.secondaryButton} onClick={() => openEvidence(draft.technicalEvidence.manifest)}>清单</button>
                      <button className={Style.secondaryButton} onClick={openCaptureFolder}>文件夹</button>
                    </div>
                  </div>
                  <div className={Style.form}>
                    <Field label="缺陷标题"><input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></Field>
                    <div className={Style.twoColumns}>
                      <Field label="预期结果"><textarea value={draft.expectedResult} onChange={(event) => updateDraft({ expectedResult: event.target.value })} /></Field>
                      <Field label="实际结果"><textarea value={draft.actualResult} onChange={(event) => updateDraft({ actualResult: event.target.value })} /></Field>
                    </div>
                    <Field label="复现步骤（每行一步）"><textarea value={draft.reproductionSteps.join('\n')} onChange={(event) => updateDraft({ reproductionSteps: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></Field>
                    <div className={Style.sectionLabel}>云效字段 {yunxiaoReady ? '' : '（未配置，仍可保存本地草稿）'}</div>
                    <div className={Style.threeColumns}>
                      <Field label="应用"><div className={Style.autocomplete}><input value={applicationQuery} placeholder="输入应用名称" disabled={!yunxiaoReady} onFocus={() => setActiveAutocomplete('application')} onBlur={() => window.setTimeout(() => setActiveAutocomplete(null), 160)} onChange={(event) => { const query = event.target.value; setApplicationQuery(query); const item = options?.applications.find((option) => option.name === query); updateDraft({ application: item?.id || '' }); setActiveAutocomplete('application') }} />{activeAutocomplete === 'application' ? <div className={Style.autocompleteMenu}>{applicationSuggestions.length ? applicationSuggestions.map((item) => <button key={item.id} type="button" onMouseDown={(event) => { event.preventDefault(); setApplicationQuery(item.name); updateDraft({ application: item.id }); setActiveAutocomplete(null) }}><b>{item.name}</b></button>) : <span>没有匹配的应用</span>}</div> : null}</div></Field>
                      <Field label="严重程度"><select value={draft.severity || ''} onChange={(event) => updateDraft({ severity: event.target.value })}><option value="">待确认</option><option>致命</option><option>严重</option><option>一般</option><option>轻微</option></select></Field>
                      <Field label="负责人"><div className={Style.autocomplete}><input value={assigneeQuery} placeholder="输入负责人姓名" disabled={!yunxiaoReady} onFocus={() => setActiveAutocomplete('assignee')} onBlur={() => window.setTimeout(() => setActiveAutocomplete(null), 160)} onChange={(event) => { const query = event.target.value; setAssigneeQuery(query); const item = options?.assignees.find((option) => personLabel(option) === query || option.name === query); updateDraft({ assigneeId: item?.id || '', assignee: item?.name || '' }); setActiveAutocomplete('assignee') }} />{activeAutocomplete === 'assignee' ? <div className={Style.autocompleteMenu}>{assigneeSuggestions.length ? assigneeSuggestions.map((item) => <button key={item.id} type="button" onMouseDown={(event) => { event.preventDefault(); setAssigneeQuery(personLabel(item)); updateDraft({ assigneeId: item.id, assignee: item.name }); setActiveAutocomplete(null) }}><b>{item.name}</b>{item.role ? <small>{item.role}</small> : null}</button>) : <span>没有匹配的负责人</span>}</div> : null}</div></Field>
                    </div>
                    <div className={Style.twoColumns}>
                      <Field label="验证者"><select value={draft.verifierId || ''} disabled={!yunxiaoReady} onChange={(event) => { const item = options?.verifiers.find((option) => option.id === event.target.value); updateDraft({ verifierId: item?.id || '', verifier: item?.name || '' }) }}><option value="">未选择</option>{options?.verifiers.map((item) => <option key={item.id} value={item.id}>{personLabel(item)}</option>)}</select></Field>
                      <Field label="参与者"><select value={draft.participantIds?.[0] || ''} disabled={!yunxiaoReady} onChange={(event) => { const item = options?.participants.find((option) => option.id === event.target.value); updateDraft({ participantIds: item ? [item.id] : [], participants: item ? [item.name] : [] }) }}><option value="">未选择</option>{options?.participants.map((item) => <option key={item.id} value={item.id}>{personLabel(item)}</option>)}</select></Field>
                    </div>
                    <div className={Style.twoColumns}>
                      <Field label="模块"><textarea value={draft.module || ''} onChange={(event) => updateDraft({ module: event.target.value })} /></Field>
                      <Field label="测试说明"><textarea value={draft.testerNote || ''} onChange={(event) => updateDraft({ testerNote: event.target.value })} /></Field>
                    </div>
                  </div>
                  <div className={Style.saveBar}>
                    <span>{draft.submission?.state === 'submitted' ? '已提交到云效，可继续保存后更新。' : '所有编辑先保存到本机，再按需同步云效。'}</span>
                    <button className={Style.secondaryButton} disabled={isSaving} onClick={saveDraft}>{isSaving ? '保存中...' : '保存本地草稿'}</button>
                    <button className={Style.primaryButton} disabled={!yunxiaoReady || isSubmitting} onClick={submitYunxiao}>{isSubmitting ? '提交中...' : draft.submission?.state === 'submitted' ? '更新云效' : '提交到云效'}</button>
                  </div>
                </>
              ) : <div className={Style.placeholder}><h3>从一条捕获开始</h3><p>选择左侧记录，依据录像、截图和日志补全缺陷草稿。</p></div>}
            </section>
          </section>
        ) : <section className={Style.empty}><h3>启动后进入缺陷工作台</h3><p>本机证据固定保存到 <code>D:\project\collector-data</code>；首次使用时自动创建。</p><p>Collector 会建立 ADB reverse，并等待已安装的 FastBug Android Agent 上报缺陷事件。</p></section>}

        {status.logs.length ? <details className={Style.logs}><summary>Collector 运行日志（最近 {status.logs.length} 条）</summary><pre>{status.logs.join('\n')}</pre></details> : null}
      </div>
    </div>
  )
})

function Field(props: { label: string; children: ReactNode }) {
  return <label className={Style.field}><span>{props.label}</span>{props.children}</label>
}

function Metric(props: { value: number; label: string }) {
  return <div className={Style.metric}><strong>{props.value}</strong><span>{props.label}</span></div>
}

function formatCaptureTime(value: number) {
  return value ? dateFormat(value, 'mm-dd HH:MM') : '时间未知'
}

function formatSubmission(value: string) {
  if (value === 'submitted') return '已提交云效'
  if (value === 'submitting') return '提交中'
  if (value === 'submission_failed') return '云效提交失败'
  return '未提交云效'
}

function captureStatusTags(capture: ICapture) {
  if (capture.status === 'in_progress') {
    return [{ label: capture.progress?.label || '正在采集', kind: 'Pending' }]
  }
  const draftTag = capture.draftStatus === 'confirmed_locally'
    ? { label: '本地已保存', kind: 'Local' }
    : { label: '待完善', kind: 'Pending' }
  const submissionKind = capture.yunxiaoStatus === 'submitted'
    ? 'Submitted'
    : capture.yunxiaoStatus === 'submission_failed'
      ? 'Failed'
      : 'Pending'
  return [draftTag, { label: formatSubmission(capture.yunxiaoStatus), kind: submissionKind }]
}

function formatAgentStatus(status: IFastbugCollectorStatus) {
  if (status.agentStatus === 'synced') {
    return status.agentSessionId === status.sessionId
      ? '已安装 · 会话 ID 已同步'
      : '会话 ID 未一致'
  }
  if (status.agentStatus === 'missing') return '未安装'
  if (status.agentStatus === 'sync_failed') return '同步失败'
  return '待校验'
}

function filterOptions(items: IPersonOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  return items.filter((item) => !normalized || personLabel(item).toLocaleLowerCase().includes(normalized)).slice(0, 12)
}

function personLabel(person?: IPersonOption) {
  if (!person) return ''
  return `${person.name}${person.role ? ` · ${person.role}` : ''}`
}
