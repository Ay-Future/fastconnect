import strHash from 'licia/strHash'
import trim from 'licia/trim'
import { IHttpCaptureEntry } from './types'

const THREADTIME_RE =
  /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+[VDIWEF]\s+([^:]+):\s(.*)$/
const API_SERVICE_RE = /^\s*(\d+)\s+[│|]\s?(.*)$/

interface IOtelPendingEntry {
  packageName: string
  pid: number
  tid: number
  time: number
  raw: string
  updatedAt: number
}

interface IApiPendingEntry {
  key: string
  requestId: string
  packageName: string
  pid: number
  tid: number
  time: number
  raw: string
  url: string
  method: string
  status: string
  code: string
  durationMs: number
  requestPreview: string
  responsePreview: string
  hasResponse: boolean
  activeBody: '' | 'request' | 'response'
  bodyDepth: number
  bodyLineCount: number
  updatedAt: number
}

export interface IHttpCaptureLogRecord {
  packageName: string
  pid: number
  tid: number
  time: number
  tag: string
  message: string
}

export interface IHttpCapturePendingState {
  otel: Record<string, IOtelPendingEntry>
  api: Record<string, IApiPendingEntry>
}

export interface IHttpCaptureLogOptions {
  apiLabel?: string
  otelLabel?: string
  staleMs?: number
}

export function createHttpCapturePendingState(): IHttpCapturePendingState {
  return {
    otel: {},
    api: {},
  }
}

export function consumeHttpCaptureLogRecord(
  record: IHttpCaptureLogRecord,
  pendingState: IHttpCapturePendingState,
  options: IHttpCaptureLogOptions = {}
): IHttpCaptureEntry | null {
  const { tag } = record

  if (tag === 'LoggingSpanExporter') {
    return consumeOtelLogRecord(record, pendingState, options.otelLabel || '日志')
  }

  if (tag === 'API_SERVICE') {
    return consumeApiLogRecord(record, pendingState, options)
  }

  return null
}

export function flushHttpCapturePendingState(
  pendingState: IHttpCapturePendingState,
  options: IHttpCaptureLogOptions = {}
): IHttpCaptureEntry[] {
  const items: IHttpCaptureEntry[] = []

  for (const key of Object.keys(pendingState.api)) {
    const item = buildApiEntry(pendingState.api[key], options.apiLabel || '接口')
    delete pendingState.api[key]

    if (item) {
      items.push(item)
    }
  }

  return items
}

export function parseThreadtimeLine(line: string) {
  const match = line.match(THREADTIME_RE)
  if (!match) {
    return null
  }

  return {
    time: parseThreadtimeTimestamp(match[1]),
    pid: parseInt(match[2], 10),
    tid: parseInt(match[3], 10),
    tag: trim(match[4]),
    message: match[5],
  }
}

function consumeOtelLogRecord(
  record: IHttpCaptureLogRecord,
  pendingState: IHttpCapturePendingState,
  otelLabel: string
) {
  const { message, packageName, pid, tid, time } = record
  const key = `${pid}:${tid}:LoggingSpanExporter`
  const isStart = isOtelRequestStart(message)
  const isEnd = isOtelRequestEnd(message)

  if (isStart) {
    pendingState.otel[key] = {
      packageName,
      pid,
      tid,
      time,
      raw: message,
      updatedAt: Date.now(),
    }

    if (isEnd) {
      const item = buildOtelEntry(pendingState.otel[key], otelLabel)
      delete pendingState.otel[key]
      return item
    }

    return null
  }

  const pending = pendingState.otel[key]
  if (!pending) {
    return null
  }

  pending.raw += `\n${message}`
  pending.updatedAt = Date.now()

  if (!isEnd) {
    return null
  }

  delete pendingState.otel[key]
  return buildOtelEntry(pending, otelLabel)
}

function consumeApiLogRecord(
  record: IHttpCaptureLogRecord,
  pendingState: IHttpCapturePendingState,
  options: IHttpCaptureLogOptions
) {
  cleanupApiPending(pendingState.api, options.staleMs || 0)

  const parsed = parseApiServiceMessage(record.message)
  if (!parsed) {
    return null
  }

  const { requestId, content } = parsed
  const key = `${record.pid}:${record.tid}:${requestId}`
  let pending = pendingState.api[key]

  if (!pending) {
    pending = {
      key,
      requestId,
      packageName: record.packageName,
      pid: record.pid,
      tid: record.tid,
      time: record.time,
      raw: record.message,
      url: '',
      method: '',
      status: '',
      code: '',
      durationMs: 0,
      requestPreview: '',
      responsePreview: '',
      hasResponse: false,
      activeBody: '',
      bodyDepth: 0,
      bodyLineCount: 0,
      updatedAt: Date.now(),
    }
    pendingState.api[key] = pending
  } else {
    pending.raw += `\n${record.message}`
    pending.updatedAt = Date.now()
  }

  if (pending.activeBody) {
    appendApiBodyLine(pending, content)

    if (!pending.activeBody && pending.responsePreview) {
      const item = buildApiEntry(pending, options.apiLabel || '接口')
      delete pendingState.api[key]
      return item
    }

    return null
  }

  if (content.startsWith('URL:')) {
    pending.url = trim(content.slice(4))
    return null
  }

  if (content.startsWith('Method:')) {
    pending.method = normalizeMethod(trim(content.slice(7)))
    return null
  }

  if (content === 'Body:') {
    pending.activeBody = pending.hasResponse ? 'response' : 'request'
    pending.bodyDepth = 0
    pending.bodyLineCount = 0
    return null
  }

  const durationMatch = content.match(/Received in:\s*(\d+)ms/i)
  if (durationMatch) {
    pending.durationMs = toNumber(durationMatch[1])
    const successMatch = content.match(/is success\s*:\s*(true|false)/i)
    if (successMatch) {
      pending.status = successMatch[1] === 'true' ? 'success' : 'failed'
    }
    pending.hasResponse = true
    return null
  }

  if (content.startsWith('Status Code:')) {
    pending.status = trim(content.slice('Status Code:'.length))
    pending.code = matchField(pending.status, /^(\d+)/)
    pending.hasResponse = true
    return null
  }

  return null
}

function buildOtelEntry(
  pending: IOtelPendingEntry,
  sourceLabel: string
): IHttpCaptureEntry | null {
  const { packageName, pid, raw, tid, time } = pending
  const url =
    matchField(raw, /bizRequestUrl=([^,\s}]+)/) || matchField(raw, /'([^']+)'/)

  if (!url) {
    return null
  }

  return {
    id: `otel:${time}:${pid}:${tid}:${strHash(raw)}`,
    source: 'logcat',
    sourceLabel,
    packageName,
    time,
    timeLabel: formatTime(time),
    method: matchField(raw, /bizRequestType=([^,\s}]+)/),
    status: matchField(raw, /nodeStatus=([^,\s}]+)/),
    code: matchField(raw, /bizResponseCode=([^,\s}]+)/),
    durationMs: toNumber(matchField(raw, /nodeElapsedTime=([^,\s}]+)/)),
    url,
    requestPreview:
      extractPreview(raw, 'nodeInParam') || extractPreview(raw, 'bizRequestBody'),
    responsePreview: extractPreview(raw, 'nodeOutParam'),
    raw,
  }
}

function buildApiEntry(
  pending: IApiPendingEntry,
  sourceLabel: string
): IHttpCaptureEntry | null {
  if (!pending.url) {
    return null
  }

  if (
    !pending.requestPreview &&
    !pending.responsePreview &&
    !pending.hasResponse &&
    !pending.method
  ) {
    return null
  }

  return {
    id: `api:${pending.time}:${pending.pid}:${pending.tid}:${pending.requestId}`,
    source: 'logcat',
    sourceLabel,
    packageName: pending.packageName,
    time: pending.time,
    timeLabel: formatTime(pending.time),
    method: pending.method,
    status: pending.status,
    code: pending.code,
    durationMs: pending.durationMs,
    url: pending.url,
    requestPreview: trimBody(pending.requestPreview),
    responsePreview: trimBody(pending.responsePreview),
    raw: pending.raw,
  }
}

function parseApiServiceMessage(message: string) {
  const match = message.match(API_SERVICE_RE)
  if (!match) {
    return null
  }

  return {
    requestId: match[1],
    content: trimRight(match[2]),
  }
}

function appendApiBodyLine(pending: IApiPendingEntry, line: string) {
  if (!trim(line) && !pending.bodyLineCount) {
    return
  }

  const target =
    pending.activeBody === 'response' ? 'responsePreview' : 'requestPreview'
  pending[target] = pending[target]
    ? `${pending[target]}\n${line}`
    : line
  pending.bodyLineCount += 1
  pending.bodyDepth += getJsonDepthDelta(line)

  if (shouldCloseApiBody(pending)) {
    pending.activeBody = ''
    pending.bodyDepth = 0
    pending.bodyLineCount = 0
  }
}

function shouldCloseApiBody(pending: IApiPendingEntry) {
  if (!pending.bodyLineCount) {
    return false
  }

  if (pending.bodyLineCount === 1) {
    return pending.bodyDepth === 0
  }

  return pending.bodyDepth <= 0
}

function getJsonDepthDelta(line: string) {
  let delta = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) {
      continue
    }
    if (char === '{' || char === '[') {
      delta += 1
    } else if (char === '}' || char === ']') {
      delta -= 1
    }
  }

  return delta
}

function normalizeMethod(method: string) {
  return trim(method.replace(/^@+/, ''))
}

function extractPreview(raw: string, field: string) {
  const marker = `${field}=`
  const start = raw.indexOf(marker)

  if (start === -1) {
    return ''
  }

  let value = raw.slice(start + marker.length)
  const endMarkers = [
    ', bizRequestHeader=',
    ', bizRequestBody=',
    ', bizResponseMessage=',
    ', bizIsSuccessful=',
    ', traceFlag=',
    ', linkFlag=',
    ', traceId=',
    ', nodeName=',
    ', nodeStatus=',
    ', nodeType=',
    ', nodeElapsedTime=',
    ', nodeOutParam=',
    ', nodeSource=',
    ', logLevel=',
    ', httpTraceId=',
    ', spanId=',
    ', linkId=',
    ', bizRequestType=',
    ', bizResponseCode=',
    ', bizRequestUrl=',
    ', linkType=',
    ', nodeKey=',
    '}, capacity=',
  ]

  let end = value.length
  for (const currentMarker of endMarkers) {
    const index = value.indexOf(currentMarker)
    if (index !== -1 && index < end) {
      end = index
    }
  }

  value = trim(value.slice(0, end))

  if (
    !value ||
    value === ',' ||
    value === '{}' ||
    value === '[]' ||
    value === 'null'
  ) {
    return ''
  }

  return value
}

function matchField(text: string, pattern: RegExp) {
  const match = text.match(pattern)
  return trim(match?.[1] || '')
}

function trimBody(value: string) {
  return value.replace(/^\s+|\s+$/g, '')
}

function trimRight(value: string) {
  return value.replace(/\s+$/g, '')
}

function cleanupApiPending(
  pendingEntries: Record<string, IApiPendingEntry>,
  staleMs: number
) {
  if (!staleMs) {
    return
  }

  const now = Date.now()
  for (const key of Object.keys(pendingEntries)) {
    if (now - pendingEntries[key].updatedAt > staleMs) {
      delete pendingEntries[key]
    }
  }
}

function toNumber(value: string) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
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

function parseThreadtimeTimestamp(value: string) {
  const [monthDay, clock] = value.split(' ')
  const [month, day] = monthDay.split('-').map((part) => parseInt(part, 10))
  const [hour, minute, secondMs] = clock.split(':')
  const [second, millisecond = '0'] = secondMs.split('.')
  const now = new Date()

  return new Date(
    now.getFullYear(),
    month - 1,
    day,
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10),
    parseInt(millisecond.padEnd(3, '0').slice(0, 3), 10)
  ).getTime()
}

function isOtelRequestStart(raw: string) {
  return (
    raw.includes('AttributesMap{data={') &&
    (raw.includes('bizRequestUrl=') ||
      raw.includes("'http://") ||
      raw.includes("'https://"))
  )
}

function isOtelRequestEnd(raw: string) {
  return raw.includes('}, capacity=') || raw.includes('totalAddedValues=')
}
