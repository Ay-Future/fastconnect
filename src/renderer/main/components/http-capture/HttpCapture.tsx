import { observer } from 'mobx-react-lite'
import Style from './HttpCapture.module.scss'
import LunaToolbar, {
  LunaToolbarButton,
  LunaToolbarInput,
  LunaToolbarSeparator,
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import dateFormat from 'licia/dateFormat'
import copy from 'licia/copy'
import className from 'licia/className'
import trim from 'licia/trim'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  consumeHttpCaptureLogRecord,
  createHttpCapturePendingState,
  IHttpCapturePendingState,
} from 'common/httpCaptureLog'
import { IHttpCaptureEntry } from 'common/types'
import { notify } from 'share/renderer/lib/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import store from '../../store'

const SNAPSHOT_LIMIT = 40
const MAX_ENTRIES = 2000
const LIVE_FLUSH_INTERVAL = 1000
const MAX_PENDING_LIVE_ENTRIES = 100
const SNAPSHOT_POLL_INTERVAL = 4000
const LOGCAT_BUFFER_TTL = 5000
const SAME_REQUEST_WINDOW_MS = 1500

type SourceFilter = 'all' | 'logcat' | 'cache'
type StatusFilter = 'all' | 'success' | 'failed'
type DetailTab = 'overview' | 'request' | 'response' | 'raw'
type ApiStage = 'request' | 'response'

interface ITopPackageState {
  name: string
  label: string
  pid: number
}

interface IEntryDetails {
  requestHeaders: string
  responseHeaders: string
  requestBody: string
  responseBody: string
}

interface ISelectedBadge {
  label: string
  value: string
}

interface IHttpCaptureExportFile {
  schema: 'aya-http-capture'
  version: 1
  exportedAt: number
  exportedAtLabel: string
  appVersion: string
  packageName: string
  packageLabel: string
  source: 'live' | 'imported'
  sourceFile?: string
  total: number
  items: IHttpCaptureEntry[]
}

interface IImportedCaptureState {
  filePath: string
  fileName: string
  exportedAt: number
  exportedAtLabel: string
  packageName: string
  packageLabel: string
}

export default observer(function HttpCapture() {
  const [entries, setEntries] = useState<IHttpCaptureEntry[]>([])
  const [selected, setSelected] = useState<IHttpCaptureEntry | null>(null)
  const [filter, setFilter] = useState('')
  const [reason, setReason] = useState('')
  const [topPackage, setTopPackage] = useState<ITopPackageState>({
    name: '',
    label: '',
    pid: 0,
  })
  const [lockedPackage, setLockedPackage] = useState<ITopPackageState | null>(
    null
  )
  const [followTopPackage, setFollowTopPackage] = useState(true)
  const [paused, setPaused] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('logcat')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [importedCapture, setImportedCapture] =
    useState<IImportedCaptureState | null>(null)
  const logcatIdRef = useRef('')
  const topPackageRef = useRef('')
  const entriesRef = useRef<IHttpCaptureEntry[]>([])
  const selectedIdRef = useRef('')
  const pendingLiveEntriesRef = useRef<IHttpCaptureEntry[]>([])
  const followTopPackageRef = useRef(true)
  const pausedRef = useRef(false)
  const lockedPackageRef = useRef<ITopPackageState | null>(null)
  const importedCaptureRef = useRef<IImportedCaptureState | null>(null)
  const clearedAfterRef = useRef(0)
  const logcatPendingRef = useRef<IHttpCapturePendingState>(
    createHttpCapturePendingState()
  )

  const { device } = store

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    selectedIdRef.current = selected?.id || ''
  }, [selected])

  useEffect(() => {
    followTopPackageRef.current = followTopPackage
  }, [followTopPackage])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    lockedPackageRef.current = lockedPackage
  }, [lockedPackage])

  useEffect(() => {
    importedCaptureRef.current = importedCapture
  }, [importedCapture])

  useEffect(() => {
    let destroyed = false

    async function pollTopPackage() {
      if (!device) {
        if (!destroyed) {
          window.setTimeout(pollTopPackage, 2000)
        }
        return
      }

      if (store.panel === 'httpCapture' && !importedCaptureRef.current) {
        await syncTopPackage()
      }

      if (!destroyed) {
        window.setTimeout(pollTopPackage, 2000)
      }
    }

    pollTopPackage()

    return () => {
      destroyed = true
    }
  }, [device])

  useEffect(() => {
    let destroyed = false

    async function initSnapshot() {
      if (
        !device ||
        store.panel !== 'httpCapture' ||
        importedCaptureRef.current
      ) {
        return
      }

      const activePackage = getActivePackageName()
      if (!activePackage) {
        await syncTopPackage(true)
        return
      }

      await refreshSnapshot(activePackage)
    }

    if (!destroyed) {
      initSnapshot()
    }

    return () => {
      destroyed = true
    }
  }, [device, store.panel])

  useEffect(() => {
    const timer = window.setInterval(() => {
      flushPendingLiveEntries()
    }, LIVE_FLUSH_INTERVAL)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let destroyed = false
    let timer = 0

    async function pollSnapshot() {
      if (destroyed) {
        return
      }

      if (
        store.panel === 'httpCapture' &&
        !pausedRef.current &&
        !importedCaptureRef.current
      ) {
        const activePackage = getActivePackageName()
        if (device && activePackage) {
          await refreshSnapshot(activePackage)
        }
      }

      if (!destroyed) {
        timer = window.setTimeout(pollSnapshot, SNAPSHOT_POLL_INTERVAL)
      }
    }

    timer = window.setTimeout(pollSnapshot, SNAPSHOT_POLL_INTERVAL)

    return () => {
      destroyed = true
      window.clearTimeout(timer)
    }
  }, [device, store.panel])

  useEffect(() => {
    function onLogcatEntry(id, entry) {
      if (id !== logcatIdRef.current) {
        return
      }

      const item = parseLogcatEntry(
        entry,
        getActivePackageName(),
        logcatPendingRef.current
      )
      if (
        importedCaptureRef.current ||
        !item ||
        !shouldKeepEntry(item, clearedAfterRef.current)
      ) {
        return
      }

      const pending = pendingLiveEntriesRef.current
      pending.unshift(item)
      if (pending.length > MAX_PENDING_LIVE_ENTRIES) {
        pending.length = MAX_PENDING_LIVE_ENTRIES
      }
    }

    const offLogcatEntry = main.on('logcatEntry', onLogcatEntry)

    if (device) {
      main.openLogcat(device.id).then((id) => {
        logcatIdRef.current = id
        if (store.panel !== 'httpCapture') {
          main.pauseLogcat(id)
        }
      })
    }

    return () => {
      offLogcatEntry()
      if (logcatIdRef.current) {
        main.closeLogcat(logcatIdRef.current)
      }
    }
  }, [device])

  useEffect(() => {
    if (!logcatIdRef.current) {
      return
    }

    if (store.panel === 'httpCapture' && !paused && !importedCapture) {
      main.resumeLogcat(logcatIdRef.current)
    } else {
      main.pauseLogcat(logcatIdRef.current)
    }
  }, [importedCapture, paused, store.panel])

  async function syncTopPackage(forceSnapshot = false) {
    if (!device) {
      return
    }

    try {
      const currentTop = await main.getTopPackage(device.id)
      const packageName = currentTop.name || ''

      if (!packageName) {
        topPackageRef.current = ''
        setTopPackage({
          name: '',
          label: '',
          pid: 0,
        })
        if (followTopPackageRef.current) {
          setReason('未识别到前台应用进程')
        }
        return
      }

      let label = packageName
      const isTopPackageChanged = topPackageRef.current !== packageName

      if (isTopPackageChanged) {
        try {
          const infos = await main.getPackageInfos(device.id, [packageName])
          label = infos[0]?.label || packageName
        } catch {
          // ignore label fetch errors
        }
      } else {
        label = topPackage.label || packageName
      }

      topPackageRef.current = packageName
      setTopPackage({
        name: packageName,
        label,
        pid: currentTop.pid || 0,
      })

      const nextTopPackage = {
        name: packageName,
        label,
        pid: currentTop.pid || 0,
      }

      if (!lockedPackageRef.current) {
        setLockedPackage(nextTopPackage)
      }

      if (followTopPackageRef.current && isTopPackageChanged) {
        setLockedPackage(nextTopPackage)
        clearedAfterRef.current = 0
        clearEntries(false)
        await refreshSnapshot(packageName)
        return
      }

      if (forceSnapshot && getActivePackageName()) {
        await refreshSnapshot(getActivePackageName())
      }
    } catch {
      setReason('读取前台应用失败')
    }
  }

  async function refreshSnapshot(packageName = topPackageRef.current) {
    if (!device || !packageName) {
      return
    }

    try {
      const [logResult, cacheResult] = await Promise.all([
        main.getHttpCaptureLogSnapshot(device.id, packageName, SNAPSHOT_LIMIT),
        main.getHttpCaptureSnapshot(device.id, packageName, SNAPSHOT_LIMIT),
      ])
      const nextEntries = mergeEntries(
        filterEntriesAfterClearTime(
          [...logResult.items, ...cacheResult.items, ...entriesRef.current],
          clearedAfterRef.current
        )
      )
      pendingLiveEntriesRef.current = []
      updateEntries(nextEntries)

      const reasons = [logResult, cacheResult]
        .filter((result) => result.reason && !result.items.length)
        .map((result) => result.reason)
      setReason(reasons.join('；'))
    } catch {
      setReason('读取接口快照失败')
    }
  }

  function clearEntries(clearPending = true) {
    if (clearPending) {
      pendingLiveEntriesRef.current = []
    }
    logcatPendingRef.current = createHttpCapturePendingState()
    setReason('')
    selectedIdRef.current = ''
    entriesRef.current = []
    setEntries([])
    setSelected(null)
    setDetailTab('overview')
  }

  function clearCapturedEntries() {
    if (importedCaptureRef.current) {
      clearEntries()
      setReason('导入列表已清空')
      return
    }

    clearedAfterRef.current = Date.now()
    clearEntries()
    setReason('列表已清空，仅展示清空之后的新请求')
  }

  function flushPendingLiveEntries() {
    if (
      pausedRef.current ||
      store.panel !== 'httpCapture' ||
      !pendingLiveEntriesRef.current.length
    ) {
      return
    }

    const nextItems = pendingLiveEntriesRef.current.splice(
      0,
      pendingLiveEntriesRef.current.length
    )
    const merged = mergeEntries(
      filterEntriesAfterClearTime(
        [...nextItems, ...entriesRef.current],
        clearedAfterRef.current
      )
    )
    updateEntries(merged)
  }

  function updateEntries(nextEntries: IHttpCaptureEntry[]) {
    entriesRef.current = nextEntries
    setEntries(nextEntries)

    if (!nextEntries.length) {
      selectedIdRef.current = ''
      if (selected) {
        setSelected(null)
      }
      return
    }

    if (!selectedIdRef.current) {
      selectedIdRef.current = nextEntries[0].id
      setSelected(nextEntries[0])
      return
    }

    const nextSelected = nextEntries.find(
      (item) => item.id === selectedIdRef.current
    )
    if (nextSelected) {
      if (nextSelected !== selected) {
        setSelected(nextSelected)
      }
      return
    }

    selectedIdRef.current = nextEntries[0].id
    if (nextEntries[0] !== selected) {
      setSelected(nextEntries[0])
    }
  }

  function getActivePackageName() {
    if (followTopPackageRef.current) {
      return topPackageRef.current
    }

    return lockedPackageRef.current?.name || ''
  }

  function lockCurrentPackage() {
    if (!topPackage.name) {
      notify('当前没有可锁定的前台应用', { icon: 'error' })
      return
    }

    setFollowTopPackage(false)
    setLockedPackage(topPackage)
    clearedAfterRef.current = 0
    pendingLiveEntriesRef.current = []
    clearEntries(false)
    refreshSnapshot(topPackage.name)
  }

  function useTopPackageTracking() {
    setFollowTopPackage(true)
    setLockedPackage(topPackage.name ? topPackage : null)
    clearedAfterRef.current = 0
    pendingLiveEntriesRef.current = []
    clearEntries(false)
    if (topPackage.name) {
      refreshSnapshot(topPackage.name)
    }
  }

  function copySelected() {
    if (!selected) {
      return
    }

    copy(selected.raw || selected.url)
    notify('已复制当前请求内容', { icon: 'success' })
  }

  async function exportEntries() {
    const items = entriesRef.current
    if (!items.length) {
      notify('暂无可导出的记录', { icon: 'error' })
      return
    }

    const defaultPath = buildExportFileName(
      importedCapture?.packageName ||
        getActivePackageName() ||
        topPackage.name ||
        'http-capture'
    )
    const { canceled, filePath } = await main.showSaveDialog({
      defaultPath,
      filters: [{ name: 'HTTP Capture JSON', extensions: ['json'] }],
    })

    if (canceled || !filePath) {
      return
    }

    const payload: IHttpCaptureExportFile = {
      schema: 'aya-http-capture',
      version: 1,
      exportedAt: Date.now(),
      exportedAtLabel: formatImportedTimestamp(Date.now()),
      appVersion: VERSION,
      packageName:
        importedCapture?.packageName || getActivePackageName() || topPackage.name,
      packageLabel:
        importedCapture?.packageLabel ||
        (followTopPackage
          ? topPackage.label || topPackage.name
          : lockedPackage?.label || lockedPackage?.name || ''),
      source: importedCapture ? 'imported' : 'live',
      sourceFile: importedCapture?.filePath,
      total: items.length,
      items,
    }

    await node.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    notify(`已导出 ${items.length} 条记录`, { icon: 'success' })
  }

  async function importEntries() {
    const { canceled, filePaths } = await main.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'HTTP Capture JSON', extensions: ['json'] }],
    })

    if (canceled || !filePaths.length) {
      return
    }

    const filePath = filePaths[0]

    try {
      const content = decodeFileContent(await node.readFile(filePath))
      const parsed = normalizeImportedCaptureFile(JSON.parse(content))
      const nextImportedCapture: IImportedCaptureState = {
        filePath,
        fileName: getFileName(filePath),
        exportedAt: parsed.exportedAt,
        exportedAtLabel: parsed.exportedAtLabel,
        packageName: parsed.packageName,
        packageLabel: parsed.packageLabel,
      }

      setImportedCapture(nextImportedCapture)
      importedCaptureRef.current = nextImportedCapture
      clearedAfterRef.current = 0
      pendingLiveEntriesRef.current = []
      clearEntries(false)
      updateEntries(mergeEntries(parsed.items))
      setReason(
        parsed.items.length
          ? `已导入 ${parsed.items.length} 条记录，可直接查看详情`
          : '导入文件中没有可展示的记录'
      )
      notify(`已导入 ${parsed.items.length} 条记录`, { icon: 'success' })
    } catch (err) {
      notify(`导入失败：${getErrorMessage(err)}`, { icon: 'error' })
    }
  }

  async function exitImportedView() {
    setImportedCapture(null)
    importedCaptureRef.current = null
    clearedAfterRef.current = 0
    pendingLiveEntriesRef.current = []
    clearEntries()

    const activePackage = getActivePackageName()
    if (activePackage) {
      await refreshSnapshot(activePackage)
      return
    }

    await syncTopPackage(true)
  }

  const filteredEntries = useMemo(() => {
    return entries.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) {
        return false
      }

      if (statusFilter !== 'all' && !matchesStatus(item, statusFilter)) {
        return false
      }

      if (!filter) {
        return true
      }

      return matchesSearch(item, filter)
    })
  }, [entries, filter, sourceFilter, statusFilter])

  useEffect(() => {
    if (!filteredEntries.length) {
      return
    }

    if (!selected || !filteredEntries.some((item) => item.id === selected.id)) {
      selectedIdRef.current = filteredEntries[0].id
      setSelected(filteredEntries[0])
    }
  }, [filteredEntries, selected])

  const liveCount = entries.filter((item) => item.source === 'logcat').length
  const cacheCount = entries.filter((item) => item.source === 'cache').length
  const isImportedView = Boolean(importedCapture)
  const selectedDetails = useMemo(
    () => (selected ? inspectEntry(selected) : null),
    [selected]
  )

  return (
    <div className={className('panel-with-toolbar', Style.panelRoot)}>
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarInput
          keyName="filter"
          value={filter}
          placeholder="搜索 Host / Path / 方法 / 参数 / 返回"
          onChange={(val) => setFilter(val)}
        />
        <LunaToolbarText
          text={
            importedCapture
              ? `导入文件：${importedCapture.fileName}`
              : followTopPackage
              ? `跟随前台：${topPackage.label || topPackage.name || '未识别'}`
              : `已锁定：${
                  lockedPackage?.label || lockedPackage?.name || '未锁定'
                }`
          }
        />
        <LunaToolbarText
          text={
            importedCapture
              ? `总数 ${entries.length} / 命中 ${filteredEntries.length} / 日志 ${liveCount} / 缓存 ${cacheCount} / 导出时间 ${
                  importedCapture.exportedAtLabel || '未知'
                }`
              : `总数 ${entries.length} / 命中 ${filteredEntries.length} / 日志 ${liveCount} / 缓存 ${cacheCount}`
          }
        />
        <LunaToolbarSeparator />
        <LunaToolbarButton
          state={sourceFilter === 'all' ? 'active' : ''}
          onClick={() => setSourceFilter('all')}
        >
          全部
        </LunaToolbarButton>
        <LunaToolbarButton
          state={sourceFilter === 'logcat' ? 'active' : ''}
          onClick={() => setSourceFilter('logcat')}
        >
          日志
        </LunaToolbarButton>
        <LunaToolbarButton
          state={sourceFilter === 'cache' ? 'active' : ''}
          onClick={() => setSourceFilter('cache')}
        >
          缓存
        </LunaToolbarButton>
        <LunaToolbarSeparator />
        <LunaToolbarButton
          state={statusFilter === 'all' ? 'active' : ''}
          onClick={() => setStatusFilter('all')}
        >
          全部状态
        </LunaToolbarButton>
        <LunaToolbarButton
          state={statusFilter === 'success' ? 'active' : ''}
          onClick={() => setStatusFilter('success')}
        >
          成功
        </LunaToolbarButton>
        <LunaToolbarButton
          state={statusFilter === 'failed' ? 'active' : ''}
          onClick={() => setStatusFilter('failed')}
        >
          失败
        </LunaToolbarButton>
        <LunaToolbarSpace />
        <LunaToolbarButton
          disabled={!topPackage.name || !followTopPackage || isImportedView}
          onClick={lockCurrentPackage}
        >
          锁定当前应用
        </LunaToolbarButton>
        <LunaToolbarButton
          disabled={followTopPackage || isImportedView}
          onClick={useTopPackageTracking}
        >
          跟随前台
        </LunaToolbarButton>
        <LunaToolbarButton
          disabled={!device || !getActivePackageName() || isImportedView}
          onClick={() => refreshSnapshot()}
        >
          刷新快照
        </LunaToolbarButton>
        <LunaToolbarButton
          disabled={isImportedView}
          onClick={() => setPaused((val) => !val)}
        >
          {paused ? '继续实时' : '暂停实时'}
        </LunaToolbarButton>
        <LunaToolbarButton disabled={!entries.length} onClick={exportEntries}>
          导出记录
        </LunaToolbarButton>
        <LunaToolbarButton onClick={importEntries}>导入记录</LunaToolbarButton>
        <LunaToolbarButton
          disabled={!isImportedView}
          onClick={exitImportedView}
        >
          退出导入
        </LunaToolbarButton>
        <ToolbarIcon
          disabled={!selected}
          icon="copy"
          title="复制当前请求内容"
          onClick={copySelected}
        />
        <ToolbarIcon
          disabled={!selected}
          icon="browser"
          title="浏览器打开"
          onClick={() => selected && main.openExternal(selected.url)}
        />
        <LunaToolbarButton disabled={!entries.length} onClick={clearCapturedEntries}>
          清空列表
        </LunaToolbarButton>
      </LunaToolbar>
      <div className={Style.container}>
        <div className={Style.listPane}>
          <div className={Style.listHeader}>
            <span className={Style.colTime}>时间</span>
            <span className={Style.colMethod}>方法</span>
            <span className={Style.colResult}>状态</span>
            <span className={Style.colHost}>Host</span>
            <span className={Style.colPath}>路由</span>
            <span className={Style.colDuration}>耗时</span>
            <span className={Style.colSource}>来源</span>
          </div>
          <div className={Style.listBody}>
            {filteredEntries.length ? (
              filteredEntries.map((item) => {
                const host = getUrlHost(item.url) || '(unknown host)'
                const path = getUrlPath(item.url)

                return (
                  <button
                    key={item.id}
                    className={className(Style.listRow, {
                      [Style.listRowSelected]: selected?.id === item.id,
                    })}
                    onClick={() => {
                      selectedIdRef.current = item.id
                      setSelected(item)
                    }}
                  >
                    <span className={Style.colTime}>{formatClock(item.time)}</span>
                    <span className={Style.colMethod}>
                      <span className={Style.methodBadge}>
                        {item.method || '-'}
                      </span>
                    </span>
                    <span className={Style.colResult}>
                      <span
                        className={className(Style.resultBadge, {
                          [Style.resultBadgeSuccess]: isSuccess(item),
                          [Style.resultBadgeFailed]: isFailed(item),
                        })}
                      >
                        {item.code || item.status || '-'}
                      </span>
                    </span>
                    <span className={Style.colHost}>{host}</span>
                    <span className={Style.colPath}>{path}</span>
                    <span className={Style.colDuration}>
                      {item.durationMs ? `${item.durationMs}ms` : '-'}
                    </span>
                    <span className={Style.colSource}>{item.sourceLabel}</span>
                  </button>
                )
              })
            ) : (
              <div className={Style.emptyState}>
                <div className={Style.emptyTitle}>
                  {entries.length
                    ? '当前筛选条件下没有请求'
                    : '暂无可展示的接口记录'}
                </div>
                <div className={Style.emptyText}>
                  {reason || '先触发一次请求，或点击“刷新快照”抓取最近历史'}
                </div>
                {isImportedView ? (
                  <div className={Style.emptyMeta}>
                    导入文件：{importedCapture?.fileName}
                  </div>
                ) : getActivePackageName() ? (
                  <div className={Style.emptyMeta}>
                    当前目标：
                    {followTopPackage
                      ? topPackage.label || topPackage.name
                      : lockedPackage?.label || lockedPackage?.name}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className={Style.detailPane}>
          {selected ? (
            <>
              <div className={Style.detailHeader}>
                <div className={Style.detailTitle}>{selected.method || '-'}</div>
                <div className={Style.detailSubtitle}>{selected.url}</div>
                <div className={Style.badgeRow}>
                  {detailBadges(selected).map((badge) => (
                    <span key={badge.label} className={Style.detailBadge}>
                      <span className={Style.detailBadgeLabel}>
                        {badge.label}
                      </span>
                      <span className={Style.detailBadgeValue}>
                        {badge.value}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <div className={Style.tabBar}>
                {[
                  ['overview', '概览'],
                  ['request', '请求'],
                  ['response', '响应'],
                  ['raw', '原始'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={className(Style.tabButton, {
                      [Style.tabButtonActive]: detailTab === key,
                    })}
                    onClick={() => setDetailTab(key as DetailTab)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className={className(Style.tabButton, Style.curlButton)}
                  onClick={() => selected && copyCurl(selected, selectedDetails)}
                >
                  curl
                </button>
              </div>

              <div className={Style.detailBody}>
                {detailTab === 'overview' ? (
                  <>
                    <div className={Style.metaGrid}>
                      <div className={Style.metaCard}>
                        <div className={Style.metaLabel}>来源</div>
                        <div className={Style.metaValue}>{selected.sourceLabel}</div>
                      </div>
                      <div className={Style.metaCard}>
                        <div className={Style.metaLabel}>时间</div>
                        <div className={Style.metaValue}>{selected.timeLabel}</div>
                      </div>
                      <div className={Style.metaCard}>
                        <div className={Style.metaLabel}>包名</div>
                        <div className={Style.metaValue}>
                          {selected.packageName}
                        </div>
                      </div>
                      <div className={Style.metaCard}>
                        <div className={Style.metaLabel}>结果</div>
                        <div className={Style.metaValue}>
                          {selected.code || selected.status || '-'}
                        </div>
                      </div>
                      <div className={Style.metaCard}>
                        <div className={Style.metaLabel}>耗时</div>
                        <div className={Style.metaValue}>
                          {selected.durationMs ? `${selected.durationMs}ms` : '-'}
                        </div>
                      </div>
                      <div className={Style.metaCard}>
                        <div className={Style.metaLabel}>Path</div>
                        <div className={Style.metaValue}>
                          {getUrlPath(selected.url)}
                        </div>
                      </div>
                    </div>

                    <Section
                      title="请求参数"
                      content={selectedDetails?.requestBody}
                      onCopy={copyDetail}
                    />
                    <Section
                      title="接口返回"
                      content={selectedDetails?.responseBody}
                      onCopy={copyDetail}
                    />
                  </>
                ) : null}

                {detailTab === 'request' ? (
                  <>
                    <Section
                      title="请求头"
                      content={selectedDetails?.requestHeaders}
                      onCopy={copyDetail}
                    />
                    <Section
                      title="请求体"
                      content={selectedDetails?.requestBody}
                      onCopy={copyDetail}
                    />
                    <Section title="完整 URL" content={selected.url} onCopy={copyDetail} />
                  </>
                ) : null}

                {detailTab === 'response' ? (
                  <>
                    <Section
                      title="响应概览"
                      content={`${selected.code || '-'}${selected.status ? ` / ${selected.status}` : ''}${
                        selected.durationMs ? ` / ${selected.durationMs}ms` : ''
                      }`}
                      onCopy={copyDetail}
                    />
                    <Section
                      title="响应头"
                      content={selectedDetails?.responseHeaders}
                      onCopy={copyDetail}
                    />
                    <Section
                      title="响应体"
                      content={selectedDetails?.responseBody}
                      onCopy={copyDetail}
                    />
                  </>
                ) : null}

                {detailTab === 'raw' ? (
                  <Section title="原始内容" content={selected.raw} onCopy={copyDetail} />
                ) : null}
              </div>
            </>
          ) : (
            <div className={Style.detailEmpty}>
              左侧选择一条请求，在这里查看参数、返回和原始日志
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

function Section({
  title,
  content,
  onCopy,
}: {
  title: string
  content?: string
  onCopy?: (title: string, content: string) => void
}) {
  const text = content || ''
  const canCopy = Boolean(text)

  return (
    <div className={Style.section}>
      <div className={Style.sectionHeader}>
        <h3 className={Style.sectionTitle}>{title}</h3>
        <button
          className={Style.sectionCopy}
          disabled={!canCopy}
          onClick={() => onCopy?.(title, text)}
        >
          复制
        </button>
      </div>
      <pre className={Style.sectionBody}>{content ? content : '暂无内容'}</pre>
    </div>
  )
}

function mergeEntries(items: IHttpCaptureEntry[]) {
  const seen = new Set<string>()
  const merged: IHttpCaptureEntry[] = []

  const deduped = items
    .sort((a, b) => b.time - a.time)
    .filter((item) => {
      if (!item.id || seen.has(item.id)) {
        return false
      }
      seen.add(item.id)
      return true
    })

  for (const item of deduped) {
    const matchIndex = merged.findIndex((current) =>
      shouldMergeEquivalentEntries(current, item)
    )

    if (matchIndex === -1) {
      merged.push(item)
      continue
    }

    merged[matchIndex] = mergeEquivalentEntry(merged[matchIndex], item)
  }

  return merged
    .sort((a, b) => b.time - a.time)
    .slice(0, MAX_ENTRIES)
}

function filterEntriesAfterClearTime(
  items: IHttpCaptureEntry[],
  clearedAfterTime: number
) {
  if (!clearedAfterTime) {
    return items
  }

  return items.filter((item) => shouldKeepEntry(item, clearedAfterTime))
}

function shouldKeepEntry(
  item: IHttpCaptureEntry,
  clearedAfterTime: number
) {
  if (!clearedAfterTime) {
    return true
  }

  return item.time > clearedAfterTime
}

function buildExportFileName(packageName: string) {
  return `${sanitizeFileName(packageName || 'http-capture')}-${dateFormat(
    Date.now(),
    'yyyymmddHHMMss'
  )}.aya-http.json`
}

function sanitizeFileName(value: string) {
  return trim(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function decodeFileContent(content: Uint8Array | string) {
  if (typeof content === 'string') {
    return content
  }

  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(content)
  }

  let result = ''
  for (let i = 0; i < content.length; i++) {
    result += String.fromCharCode(content[i])
  }

  return result
}

function normalizeImportedCaptureFile(data: any) {
  if (Array.isArray(data)) {
    return {
      exportedAt: 0,
      exportedAtLabel: '',
      packageName: '',
      packageLabel: '',
      items: normalizeImportedEntries(data),
    }
  }

  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.entries)
    ? data.entries
    : null

  if (!items) {
    throw new Error('文件格式不正确，未找到记录列表')
  }

  const exportedAt = toFiniteNumber(data?.exportedAt)

  return {
    exportedAt,
    exportedAtLabel:
      trim(String(data?.exportedAtLabel || '')) ||
      (exportedAt ? formatImportedTimestamp(exportedAt) : ''),
    packageName: trim(String(data?.packageName || '')),
    packageLabel: trim(String(data?.packageLabel || '')),
    items: normalizeImportedEntries(items),
  }
}

function normalizeImportedEntries(items: any[]) {
  const fallbackStart = Date.now()

  return items
    .map((item, index) => normalizeImportedEntry(item, fallbackStart - index))
    .filter(Boolean) as IHttpCaptureEntry[]
}

function normalizeImportedEntry(
  item: any,
  fallbackTime: number
): IHttpCaptureEntry | null {
  const url = trim(String(item?.url || ''))
  if (!url) {
    return null
  }

  const source = item?.source === 'cache' ? 'cache' : 'logcat'
  const time = toFiniteNumber(item?.time) || fallbackTime
  const sourceLabel =
    trim(String(item?.sourceLabel || '')) || (source === 'cache' ? '缓存' : '日志')

  return {
    id: trim(String(item?.id || '')) || `${source}:${time}:${url}`,
    source,
    sourceLabel,
    packageName: trim(String(item?.packageName || '')),
    time,
    timeLabel: trim(String(item?.timeLabel || '')) || formatEntryTimeLabel(time),
    method: trim(String(item?.method || '')),
    status: trim(String(item?.status || '')),
    code: trim(String(item?.code || '')),
    durationMs: toFiniteNumber(item?.durationMs),
    url,
    requestPreview: String(item?.requestPreview || ''),
    responsePreview: String(item?.responsePreview || ''),
    raw: String(item?.raw || ''),
  }
}

function toFiniteNumber(value: any) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function formatEntryTimeLabel(time: number) {
  return dateFormat(time, 'mm-dd HH:MM:ss.l')
}

function formatImportedTimestamp(time: number) {
  return dateFormat(time, 'yyyy-mm-dd HH:MM:ss')
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message
  }

  return '未知错误'
}

function parseLogcatEntry(
  entry: any,
  currentPackage: string,
  pendingState: IHttpCapturePendingState
) {
  const packageName = String(entry.package || '')
  if (!matchesPackage(packageName, currentPackage)) {
    return null
  }

  return consumeHttpCaptureLogRecord(
    {
      packageName,
      pid: Number(entry.pid) || 0,
      tid: Number(entry.tid) || 0,
      time: Number(entry.date) || Date.now(),
      tag: String(entry.tag || ''),
      message: String(entry.message || ''),
    },
    pendingState,
    {
      apiLabel: '接口',
      otelLabel: '日志',
      staleMs: LOGCAT_BUFFER_TTL,
    }
  )
}

function matchesPackage(packageName: string, currentPackage: string) {
  if (!packageName || !currentPackage) {
    return false
  }

  return (
    packageName === currentPackage ||
    packageName.startsWith(`${currentPackage}:`)
  )
}

function matchesStatus(entry: IHttpCaptureEntry, filter: StatusFilter) {
  if (filter === 'all') {
    return true
  }

  const success = isSuccess(entry)
  return filter === 'success' ? success : !success
}

function isSuccess(entry: IHttpCaptureEntry) {
  return (
    entry.status === 'success' ||
    entry.code === '00000' ||
    /^2\d\d$/.test(entry.code) ||
    /^HTTP\/\S+\s+2\d\d/.test(entry.status)
  )
}

function isFailed(entry: IHttpCaptureEntry) {
  if (!entry.status && !entry.code) {
    return false
  }

  return !isSuccess(entry)
}

function matchesSearch(entry: IHttpCaptureEntry, keyword: string) {
  const query = trim(keyword).toLowerCase()
  if (!query) {
    return true
  }

  const haystack = [
    entry.url,
    getUrlHost(entry.url),
    getUrlPath(entry.url),
    entry.method,
    entry.code,
    entry.status,
    entry.packageName,
    entry.sourceLabel,
    entry.requestPreview,
    entry.responsePreview,
    entry.raw,
  ]
    .join('\n')
    .toLowerCase()

  return haystack.includes(query)
}

function detailBadges(entry: IHttpCaptureEntry): ISelectedBadge[] {
  return [
    { label: '来源', value: entry.sourceLabel },
    { label: '状态', value: entry.code || entry.status || '-' },
    { label: '耗时', value: entry.durationMs ? `${entry.durationMs}ms` : '-' },
    { label: 'Host', value: getUrlHost(entry.url) || '-' },
  ]
}

function inspectEntry(entry: IHttpCaptureEntry): IEntryDetails {
  if (entry.source !== 'logcat') {
    return {
      requestHeaders: '',
      responseHeaders: '',
      requestBody: prettifyPreview(entry.requestPreview),
      responseBody: prettifyPreview(entry.responsePreview),
    }
  }

  return {
    requestHeaders: extractApiSection(entry.raw, 'request'),
    responseHeaders: extractApiSection(entry.raw, 'response'),
    requestBody: prettifyPreview(entry.requestPreview),
    responseBody: prettifyPreview(entry.responsePreview),
  }
}

function copyCurl(
  entry: IHttpCaptureEntry,
  details: IEntryDetails | null
) {
  const command = buildCurlCommand(entry, details)
  copy(command)
  notify('curl 已复制', { icon: 'success' })
}

function buildCurlCommand(
  entry: IHttpCaptureEntry,
  details: IEntryDetails | null
) {
  const method = trim(entry.method || 'GET').toUpperCase() || 'GET'
  const headers = parseHeaderLines(details?.requestHeaders || '')
  const body = trim(details?.requestBody || entry.requestPreview || '')
  const hasContentType = headers.some((header) =>
    /^content-type\s*:/i.test(header)
  )
  const parts = [`curl -X ${escapeShellArg(method)}`]

  for (const header of headers) {
    if (!header) {
      continue
    }
    if (/^content-length\s*:/i.test(header)) {
      continue
    }
    parts.push(`  -H ${escapeShellArg(header)}`)
  }

  if (body && !hasContentType && looksJsonBody(body)) {
    parts.push(
      `  -H ${escapeShellArg('Content-Type: application/json; charset=UTF-8')}`
    )
  }

  if (body && method !== 'GET') {
    parts.push(`  --data-raw ${escapeShellArg(body)}`)
  }

  parts.push(`  ${escapeShellArg(entry.url)}`)

  return parts.join(' \\\n')
}

function parseHeaderLines(headersText: string) {
  return headersText
    .split('\n')
    .map((line) => trim(line))
    .filter(Boolean)
}

function looksJsonBody(body: string) {
  const text = trim(body)
  return (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  )
}

function escapeShellArg(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function extractApiSection(raw: string, stage: ApiStage) {
  const lines = raw.split('\n')
  const result: string[] = []
  let capture = false
  let currentStage: ApiStage = 'request'

  for (const rawLine of lines) {
    const parsed = parseApiLogLine(rawLine)
    if (!parsed) {
      continue
    }

    const content = parsed.content

    if (content.startsWith('Status Code:') || /Received in:/i.test(content)) {
      currentStage = 'response'
      capture = false
      continue
    }

    if (content.startsWith('Headers:')) {
      capture = currentStage === stage
      continue
    }

    if (content.startsWith('Body:')) {
      capture = false
      continue
    }

    if (!capture) {
      continue
    }

    const headerLine = normalizeHeaderLine(content)
    if (!headerLine) {
      continue
    }

    result.push(headerLine)
  }

  return result.join('\n')
}

function parseApiLogLine(rawLine: string) {
  const match = rawLine.match(/^\s*(\d+)\s+[│|]\s?(.*)$/)
  if (!match) {
    return null
  }

  return {
    requestId: match[1],
    content: trim(match[2]),
  }
}

function normalizeHeaderLine(content: string) {
  const line = trim(content.replace(/^[┌├└│]\s?/, ''))
  return line
}

function prettifyPreview(value: string) {
  const text = trim(value)
  if (!text) {
    return ''
  }

  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }

  return text
}

function copyDetail(title: string, content: string) {
  if (!content) {
    notify(`暂无可复制的${title}`, { icon: 'error' })
    return
  }

  copy(content)
  notify(`${title}已复制`, { icon: 'success' })
}

function shouldMergeEquivalentEntries(
  left: IHttpCaptureEntry,
  right: IHttpCaptureEntry
) {
  if (!isInterfaceLogPair(left, right)) {
    return false
  }

  if (left.packageName !== right.packageName) {
    return false
  }

  if (normalizeMethod(left.method) !== normalizeMethod(right.method)) {
    return false
  }

  if (normalizeUrl(left.url) !== normalizeUrl(right.url)) {
    return false
  }

  if (Math.abs(left.time - right.time) > SAME_REQUEST_WINDOW_MS) {
    return false
  }

  const requestMatched = isComparablePayloadEqual(
    left.requestPreview,
    right.requestPreview
  )
  const responseMatched = isComparablePayloadEqual(
    left.responsePreview,
    right.responsePreview
  )

  return requestMatched || responseMatched
}

function mergeEquivalentEntry(
  left: IHttpCaptureEntry,
  right: IHttpCaptureEntry
): IHttpCaptureEntry {
  const preferred =
    compareEntryPriority(left, right) >= 0 ? left : right
  const fallback = preferred === left ? right : left

  return {
    ...preferred,
    time: Math.max(left.time, right.time),
    timeLabel:
      left.time >= right.time ? left.timeLabel : right.timeLabel,
    durationMs: preferred.durationMs || fallback.durationMs,
    code: preferred.code || fallback.code,
    status: preferred.status || fallback.status,
    requestPreview: preferred.requestPreview || fallback.requestPreview,
    responsePreview: preferred.responsePreview || fallback.responsePreview,
    raw:
      preferred.raw.length >= fallback.raw.length ? preferred.raw : fallback.raw,
  }
}

function compareEntryPriority(left: IHttpCaptureEntry, right: IHttpCaptureEntry) {
  return scoreEntry(left) - scoreEntry(right)
}

function scoreEntry(entry: IHttpCaptureEntry) {
  let score = 0

  if (entry.sourceLabel === '接口') {
    score += 100
  } else if (entry.sourceLabel === '日志') {
    score += 50
  }

  if (entry.requestPreview) {
    score += 10
  }
  if (entry.responsePreview) {
    score += 10
  }
  if (entry.code) {
    score += 5
  }
  if (entry.status) {
    score += 5
  }
  if (entry.raw) {
    score += Math.min(entry.raw.length, 1000) / 1000
  }

  return score
}

function isInterfaceLogPair(left: IHttpCaptureEntry, right: IHttpCaptureEntry) {
  return (
    (left.sourceLabel === '接口' && right.sourceLabel === '日志') ||
    (left.sourceLabel === '日志' && right.sourceLabel === '接口')
  )
}

function normalizeMethod(method: string) {
  return trim(method).toUpperCase()
}

function normalizeUrl(url: string) {
  return trim(url)
}

function isComparablePayloadEqual(left: string, right: string) {
  const normalizedLeft = normalizeComparablePayload(left)
  const normalizedRight = normalizeComparablePayload(right)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  return normalizedLeft === normalizedRight
}

function normalizeComparablePayload(value: string) {
  const text = trim(value)
  if (!text) {
    return ''
  }

  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      return stableStringify(JSON.parse(text))
    } catch {
      return text.replace(/\s+/g, ' ')
    }
  }

  return text.replace(/\s+/g, ' ')
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function formatClock(time: number) {
  return dateFormat(time, 'HH:MM:ss.l')
}

function getUrlHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function getUrlPath(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}
