import singleton from 'licia/singleton'
import trim from 'licia/trim'
import { getPidNames, shell } from './base'
import { handleEvent } from 'share/main/lib/util'
import {
  consumeHttpCaptureLogRecord,
  createHttpCapturePendingState,
  flushHttpCapturePendingState,
  parseThreadtimeLine,
} from 'common/httpCaptureLog'
import {
  IHttpCaptureEntry,
  IHttpCaptureSnapshotResult,
  IpcGetHttpCaptureLogSnapshot,
  IpcGetHttpCaptureSnapshot,
} from 'common/types'

const DEFAULT_LIMIT = 40
const LOGCAT_SNAPSHOT_LINE_COUNT = 6000

const getHttpCaptureSnapshot = singleton(<IpcGetHttpCaptureSnapshot>(async (
  deviceId: string,
  pkg: string,
  limit = DEFAULT_LIMIT
) => {
  const result: IHttpCaptureSnapshotResult = {
    items: [],
    reason: '',
    packageName: pkg,
  }

  if (!pkg) {
    result.reason = '未识别到前台应用包名'
    return result
  }

  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(limit, 200))
    : DEFAULT_LIMIT
  const listing = await shell(deviceId, `run-as ${pkg} ls -lt cache/http`)

  if (isRunAsError(listing)) {
    result.reason = `无法读取 ${pkg} 私有缓存：${listing}`
    return result
  }

  const files = listing
    .split('\n')
    .map((line) => trim(line))
    .filter((line) => /\.0$/.test(line))
    .map((line) => line.split(/\s+/).at(-1) || '')
    .filter(Boolean)
    .slice(0, normalizedLimit)

  if (!files.length) {
    result.reason = `${pkg} 当前未发现 OkHttp 缓存`
    return result
  }

  const raws = (await shell(
    deviceId,
    files.map((file) => `run-as ${pkg} cat cache/http/${file}`)
  )) as string[]

  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]
    if (!raw || isRunAsError(raw)) {
      continue
    }

    const item = parseCacheEntry(pkg, files[i], raw)
    if (item) {
      result.items.push(item)
    }
  }

  if (!result.items.length) {
    result.reason = `${pkg} 缓存目录可访问，但未解析到有效请求`
  }

  return result
}))

const getHttpCaptureLogSnapshot = singleton(<IpcGetHttpCaptureLogSnapshot>(async (
  deviceId: string,
  pkg: string,
  limit = DEFAULT_LIMIT
) => {
  const result: IHttpCaptureSnapshotResult = {
    items: [],
    reason: '',
    packageName: pkg,
  }

  if (!pkg) {
    result.reason = '未识别到前台应用包名'
    return result
  }

  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(limit, 200))
    : DEFAULT_LIMIT
  const pidNames = await getPidNames(deviceId)
  const targetPids = new Set(
    Object.keys(pidNames).filter((pid) => matchesPackage(pidNames[pid], pkg))
  )

  if (!targetPids.size) {
    result.reason = `未识别到 ${pkg} 的活动进程`
    return result
  }

  const logcat = await shell(
    deviceId,
    `logcat -d -v threadtime -t ${LOGCAT_SNAPSHOT_LINE_COUNT}`
  )
  const lines = logcat.split('\n')
  const pendingState = createHttpCapturePendingState()

  for (const line of lines) {
    const parsed = parseThreadtimeLine(line)
    if (!parsed) {
      continue
    }

    const { message, pid, tag, tid, time } = parsed
    if (
      !targetPids.has(String(pid)) ||
      (tag !== 'LoggingSpanExporter' && tag !== 'API_SERVICE')
    ) {
      continue
    }

    const item = consumeHttpCaptureLogRecord(
      {
        packageName: pidNames[String(pid)] || pkg,
        pid,
        tid,
        time,
        tag,
        message,
      },
      pendingState,
      {
        apiLabel: '接口',
        otelLabel: '日志',
      }
    )
    if (item) {
      result.items.push(item)
    }
  }

  for (const item of flushHttpCapturePendingState(pendingState, {
    apiLabel: '接口',
  })) {
    if (item) {
      result.items.push(item)
    }
  }

  result.items.sort((a, b) => b.time - a.time)
  result.items = result.items.slice(0, normalizedLimit)

  if (!result.items.length) {
    result.reason = `${pkg} 最近日志中未解析到完整网络请求块`
  }

  return result
}))

export function init() {
  handleEvent('getHttpCaptureSnapshot', getHttpCaptureSnapshot)
  handleEvent('getHttpCaptureLogSnapshot', getHttpCaptureLogSnapshot)
}

function parseCacheEntry(
  packageName: string,
  file: string,
  raw: string
): IHttpCaptureEntry | null {
  const lines = raw.split('\n')
  const url = trim(lines[0] || '')

  if (!url) {
    return null
  }

  const method = trim(lines[1] || '')
  const status = trim(lines[3] || '')
  const code = matchField(status, /HTTP\/\S+\s+(\d+)/)
  const sentMillis = toNumber(matchField(raw, /^OkHttp-Sent-Millis: (\d+)$/m))
  const receivedMillis = toNumber(
    matchField(raw, /^OkHttp-Received-Millis: (\d+)$/m)
  )
  const dateHeader = matchField(raw, /^Date: (.+)$/m)
  const time = sentMillis || Date.parse(dateHeader) || Date.now()
  const durationMs =
    sentMillis && receivedMillis ? Math.max(receivedMillis - sentMillis, 0) : 0

  return {
    id: `cache:${packageName}:${file}`,
    source: 'cache',
    sourceLabel: '缓存',
    packageName,
    time,
    timeLabel: formatTime(time),
    method,
    status,
    code,
    durationMs,
    url,
    requestPreview: '',
    responsePreview: '',
    raw,
  }
}

function matchField(text: string, pattern: RegExp) {
  const match = text.match(pattern)
  return trim(match?.[1] || '')
}

function toNumber(value: string) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function matchesPackage(processName: string, pkg: string) {
  return processName === pkg || processName.startsWith(`${pkg}:`)
}

function isRunAsError(output: string) {
  const normalized = trim(output)
  return (
    normalized.startsWith('run-as:') ||
    normalized.includes('Package ') ||
    normalized.includes('not debuggable')
  )
}

function formatTime(time: number) {
  const date = new Date(time)
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  const millisecond = String(date.getMilliseconds()).padStart(3, '0')

  return `${month}-${day} ${hour}:${minute}:${second}.${millisecond}`
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}
