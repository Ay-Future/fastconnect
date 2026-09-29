import { observer } from 'mobx-react-lite'
import Style from './Webview.module.scss'
import LunaToolbar, {
  LunaToolbarCheckbox,
  LunaToolbarInput,
  LunaToolbarSeparator,
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import { useEffect, useRef, useState } from 'react'
import { t } from 'common/util'
import toEl from 'licia/toEl'
import LunaDataGrid from 'luna-data-grid/react'
import map from 'licia/map'
import store from '../../store'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import DataGrid from 'luna-data-grid'
import { useWindowResize } from 'share/renderer/lib/hooks'
import { IWebview } from 'common/types'
import className from 'licia/className'

export default observer(function Webview() {
  const [webviews, setWebviews] = useState<IWebview[]>([])
  const [selected, setSelected] = useState<IWebview | null>(null)
  const [topPackage, setTopPackage] = useState({
    name: '',
    label: '',
    pid: 0,
  })
  const dataGridRef = useRef<DataGrid>(null)
  const [filter, setFilter] = useState('')
  const [reason, setReason] = useState('')
  const [socketName, setSocketName] = useState('')

  const { device } = store
  const canInspect = Boolean(selected)

  useEffect(() => {
    let destroyed = false

    async function getWebviews() {
      if (device) {
        if (store.panel === 'webview') {
          try {
            const topPackage = await main.getTopPackage(device.id)
            if (topPackage.name) {
              const packageInfos = await main.getPackageInfos(device.id, [
                topPackage.name,
              ])
              setTopPackage({
                ...topPackage,
                label: packageInfos[0].label,
              })
            }
            const result = await main.getWebviews(device.id, topPackage.pid || 0)
            setReason(topPackage.pid ? result.reason : result.reason || '未识别到前台应用进程')
            setSocketName(result.socketName)
            setWebviews(
              map(result.items, (webview: any) => {
                const title = webview.faviconUrl
                  ? toEl(
                      `<span><img src="${webview.faviconUrl}" />${webview.title}</span>`
                    )
                  : webview.title

                return {
                  ...webview,
                  title,
                }
              })
            )
          } catch {
            // ignore
          }
        } else {
          setReason('')
          setSocketName('')
          setWebviews([])
        }
      }
      if (!destroyed) {
        setTimeout(getWebviews, 2000)
      }
    }

    getWebviews()

    return () => {
      destroyed = true
    }
  }, [])

  useWindowResize(() => dataGridRef.current?.fit())

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarInput
          keyName="filter"
          value={filter}
          placeholder={t('filter')}
          onChange={(val) => setFilter(val)}
        />
        <LunaToolbarText text={topPackage ? topPackage.label : ''} />
        <LunaToolbarSpace />
        <LunaToolbarCheckbox
          keyName="useLocalInspector"
          value={store.webview.useLocalInspector}
          label={t('useLocalInspector')}
          onChange={(val) => {
            store.webview.set('useLocalInspector', val)
          }}
        />
        <ToolbarIcon
          disabled={!canInspect}
          icon="debug"
          title={t('inspect')}
          onClick={() => {
            if (!selected) {
              return
            }

            if (selected.source === 'logcat') {
              main.openWindow(selected.url, selected.id || selected.url, {
                minWidth: 960,
                minHeight: 640,
                width: 1280,
                height: 850,
                openDevTools: true,
              })
              return
            }

            let url = selected.devtoolsFrontendUrl
            if (store.webview.useLocalInspector && selected.webSocketDebuggerUrl) {
              url = 'devtools://devtools/bundled/inspector.html'
              url += `?ws=${selected.webSocketDebuggerUrl.replace('ws://', '')}`
            }
            if (!url) {
              return
            }
            main.openWindow(url, 'devtools')
          }}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          disabled={selected === null}
          icon="browser"
          title={t('openWithBrowser')}
          onClick={() => main.openExternal(selected!.url)}
        />
      </LunaToolbar>
      <LunaDataGrid
        onSelect={async (node) => setSelected(node.data as any)}
        onDeselect={() => setSelected(null)}
        className={Style.webviews}
        filter={filter}
        columns={columns}
        data={webviews}
        selectable={true}
        uniqueId="id"
        onCreate={(dataGrid) => {
          dataGridRef.current = dataGrid
          dataGrid.fit()
        }}
      />
      <div className={Style.overlay}>
        {!webviews.length && reason ? (
          <div className={className(Style.status, Style.statusWarning)}>
            <div className={Style.statusTitle}>未识别到可调试网页</div>
            <div className={Style.statusText}>{reason}</div>
            {topPackage.name ? (
              <div className={Style.statusMeta}>
                前台应用：{topPackage.label || topPackage.name}
              </div>
            ) : null}
            {socketName ? (
              <div className={Style.statusMeta}>命中 socket：{socketName}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})

const columns = [
  {
    id: 'title',
    title: t('title'),
    sortable: true,
    weight: 20,
  },
  {
    id: 'url',
    title: 'URL',
    sortable: true,
  },
  {
    id: 'type',
    title: t('type'),
    sortable: true,
    weight: 10,
  },
]
