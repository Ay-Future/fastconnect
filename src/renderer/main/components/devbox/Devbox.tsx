import { observer } from 'mobx-react-lite'
import { useEffect, useMemo, useRef, useState } from 'react'
import LunaToolbar, {
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import className from 'licia/className'
import find from 'licia/find'
import filter from 'licia/filter'
import idxOf from 'licia/idxOf'
import map from 'licia/map'
import trim from 'licia/trim'
import truncate from 'licia/truncate'
import uuid from 'licia/uuid'
import isEqual from 'licia/isEqual'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { notify } from 'share/renderer/lib/util'
import { t } from 'common/util'
import DevboxTerm from './DevboxTerm'
import store from '../../store'
import Style from './Devbox.module.scss'

interface IDevboxTab {
  id: string
  name: string
  host: string
  port: string
  username: string
  password: string
  sessionId: string
  status: 'idle' | 'connecting' | 'connected'
}

interface IDevboxFavorite {
  id: string
  name: string
  host: string
  port: string
  username: string
}

interface IStoredDevboxTabDraft {
  id: string
  name: string
  host: string
  port: string
  username: string
}

interface IDevboxStoreData {
  tabs: IStoredDevboxTabDraft[]
  selectedTabId: string
  favorites: IDevboxFavorite[]
}

export default observer(function Devbox() {
  const [tabs, setTabs] = useState<IDevboxTab[]>([])
  const [selectedTabId, setSelectedTabId] = useState('')
  const [favorites, setFavorites] = useState<IDevboxFavorite[]>([])
  const [favoriteId, setFavoriteId] = useState('')
  const [settingsCollapsed, setSettingsCollapsed] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const numRef = useRef(1)
  const restoreDoneRef = useRef(false)
  const lastSavedValueRef = useRef('')

  useEffect(() => {
    restore()
  }, [])

  useEffect(() => {
    if (!isReady) {
      return
    }

    persist().catch(() => {})
  }, [favorites, isReady, selectedTabId, tabs])

  const selectedTab = useMemo(() => {
    return (
      find(tabs, (item) => item.id === selectedTabId) || tabs[0] || null
    )
  }, [selectedTabId, tabs])

  async function restore() {
    try {
      const saved = (await main.getMainStore('devbox')) as IDevboxStoreData | null
      const restoredFavorites = normalizeFavorites(saved?.favorites || [])
      const restoredTabs = normalizeStoredTabs(saved?.tabs || [])

      if (restoredTabs.length) {
        const selected =
          restoredTabs.find((item) => item.id === saved?.selectedTabId) ||
          restoredTabs[0]
        const nextNum = getNextTabNum(restoredTabs)
        numRef.current = nextNum
        setTabs([selected])
        setSelectedTabId(selected.id)
      } else {
        const firstTab = createEmptyTab(numRef.current++)
        setTabs([firstTab])
        setSelectedTabId(firstTab.id)
      }

      setFavorites(restoredFavorites)
      restoreDoneRef.current = true
      setIsReady(true)
    } catch {
      const firstTab = createEmptyTab(numRef.current++)
      setTabs([firstTab])
      setSelectedTabId(firstTab.id)
      setFavorites([])
      restoreDoneRef.current = true
      setIsReady(true)
    }
  }

  function addTab() {
    const tab = createEmptyTab(numRef.current++)
    setTabs((prev) => [...prev, tab])
    setSelectedTabId(tab.id)
    setFavoriteId('')
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const closed = find(prev, (item) => item.id === id)
      if (closed?.sessionId) {
        main.killDevboxSession(closed.sessionId)
      }

      const nextTabs = filter(prev, (item) => item.id !== id)
      if (!nextTabs.length) {
        const nextTab = createEmptyTab(numRef.current++)
        nextTabs.push(nextTab)
        setSelectedTabId(nextTab.id)
        return [...nextTabs]
      }

      if (selectedTabId === id) {
        const closedIndex = idxOf(prev, closed)
        const nextIndex = Math.min(
          closedIndex >= 0 ? closedIndex : 0,
          nextTabs.length - 1
        )
        setSelectedTabId(nextTabs[nextIndex].id)
      }

      return nextTabs
    })
  }

  function updateSelectedTab(
    updater: (tab: IDevboxTab) => IDevboxTab
  ) {
    if (!selectedTab) {
      return
    }

    setTabs((prev) =>
      prev.map((item) => (item.id === selectedTab.id ? updater(item) : item))
    )
  }

  async function persist() {
    if (!restoreDoneRef.current) {
      return
    }

    const nextValue: IDevboxStoreData = {
      tabs: selectedTab
        ? [
            {
              id: selectedTab.id,
              name: selectedTab.name,
              host: selectedTab.host,
              port: selectedTab.port,
              username: selectedTab.username,
            },
          ]
        : [],
      selectedTabId,
      favorites,
    }
    const serialized = JSON.stringify(nextValue)
    if (serialized === lastSavedValueRef.current) {
      return
    }

    lastSavedValueRef.current = serialized
    await main.setMainStore('devbox', nextValue)
  }

  async function connect() {
    if (!selectedTab) {
      return
    }

    const host = trim(selectedTab.host)
    const username = trim(selectedTab.username)
    const port = trim(selectedTab.port)
    const password = selectedTab.password

    if (!host) {
      notify('请输入服务器地址', { icon: 'error' })
      return
    }

    try {
      if (selectedTab.sessionId) {
        await main.killDevboxSession(selectedTab.sessionId)
      }

      updateSelectedTab((tab) => ({
        ...tab,
        status: 'connecting',
        name: buildTabName(host, username),
        sessionId: '',
      }))

      const sessionId = await main.createDevboxSession({
        host,
        username,
        port: port ? Number(port) : 22,
        password,
      })

      setTabs((prev) =>
        prev.map((item) =>
          item.id === selectedTab.id
            ? {
                ...item,
                host,
                username,
                port: port || '22',
                password,
                sessionId,
                status: 'connected',
                name: buildTabName(host, username),
              }
            : item
        )
      )

      notify('devbox 已开始连接', { icon: 'success' })
    } catch (error: any) {
      updateSelectedTab((tab) => ({
        ...tab,
        status: 'idle',
      }))
      notify(error?.message || 'SSH 连接失败', { icon: 'error' })
    }
  }

  async function disconnect() {
    if (!selectedTab?.sessionId) {
      return
    }

    await main.killDevboxSession(selectedTab.sessionId)
    updateSelectedTab((tab) => ({
      ...tab,
      sessionId: '',
      status: 'idle',
    }))
  }

  function applyFavorite(favorite: IDevboxFavorite) {
    updateSelectedTab((tab) => ({
      ...tab,
      host: favorite.host,
      port: favorite.port,
      username: favorite.username,
      name: favorite.name || buildTabName(favorite.host, favorite.username),
    }))
    setFavoriteId(favorite.id)
  }

  function saveFavorite() {
    if (!selectedTab) {
      return
    }

    const host = trim(selectedTab.host)
    const username = trim(selectedTab.username)
    const port = trim(selectedTab.port) || '22'
    if (!host) {
      notify('请先填写服务器地址', { icon: 'error' })
      return
    }

    const favoriteName = buildTabName(host, username)
    const nextFavorite: IDevboxFavorite = {
      id: favoriteId || uuid(),
      name: favoriteName,
      host,
      port,
      username,
    }

    setFavorites((prev) => {
      const existed = find(prev, (item) => item.id === nextFavorite.id)
      if (existed) {
        return prev.map((item) =>
          item.id === nextFavorite.id ? nextFavorite : item
        )
      }
      return [...prev, nextFavorite]
    })
    setFavoriteId(nextFavorite.id)
    notify('已保存到常用服务器', { icon: 'success' })
  }

  function deleteFavorite() {
    if (!favoriteId) {
      return
    }

    setFavorites((prev) => filter(prev, (item) => item.id !== favoriteId))
    setFavoriteId('')
    notify('已移除常用服务器', { icon: 'success' })
  }

  const terms = map(tabs, (item) => (
    <DevboxTerm
      key={item.id}
      visible={store.panel === 'devbox' && selectedTab?.id === item.id}
      sessionId={item.sessionId}
    />
  ))

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarText
          text={
            selectedTab
              ? selectedTab.sessionId
                ? `已连接 ${buildConnectionText(selectedTab)}`
                : `未连接${selectedTab.host ? ` · ${buildConnectionText(selectedTab)}` : ' SSH'}`
              : '未连接 SSH'
          }
        />
        <LunaToolbarSpace />
        <ToolbarIcon
          icon={settingsCollapsed ? 'expand' : 'collapse'}
          title={settingsCollapsed ? '展开连接配置' : '收起连接配置'}
          onClick={() => setSettingsCollapsed((value) => !value)}
        />
      </LunaToolbar>
      <div className={className('panel-body', Style.container)}>
        <div className={Style.header}>
          {!settingsCollapsed ? (
            <div className={Style.form}>
              <select
                className={Style.input}
                value={favoriteId}
                onChange={(e) => {
                  const nextFavoriteId = e.target.value
                  setFavoriteId(nextFavoriteId)
                  const favorite = find(
                    favorites,
                    (item) => item.id === nextFavoriteId
                  )
                  if (favorite) {
                    applyFavorite(favorite)
                  }
                }}
              >
                <option value="">常用服务器</option>
                {favorites.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                className={Style.input}
                value={selectedTab?.host || ''}
                placeholder="服务器地址，例如 10.0.0.8 或 dev.example.com"
                onChange={(e) =>
                  updateSelectedTab((tab) => ({ ...tab, host: e.target.value }))
                }
                spellCheck={false}
              />
              <input
                className={Style.input}
                value={selectedTab?.port || ''}
                placeholder="端口"
                onChange={(e) =>
                  updateSelectedTab((tab) => ({ ...tab, port: e.target.value }))
                }
                spellCheck={false}
              />
              <input
                className={Style.input}
                value={selectedTab?.username || ''}
                placeholder="用户名，可留空使用 ~/.ssh/config"
                onChange={(e) =>
                  updateSelectedTab((tab) => ({
                    ...tab,
                    username: e.target.value,
                  }))
                }
                spellCheck={false}
              />
              <input
                className={Style.input}
                type="password"
                value={selectedTab?.password || ''}
                placeholder="密码，可选"
                onChange={(e) =>
                  updateSelectedTab((tab) => ({
                    ...tab,
                    password: e.target.value,
                  }))
                }
                spellCheck={false}
              />
              <button
                className={Style.primaryButton}
                disabled={!selectedTab || selectedTab.status === 'connecting'}
                onClick={connect}
              >
                {selectedTab?.status === 'connecting' ? '连接中...' : '连接'}
              </button>
              <button
                className={Style.secondaryButton}
                disabled={!selectedTab?.sessionId}
                onClick={disconnect}
              >
                断开
              </button>
              <button
                className={Style.secondaryButton}
                disabled={!selectedTab}
                onClick={saveFavorite}
              >
                保存常用
              </button>
              <button
                className={Style.secondaryButton}
                disabled={!favoriteId}
                onClick={deleteFavorite}
              >
                删除常用
              </button>
            </div>
          ) : null}
          <div className={Style.hint}>
            直接调用 macOS 自带 `ssh`，会复用你终端里的 `~/.ssh/config`、私钥、agent、Keychain 和跳板机配置。当前连接草稿和常用服务器会自动保存在本地。
          </div>
        </div>
        <div className={Style.termWrap}>{terms}</div>
      </div>
    </div>
  )
})

function buildTabName(host: string, username: string) {
  const name = username ? `${username}@${host}` : host
  return truncate(name || 'devbox', 28)
}

function buildConnectionText(tab: IDevboxTab) {
  const host = trim(tab.host)
  const username = trim(tab.username)
  const port = trim(tab.port)
  const target = username ? `${username}@${host}` : host
  return `${target}${port && port !== '22' ? `:${port}` : ''}`
}

function createEmptyTab(num: number): IDevboxTab {
  return {
    id: uuid(),
    name: `devbox ${num}`,
    host: '',
    port: '22',
    username: '',
    password: '',
    sessionId: '',
    status: 'idle',
  }
}

function normalizeStoredTabs(input: IStoredDevboxTabDraft[]) {
  const tabs = input
    .map((item) => ({
      id: item.id || uuid(),
      name: item.name || buildTabName(item.host || '', item.username || ''),
      host: item.host || '',
      port: item.port || '22',
      username: item.username || '',
      password: '',
      sessionId: '',
      status: 'idle' as const,
    }))
    .filter((item) => item.id)

  if (!tabs.length) {
    return []
  }

  return tabs
}

function normalizeFavorites(input: IDevboxFavorite[]) {
  const favorites = input
    .map((item) => ({
      id: item.id || uuid(),
      name:
        item.name || buildTabName(item.host || '', item.username || ''),
      host: item.host || '',
      port: item.port || '22',
      username: item.username || '',
    }))
    .filter((item) => item.host)

  const result: IDevboxFavorite[] = []
  for (const item of favorites) {
    if (
      !result.some((current) =>
        isEqual(
          [current.host, current.port, current.username],
          [item.host, item.port, item.username]
        )
      )
    ) {
      result.push(item)
    }
  }

  return result
}

function getNextTabNum(tabs: IStoredDevboxTabDraft[]) {
  let maxNum = 0

  for (const item of tabs) {
    const matched = String(item.name || '').match(/^devbox\s+(\d+)$/i)
    if (matched) {
      maxNum = Math.max(maxNum, Number(matched[1]) || 0)
    }
  }

  return maxNum + 1 || 1
}
