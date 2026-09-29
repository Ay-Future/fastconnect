import each from 'licia/each'
import trim from 'licia/trim'
import contain from 'licia/contain'
import singleton from 'licia/singleton'
import axios from 'axios'
import { shell, forwardTcp } from './base'
import { handleEvent } from 'share/main/lib/util'
import { IpcGetWebviews, IWebview, IWebviewResult } from 'common/types'

const LOGCAT_URL_CACHE_TTL = 5000
const LOGCAT_URL_SCAN_COMMAND = 'logcat -d -v brief -t 2000'
const PREMIUM_COURSE_URL_RE =
  /https?:\/\/[^\s"'<>]+\/native-embed-mono\/premium-course\/#\/[^\s"'<>?]+\/?\?[^\s"'<>]*/gi
const logcatUrlCache: Record<
  string,
  {
    timestamp: number
    items: IWebview[]
  }
> = {}

const getWebviews = singleton(<IpcGetWebviews>(async (
  deviceId: string,
  pid: number
) => {
  const result: IWebviewResult = {
    items: [],
    reason: '',
    socketName: '',
  }

  const unixSockets: string = await shell(deviceId, `cat /proc/net/unix`)

  const lines = unixSockets.split('\n')
  const socketCandidates = getSocketCandidates(pid)
  let line = ''
  for (let i = 0, len = lines.length; i < len; i++) {
    const currentLine = trim(lines[i])
    if (
      socketCandidates.some((candidate) => contain(currentLine, candidate))
    ) {
      line = currentLine
      break
    }
  }

  if (!line) {
    result.reason =
      '前台应用已打开，但未发现可调试的 WebView DevTools socket，应用可能未开启 WebView 调试'
  } else {
    const socketNameMatch = line.match(/[^@]+@(.*?webview_devtools_remote_?.*)/)
    const chromeSocketNameMatch = line.match(
      /[^@]+@(.*?chrome_devtools_remote_?.*)/
    )
    const socketName = socketNameMatch
      ? socketNameMatch[1]
      : chromeSocketNameMatch
        ? chromeSocketNameMatch[1]
        : ''
    if (!socketName) {
      result.reason = '检测到了调试 socket，但无法解析 socket 名称'
    } else {
      result.socketName = socketName
      const remote = `localabstract:${socketName}`
      try {
        const port = await forwardTcp(deviceId, remote)
        const { data } = await axios.get(`http://127.0.0.1:${port}/json`)
        each(data, (item: any) => result.items.push(item))
      } catch {
        result.reason = `已发现调试 socket ${socketName}，但读取调试页面失败`
      }
    }
  }

  const logcatItems = await getLogcatWebviews(deviceId)
  result.items = mergeWebviews([...result.items, ...logcatItems])

  if (!result.items.length && result.socketName) {
    result.reason = `已发现调试 socket ${result.socketName}，但未返回可调试页面`
  }

  return result
}))

export function init() {
  handleEvent('getWebviews', getWebviews)
}

function getSocketCandidates(pid: number) {
  return [
    `webview_devtools_remote_${pid}`,
    `webview_devtools_remote_${String(pid)}`,
    `chrome_devtools_remote_${pid}`,
    `chrome_devtools_remote`,
    `webview_devtools_remote`,
  ]
}

async function getLogcatWebviews(deviceId: string) {
  const cached = logcatUrlCache[deviceId]
  const now = Date.now()
  if (cached && now - cached.timestamp < LOGCAT_URL_CACHE_TTL) {
    return cached.items
  }

  try {
    const logcat: string = await shell(deviceId, LOGCAT_URL_SCAN_COMMAND)
    const items = mergeWebviews([
      ...(cached?.items || []),
      ...extractLogcatWebviews(logcat),
    ])
    logcatUrlCache[deviceId] = {
      timestamp: now,
      items,
    }

    return items
  } catch {
    return []
  }
}

function extractLogcatWebviews(logcat: string) {
  const items: IWebview[] = []
  const seen = new Set<string>()
  const normalizedLogcat = logcat
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
  const matches = normalizedLogcat.match(PREMIUM_COURSE_URL_RE) || []

  each(matches, (match) => {
    const url = sanitizeLoggedUrl(match)
    if (!url || seen.has(url) || !isLogcatWebviewUrl(url)) {
      return
    }
    seen.add(url)
    items.push(createLogcatWebview(url))
  })

  return items
}

function sanitizeLoggedUrl(url: string) {
  return trim(url).replace(/[)"'\],;]+$/g, '')
}

function isLogcatWebviewUrl(url: string) {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.replace(/\/+$/g, '')
    if (pathname !== '/native-embed-mono/premium-course') {
      return false
    }

    return /^#\/[^?]+\/?\?/.test(parsed.hash)
  } catch {
    return false
  }
}

function createLogcatWebview(url: string): IWebview {
  let title = '日志链接'

  try {
    const parsed = new URL(url)
    const route = parsed.hash
      .replace(/^#\//, '')
      .split('?')[0]
      .replace(/\/+$/g, '')
    if (route) {
      title = `日志链接 ${route}`
    }
  } catch {
    // Ignore malformed URLs after regex extraction.
  }

  return {
    id: `logcat:${url}`,
    title,
    url,
    type: 'logcat',
    source: 'logcat',
    devtoolsFrontendUrl: '',
    webSocketDebuggerUrl: '',
  }
}

function mergeWebviews(items: IWebview[]) {
  const result: IWebview[] = []
  const seen = new Set<string>()

  each(items, (item) => {
    const key = trim(
      item.url || item.id || item.webSocketDebuggerUrl || item.devtoolsFrontendUrl
    )
    if (!key || seen.has(key)) {
      return
    }
    seen.add(key)
    result.push(item)
  })

  return result
}
