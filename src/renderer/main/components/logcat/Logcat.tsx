import { observer } from 'mobx-react-lite'
import Style from './Logcat.module.scss'
import LunaToolbar, {
  LunaToolbarButton,
  LunaToolbarInput,
  LunaToolbarSelect,
  LunaToolbarSeparator,
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import LunaLogcat from 'luna-logcat/react'
import Logcat from 'luna-logcat'
import map from 'licia/map'
import rpad from 'licia/rpad'
import dateFormat from 'licia/dateFormat'
import toNum from 'licia/toNum'
import trim from 'licia/trim'
import escape from 'licia/escape'
import strHash from 'licia/strHash'
import { useEffect, useRef, useState } from 'react'
import store from '../../store'
import copy from 'licia/copy'
import download from 'licia/download'
import toStr from 'licia/toStr'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import contextMenu from 'share/renderer/lib/contextMenu'
import { notify } from 'share/renderer/lib/util'

const LOGCAT_MAX_ENTRIES = 50000
const LOGCAT_TRIM_THRESHOLD = 5000

interface ILogcatFilter {
  priority?: number
  package?: string
  tag?: string
}

export default observer(function Logcat() {
  const [view, setView] = useState<'compact' | 'standard'>('standard')
  const [softWrap, setSoftWrap] = useState(false)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<ILogcatFilter>({ tag: 'api' })
  const [currentToken, setCurrentToken] = useState('')
  const [entryCount, setEntryCount] = useState(0)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchMatchCount, setSearchMatchCount] = useState(0)
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1)
  const logcatRef = useRef<Logcat>(null)
  const entriesRef = useRef<any[]>([])
  const filterRef = useRef<ILogcatFilter>({ tag: 'api' })
  const logcatIdRef = useRef('')
  const searchKeywordRef = useRef('')
  const matchedEntriesRef = useRef<any[]>([])
  const activeMatchRef = useRef<any>(null)
  const searchRefreshTimerRef = useRef<number | null>(null)
  const resetActiveMatchRef = useRef(false)

  const { device } = store

  useEffect(() => {
    filterRef.current = filter
    rebuildLogcat()
  }, [filter])

  useEffect(() => {
    searchKeywordRef.current = trim(searchKeyword)
    resetActiveMatchRef.current = true
    scheduleSearchRefresh()
  }, [searchKeyword])

  useEffect(() => {
    scheduleSearchRefresh()
  }, [view])

  useEffect(() => {
    return () => {
      if (searchRefreshTimerRef.current !== null) {
        window.clearTimeout(searchRefreshTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (store.panel !== 'logcat' || !device) {
      return
    }

    function onLogcatEntry(id, entry) {
      if (logcatIdRef.current !== id) {
        return
      }

      pushEntry(entry)
      if (logcatRef.current && matchesFilter(entry, filterRef.current)) {
        logcatRef.current.append(entry)
      }
      if (searchKeywordRef.current) {
        scheduleSearchRefresh()
      }
    }
    const offLogcatEntry = main.on('logcatEntry', onLogcatEntry)
    main.openLogcat(device.id).then((id) => {
      logcatIdRef.current = id
    })

    return () => {
      offLogcatEntry()
      if (logcatIdRef.current) {
        main.closeLogcat(logcatIdRef.current)
      }
    }
  }, [device, store.panel])

  function save() {
    const data = map(entriesRef.current, (entry) => {
      return trim(
        `${dateFormat(entry.date, 'mm-dd HH:MM:ss.l')} ${rpad(
          entry.pid,
          5,
          ' '
        )} ${rpad(entry.tid, 5, ' ')} ${toLetter(entry.priority)} ${
          entry.tag
        }: ${entry.message}`
      )
    }).join('\n')
    const name = `${store.device ? store.device.name : 'logcat'}.${dateFormat(
      'yyyymmddHH'
    )}.txt`

    download(data, name, 'text/plain')
  }

  function clear() {
    if (logcatRef.current) {
      logcatRef.current.clear()
    }
    entriesRef.current = []
    setEntryCount(0)
    matchedEntriesRef.current = []
    activeMatchRef.current = null
    setSearchMatchCount(0)
    setActiveMatchIndex(-1)
  }

  function rebuildLogcat(instance?: Logcat | null) {
    const logcat = instance || logcatRef.current
    if (!logcat) {
      return
    }

    logcat.clear()
    for (const entry of entriesRef.current) {
      if (matchesFilter(entry, filterRef.current)) {
        logcat.append(entry)
      }
    }

    scheduleSearchRefresh()
  }

  function pushEntry(entry: any) {
    const entries = entriesRef.current

    entries.push(entry)
    setEntryCount(entries.length)
    if (entries.length >= LOGCAT_MAX_ENTRIES + LOGCAT_TRIM_THRESHOLD) {
      entries.splice(0, LOGCAT_TRIM_THRESHOLD)
    }
  }

  function getToken() {
    const token = extractLatestToken(entriesRef.current)

    if (!token) {
      notify('未从当前日志中找到 token', { icon: 'error' })
      return
    }

    setCurrentToken(token)
    copy(token)
    notify('已获取并复制 token', { icon: 'success' })
  }

  function scheduleSearchRefresh() {
    if (searchRefreshTimerRef.current !== null) {
      window.clearTimeout(searchRefreshTimerRef.current)
    }

    searchRefreshTimerRef.current = window.setTimeout(() => {
      searchRefreshTimerRef.current = null
      refreshSearchDecorations()
    }, 0)
  }

  function refreshSearchDecorations() {
    const logcat = logcatRef.current as any
    if (!logcat) {
      return
    }

    const keyword = searchKeywordRef.current
    const entries = logcat.entries || []
    const visibleEntries = entries.filter((entry) =>
      matchesFilter(entry, filterRef.current)
    )

    const matchedEntries = keyword
      ? visibleEntries.filter((entry) => isSearchMatch(entry, keyword))
      : []

    matchedEntriesRef.current = matchedEntries

    let activeEntry = activeMatchRef.current
    if (
      resetActiveMatchRef.current ||
      !activeEntry ||
      matchedEntries.indexOf(activeEntry) === -1
    ) {
      activeEntry = matchedEntries[0] || null
    }
    resetActiveMatchRef.current = false
    activeMatchRef.current = activeEntry

    for (const entry of entries) {
      decorateEntry(entry, view, keyword, entry === activeEntry)
    }

    if (!activeEntry) {
      setSearchMatchCount(matchedEntries.length)
      setActiveMatchIndex(-1)
      return
    }

    const currentIndex = matchedEntries.indexOf(activeEntry)
    setSearchMatchCount(matchedEntries.length)
    setActiveMatchIndex(currentIndex)
  }

  function goToMatch(step: 1 | -1) {
    const matchedEntries = matchedEntriesRef.current
    if (!matchedEntries.length) {
      return
    }

    const currentIndex = matchedEntries.indexOf(activeMatchRef.current)
    const baseIndex = currentIndex === -1 ? 0 : currentIndex
    const nextIndex =
      (baseIndex + step + matchedEntries.length) % matchedEntries.length
    const activeEntry = matchedEntries[nextIndex]

    activeMatchRef.current = activeEntry
    setActiveMatchIndex(nextIndex)
    setSearchMatchCount(matchedEntries.length)

    const logcat = logcatRef.current as any
    if (logcat) {
      const entries = logcat.entries || []
      for (const entry of entries) {
        decorateEntry(entry, view, searchKeywordRef.current, entry === activeEntry)
      }
    }

    scrollToEntry(activeEntry)
  }

  function scrollToEntry(targetEntry: any) {
    const logcat = logcatRef.current as any
    if (!logcat || !targetEntry) {
      return
    }

    const displayEntries = logcat.displayEntries || []
    const targetIndex = displayEntries.indexOf(targetEntry)
    if (targetIndex === -1) {
      return
    }

    const virtualList = logcat.virtualList
    const items = virtualList?.items || []
    let top = 0
    for (let i = 0; i < targetIndex; i++) {
      top += items[i]?.height || 0
    }

    const targetHeight = items[targetIndex]?.height || 0
    const container = virtualList?.container
    if (!container) {
      return
    }

    container.scrollTop = Math.max(
      top - container.clientHeight / 2 + targetHeight / 2,
      0
    )
    virtualList.render?.()
  }

  const onContextMenu = (e: PointerEvent, entry: any) => {
    e.preventDefault()
    const logcat = logcatRef.current!
    const template: any[] = [
      {
        label: t('copy'),
        click: () => {
          if (logcat.hasSelection()) {
            copy(logcat.getSelection())
          } else if (entry) {
            copy(entry.message)
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('clear'),
        click: clear,
      },
    ]

    contextMenu(e, template)
  }

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar
        className="panel-toolbar"
        onChange={(key, val) => {
          switch (key) {
            case 'view':
              setView(val)
              break
            case 'priority':
              setFilter({
                ...filter,
                priority: toNum(val),
              })
              break
            case 'package':
              setFilter({
                ...filter,
                package: val,
              })
              break
            case 'tag':
              setFilter({
                ...filter,
                tag: val,
              })
              break
          }
        }}
      >
        <LunaToolbarSelect
          keyName="view"
          disabled={!device}
          value={view}
          options={{
            [t('standardView')]: 'standard',
            [t('compactView')]: 'compact',
          }}
        />
        <LunaToolbarSeparator />
        <LunaToolbarSelect
          keyName="priority"
          disabled={!device}
          value={toStr(filter.priority || 2)}
          options={{
            VERBOSE: '2',
            DEBUG: '3',
            INFO: '4',
            WARNING: '5',
            ERROR: '6',
          }}
        />
        <LunaToolbarInput
          keyName="package"
          placeholder={t('package')}
          value={filter.package || ''}
        />
        <LunaToolbarInput
          keyName="tag"
          placeholder={t('tag')}
          value={filter.tag || ''}
        />
        <LunaToolbarSeparator />
        <LunaToolbarInput
          keyName="search"
          placeholder="搜索关键字"
          value={searchKeyword}
          onChange={(val) => setSearchKeyword(val)}
        />
        <LunaToolbarText
          text={
            searchKeywordRef.current
              ? `${searchMatchCount} 个匹配，当前 ${
                  activeMatchIndex >= 0 ? activeMatchIndex + 1 : 0
                }`
              : ''
          }
        />
        <LunaToolbarButton
          state="hover"
          disabled={!device || !entryCount}
          onClick={getToken}
        >
          获取token
        </LunaToolbarButton>
        <LunaToolbarSpace />
        {currentToken ? <button className={Style.tokenResult} type="button" title="点击复制当前 token" onClick={() => { copy(currentToken); notify('token 已复制', { icon: 'success' }) }}><span>当前 token</span><code>{currentToken}</code><b>复制</b></button> : null}
        <ToolbarIcon
          icon="save"
          title={t('save')}
          onClick={save}
          disabled={!device}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="soft-wrap"
          state={softWrap ? 'hover' : ''}
          title={t('softWrap')}
          onClick={() => setSoftWrap(!softWrap)}
        />
        <ToolbarIcon
          icon="scroll-end"
          title={t('scrollToEnd')}
          onClick={() => logcatRef.current?.scrollToEnd()}
          disabled={!device}
        />
        <ToolbarIcon
          icon="reset"
          title={t('restart')}
          onClick={() => {
            if (logcatIdRef.current) {
              main.closeLogcat(logcatIdRef.current)
              clear()
            }
            if (device) {
              main.openLogcat(device.id).then((id) => {
                logcatIdRef.current = id
              })
            }
          }}
          disabled={!device}
        />
        <ToolbarIcon
          icon={paused ? 'play' : 'pause'}
          title={t(paused ? 'resume' : 'pause')}
          onClick={() => {
            if (paused) {
              main.resumeLogcat(logcatIdRef.current)
            } else {
              main.pauseLogcat(logcatIdRef.current)
            }
            setPaused(!paused)
          }}
          disabled={!device}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="delete"
          title={t('clear')}
          onClick={clear}
          disabled={!device}
        />
      </LunaToolbar>
      <LunaLogcat
        className={`panel-body ${Style.logcat}`}
        maxNum={LOGCAT_MAX_ENTRIES}
        wrapLongLines={softWrap}
        onContextMenu={onContextMenu}
        view={view}
        onCreate={(logcat) => {
          logcatRef.current = logcat
          rebuildLogcat(logcat)
        }}
      />
    </div>
  )
})

function toLetter(priority: number) {
  return ['?', '?', 'V', 'D', 'I', 'W', 'E'][priority]
}

function extractLatestToken(entries: any[]) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    const message = entry?.message || ''
    const token = getTokenFromMessage(message)
    if (token) {
      return token
    }
  }

  return ''
}

function getTokenFromMessage(message: string) {
  const matchers = [
    /"(?:user[-_]?token|access[-_]?token|token|auth[-_]?token|authorization)"\s*:\s*"([^"]+)"/i,
    /(?:user[-_]?token|access[-_]?token|token|auth[-_]?token|authorization)\s*[=:：]\s*["']?([^"',}\]\s]+)["']?/i,
    /\bBearer\s+([A-Za-z0-9._\-+/=]+)/,
  ]

  for (let i = 0; i < matchers.length; i++) {
    const match = message.match(matchers[i])
    if (match && match[1]) {
      const token = sanitizeToken(match[1])
      if (isLikelyToken(token)) {
        return token
      }
    }
  }

  return ''
}

function sanitizeToken(token: string) {
  return trim(token.replace(/^Bearer\s+/i, '').replace(/\\"/g, '"')).replace(
    /^["']|["']$/g,
    ''
  )
}

function isLikelyToken(token: string) {
  if (!token) {
    return false
  }

  if (token.length < 8) {
    return false
  }

  if (/\s/.test(token)) {
    return false
  }

  const lowerToken = token.toLowerCase()
  const invalidPrefixes = [
    'android.os.',
    'java.lang.',
    'androidx.',
    'kotlin.',
    'binderproxy@',
  ]
  for (const prefix of invalidPrefixes) {
    if (lowerToken.startsWith(prefix)) {
      return false
    }
  }

  const invalidFragments = [
    'android.os.binderproxy@',
    ' java.',
    ' android.',
    '[object ',
  ]
  for (const fragment of invalidFragments) {
    if (lowerToken.includes(fragment)) {
      return false
    }
  }

  if (/^[A-Za-z_$][\w$.]*@[0-9a-f]+$/i.test(token)) {
    return false
  }

  const jwtLike = /^[A-Za-z0-9\-_]+=*\.[A-Za-z0-9\-_]+=*(?:\.[A-Za-z0-9\-_+/=]*)?$/
  if (jwtLike.test(token)) {
    return true
  }

  const hasMixedCharset = /[A-Za-z]/.test(token) && /\d/.test(token)
  const hasTokenChars = /[-_=+/]/.test(token)
  return hasMixedCharset || hasTokenChars
}

function matchesFilter(entry: any, filter: ILogcatFilter) {
  if (filter.priority && entry.priority < filter.priority) {
    return false
  }

  const packageFilter = trim(filter.package || '').toLowerCase()
  if (packageFilter) {
    const entryPackage = trim(entry.package || '').toLowerCase()
    if (!entryPackage.includes(packageFilter)) {
      return false
    }
  }

  const tagFilter = trim(filter.tag || '').toLowerCase()
  if (tagFilter) {
    const entryTag = trim(entry.tag || '').toLowerCase()
    if (!entryTag.includes(tagFilter)) {
      return false
    }
  }

  return true
}

function isSearchMatch(entry: any, keyword: string) {
  if (!keyword) {
    return false
  }

  return buildSearchText(entry).toLowerCase().includes(keyword.toLowerCase())
}

function buildSearchText(entry: any) {
  return trim(
    [
      dateFormat(entry.date, 'yyyy-mm-dd HH:MM:ss.l'),
      `${entry.pid}-${entry.tid}`,
      entry.package || '',
      entry.tag || '',
      toLetter(entry.priority),
      trim(entry.message || ''),
    ].join(' ')
  )
}

function decorateEntry(
  entry: any,
  view: 'compact' | 'standard',
  keyword: string,
  isActive: boolean
) {
  if (!entry?.container) {
    return
  }

  const isMatched = keyword ? isSearchMatch(entry, keyword) : false
  entry.container.classList.toggle(Style.searchMatchedRow, isMatched)
  entry.container.classList.toggle(Style.searchActiveRow, isMatched && isActive)
  entry.container.innerHTML =
    view === 'standard'
      ? formatStandard(entry, keyword, isMatched && isActive)
      : formatCompact(entry, keyword, isMatched && isActive)
}

function formatStandard(entry: any, keyword: string, isActive: boolean) {
  return [
    `<span class="luna-logcat-date">${highlightText(
      dateFormat(entry.date, 'yyyy-mm-dd HH:MM:ss.l'),
      keyword,
      isActive
    )}</span>`,
    `<span class="luna-logcat-pid">${highlightText(
      `${entry.pid}-${entry.tid}`,
      keyword,
      isActive
    )}</span>`,
    `<span class="luna-logcat-tag ${getColorClass(entry.tag || '')}">${highlightText(
      entry.tag || '',
      keyword,
      isActive
    )}</span>`,
    `<span class="luna-logcat-package">${highlightText(
      entry.package || '',
      keyword,
      isActive
    )}</span>`,
    `<span class="luna-logcat-priority">${highlightText(
      toLetter(entry.priority),
      keyword,
      isActive
    )}</span>`,
    `<span class="luna-logcat-message">${highlightText(
      trim(entry.message || ''),
      keyword,
      isActive
    )}</span>`,
  ].join(' ')
}

function formatCompact(entry: any, keyword: string, isActive: boolean) {
  return [
    `<span class="luna-logcat-date">${highlightText(
      dateFormat(entry.date, 'HH:MM:ss.l'),
      keyword,
      isActive
    )}</span>`,
    `<span class="luna-logcat-priority">${highlightText(
      toLetter(entry.priority),
      keyword,
      isActive
    )}</span>`,
    `<span class="luna-logcat-message">${highlightText(
      trim(entry.message || ''),
      keyword,
      isActive
    )}</span>`,
  ].join(' ')
}

function highlightText(text: string, keyword: string, isActive: boolean) {
  const value = text || ''
  if (!keyword) {
    return escape(value)
  }

  const lowerValue = value.toLowerCase()
  const lowerKeyword = keyword.toLowerCase()
  let startIdx = 0
  let matchIdx = lowerValue.indexOf(lowerKeyword)

  if (matchIdx === -1) {
    return escape(value)
  }

  const markClass = isActive ? Style.searchActiveText : Style.searchMatchedText
  const parts: string[] = []

  while (matchIdx !== -1) {
    parts.push(escape(value.slice(startIdx, matchIdx)))
    parts.push(
      `<mark class="${markClass}">${escape(
        value.slice(matchIdx, matchIdx + keyword.length)
      )}</mark>`
    )
    startIdx = matchIdx + keyword.length
    matchIdx = lowerValue.indexOf(lowerKeyword, startIdx)
  }

  parts.push(escape(value.slice(startIdx)))

  return parts.join('')
}

function getColorClass(str: string) {
  return LOGCAT_COLOR_CLASSES[strHash(str) % LOGCAT_COLOR_CLASSES.length]
}

const LOGCAT_COLOR_CLASSES: string[] = []
for (const color of [
  'blue',
  'purple',
  'cyan',
  'green',
  'magenta',
  'pink',
  'red',
  'orange',
  'yellow',
  'volcano',
  'geekblue',
  'gold',
  'lime',
]) {
  for (let i = 6; i <= 10; i++) {
    LOGCAT_COLOR_CLASSES.push(`luna-logcat-color-${color}-${i}`)
  }
}
