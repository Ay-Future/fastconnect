import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import LunaDataGrid from 'luna-data-grid/react'
import DataGrid from 'luna-data-grid'
import LunaToolbar, {
  LunaToolbarInput,
  LunaToolbarSpace,
} from 'luna-toolbar/react'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { t } from 'common/util'
import Style from './PrecisionLearning.module.scss'
import store from '../../store'
import { PannelLoading } from '../common/loading'
import { useWindowResize } from 'share/renderer/lib/hooks'
import className from 'licia/className'
import chunk from 'licia/chunk'
import { IPackageInfo } from 'common/types'
import DeviceDashboard from '../device-dashboard/DeviceDashboard'
import { notify } from 'share/renderer/lib/util'
import find from 'licia/find'
import LunaModal from 'luna-modal'
import contextMenu from 'share/renderer/lib/contextMenu'
import PackageInfoModal from '../application/PackageInfoModal'

interface IRow {
  id: string
  packageName: string
  deviceLabel: string
  configLabel: string
  versionName: string
  info: IPackageInfo | null
}

interface IDisplayRow {
  id: string
  packageName: string | HTMLElement
  deviceLabel: string | HTMLElement
  configLabel: string | HTMLElement
  versionName: string | HTMLElement
}

const FIXED_PACKAGES: Array<{ label: string; packageName: string }> = [
  { packageName: 'com.jzx.client.chinese', label: '跟我学语文' },
  { packageName: 'com.jzx.client.chinese', label: '跟我学语文' },
  { packageName: 'com.jzx.client.aiteacher.math', label: '跟我学数学' },
  { packageName: 'com.jzx.client.math1v1', label: '跟我学数学' },
  { packageName: 'com.jzx.client.english', label: '跟我学英语' },
  { packageName: 'com.jzx.client.physics1v1', label: '跟我学物理' },
  { packageName: 'com.jzx.client.physics1v1', label: '跟我学物理' },
  { packageName: 'com.jzx.client.chemistry1v1', label: '跟我学化学' },
  { packageName: 'com.jzx.client.chemistry1v1', label: '跟我学化学' },
  { packageName: 'com.jzx.client.biology1v1', label: '跟我学生物' },
  { packageName: 'com.jzx.client.biology1v1', label: '跟我学生物' },
  { packageName: 'com.jzx.client.science1v1', label: '跟我学科学' },
  { packageName: 'com.jzx.client.history1v1', label: '跟我学历史' },
  { packageName: 'com.jzx.client.geography1v1', label: '跟我学地理' },
  {
    packageName: 'com.jzx.client.moralityandlow1v1',
    label: '跟我学道法',
  },
  { packageName: 'com.jzx.client.politics1v1', label: '跟我学政治' },
  { packageName: 'com.jzx.client.readingapp', label: '阅读辅导' },
  { packageName: 'com.jzx.client.readingapp', label: '阅读辅导' },
  { packageName: 'com.jzx.client.aichat', label: '字词学习' },
  { packageName: 'com.jzx.client.math', label: '数学同步练习' },
  { packageName: 'com.jzx.client.mathexam', label: '数学备考' },
  { packageName: 'com.jzx.client.mathjuniorexam', label: '数学中考复习' },
  { packageName: 'com.jzx.client.physics', label: '物理同步练习' },
  { packageName: 'com.jzx.client.physics', label: '物理同步练习' },
  { packageName: 'com.jzx.client.chemistry', label: '化学同步练习' },
  { packageName: 'com.jzx.client.chemistry', label: '化学同步练习' },
  { packageName: 'com.jzx.client.biology', label: '生物同步练习' },
  { packageName: 'com.jzx.client.biology', label: '生物同步练习' },
  { packageName: 'com.jzx.client.science', label: '科学同步练习' },
  { packageName: 'com.jzx.client.calculation', label: '计算训练' },
  { packageName: 'com.jzx.client.math.mind', label: '思维训练' },
  { packageName: 'com.jzx.client.formula', label: '看图列式' },
  { packageName: 'com.jxw.ksdcg', label: '口算大闯关' },
  { packageName: 'com.jzx.client.aichat', label: '学练背单词' },
  { packageName: 'com.jzx.client.aichat', label: '单词听写' },
  { packageName: 'com.jzx.client.aichat', label: '字词听写' },
  { packageName: 'com.jzx.client.aichat', label: '古诗文默写' },
  { packageName: 'com.jzx.client.questionocr', label: '拍照讲题' },
  { packageName: 'com.jzx.client.essayocr', label: '作文辅导' },
  { packageName: 'com.jzx.client.essayocr', label: '看图写话' },
  { packageName: 'com.jzx.client.correct', label: '作业批改' },
  { packageName: 'com.jzx.client.analyzer', label: '学情分析' },
  { packageName: 'com.jzx.client.note', label: '错题本' },
  { packageName: 'com.jzx.client.selfstudy', label: '自习室' },
  { packageName: 'com.jzx.client.monitor', label: '陪你写作业' },
  { packageName: 'com.jzx.client.aichat', label: '口语外教' },
  { packageName: 'com.jzx.client.aichat', label: '品味古诗' },
  { packageName: 'com.jzx.client.aichat', label: '百科知识问答' },
  { packageName: 'com.jzx.client.aichat', label: '故事大王' },
  { packageName: 'com.jzx.client.historyboard', label: '跟我聊历史' },
  { packageName: 'com.jzx.client.historyboard', label: '跟我聊历史' },
  { packageName: 'com.jxw.download', label: '物理实验' },
  { packageName: 'com.jxw.download', label: '物理实验' },
  { packageName: 'com.jxw.download', label: '化学实验' },
  { packageName: 'com.jxw.download', label: '化学实验' },
  { packageName: 'com.jxw.download', label: '生物实验' },
  { packageName: 'com.jxw.jpkc', label: '自然拼读' },
  { packageName: 'com.jxw.englishsoundmark', label: '音标学习' },
  { packageName: 'com.jxw.qjdh', label: '口语听说' },
  { packageName: 'com.jxw.qjdh', label: '口语听说' },
  { packageName: 'com.jxw.tbdd', label: '同步点读' },
  { packageName: 'com.jxw.jpkc', label: '金牌视频' },
  { packageName: 'com.jxw.xdfzq', label: '新东方录播课' },
  { packageName: 'com.study.client.resource', label: '资源共享库' },
  { packageName: 'com.jxw.examsystem', label: '备考密卷' },
  { packageName: 'com.jxwgb.zhtsg', label: '课外阅读' },
  { packageName: 'com.jxw.yyhb', label: '双语绘本' },
  { packageName: 'com.jxw.tbgs', label: '古诗词' },
  { packageName: 'com.jzx.client.word', label: '背单词' },
  { packageName: 'com.tech.translate', label: '中英互译' },
  { packageName: 'com.jxw.zjcc', label: '指尖查词' },
  { packageName: 'com.jxw.zncd', label: '双语词典' },
]
const searchFields: Array<keyof IRow> = [
  'packageName',
  'deviceLabel',
  'configLabel',
  'versionName',
]
const CONFIG_LABELS_BY_PACKAGE = getConfigLabelsByPackage()

export default observer(function PrecisionLearning() {
  const [packages, setPackages] = useState<IRow[]>([])
  const [filter, setFilter] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [packageInfo, setPackageInfo] = useState<IPackageInfo | null>(null)
  const [packageInfoModalVisible, setPackageInfoModalVisible] = useState(false)
  const packagesGridRef = useRef<DataGrid>(null)
  const { device } = store

  const displayPackages = getDisplayPackages(packages, filter)

  useWindowResize(() => {
    packagesGridRef.current?.fit()
  })

  useEffect(() => {
    setPackages([])
  }, [device?.id])

  useEffect(() => {
    if (store.panel === 'precisionLearning') {
      refresh()
    }
  }, [device?.id, store.panel])

  async function refresh() {
    if (!device || isLoading) {
      return
    }

    setIsLoading(true)

    try {
      const packageNames = await main.getPackages(device.id, false)
      const packageInfos = await getPackageInfosByChunks(device.id, packageNames)
      setPackages(getMergedPackages(packageInfos))
    } finally {
      setIsLoading(false)
    }
  }

  function showInfo(packageName: string) {
    const row = find(packages, (item) => item.packageName === packageName)
    if (row?.info) {
      setPackageInfo(row.info)
      setPackageInfoModalVisible(true)
    }
  }

  function confirmText(key: string, info: IPackageInfo) {
    const ret = t(key, { name: info.label || info.packageName })

    if (info.system) {
      return t('sysPackageTip') + ' ' + ret
    }

    return ret
  }

  async function open(packageName: string) {
    const row = find(packages, (item) => item.packageName === packageName)
    if (!row?.info) {
      return
    }

    try {
      await main.startPackage(store.device!.id, packageName)
    } catch {
      notify(t('startPackageErr'), { icon: 'error' })
    }
  }

  function onContextMenu(e: PointerEvent, row: IRow) {
    if (!device || !row.info) {
      return
    }

    const info = row.info

    const template: any[] = [
      {
        label: t('packageInfo'),
        click() {
          showInfo(info.packageName)
        },
      },
      {
        label: t('exportApk'),
        click: async () => {
          const { canceled, filePath } = await main.showSaveDialog({
            defaultPath: `${info.packageName}-${info.versionName}.apk`,
          })
          if (canceled) {
            return
          }
          await main.pullFile(device.id, info.apkPath, filePath)
          notify(t('apkExported', { path: filePath }), {
            icon: 'success',
            duration: 5000,
          })
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('open'),
        click: () => open(info.packageName),
      },
      {
        label: t('stop'),
        click: async () => {
          const result = await LunaModal.confirm(
            confirmText('stopPackageConfirm', info)
          )
          if (result) {
            await main.stopPackage(device.id, info.packageName)
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('disablePackage'),
        enabled: info.enabled,
        click: async () => {
          const result = await LunaModal.confirm(
            confirmText('disablePackageConfirm', info)
          )
          if (result) {
            await main.disablePackage(device.id, info.packageName)
            refresh()
          }
        },
      },
      {
        label: t('enablePackage'),
        enabled: !info.enabled,
        click: async () => {
          await main.enablePackage(device.id, info.packageName)
          refresh()
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('clearData'),
        click: async () => {
          const result = await LunaModal.confirm(
            confirmText('clearDataConfirm', info)
          )
          if (result) {
            await main.clearPackage(device.id, info.packageName)
            notify(t('dataCleared'), { icon: 'success' })
            setTimeout(() => refresh(), 1000)
          }
        },
      },
      {
        label: t('uninstall'),
        click: async () => {
          const result = await LunaModal.confirm(
            confirmText('uninstallConfirm', info)
          )
          if (result) {
            await main.uninstallPackage(device.id, info.packageName)
            refresh()
          }
        },
      },
    ]

    contextMenu(e, template)
  }

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarInput
          keyName="filter"
          value={filter}
          placeholder={t('filter')}
          onChange={(val) => setFilter(val)}
        />
        <LunaToolbarSpace />
        <ToolbarIcon
          icon="refresh"
          title={t('refresh')}
          disabled={!device || isLoading}
          onClick={refresh}
        />
      </LunaToolbar>
      <div className={className('panel-body', Style.body)}>
        <Section className={Style.deviceSection} title="设备">
          <DeviceDashboard
            active={store.panel === 'precisionLearning'}
            embedded={true}
          />
        </Section>
        <Section
          className={Style.packagesSection}
          title={`JZX 应用 ${displayPackages.length}/${packages.length}`}
        >
          {renderSectionContent({
            data: displayPackages,
            onClick: showInfo,
            onDoubleClick: open,
            onContextMenu,
            emptyText: '暂无 JZX 配置应用',
            gridRef: packagesGridRef,
            isLoading,
            showDeviceTip: !device,
            total: packages.length,
          })}
        </Section>
      </div>
      {packageInfo && (
        <PackageInfoModal
          packageInfo={packageInfo}
          visible={packageInfoModalVisible}
          onClose={() => setPackageInfoModalVisible(false)}
        />
      )}
    </div>
  )
})

interface ISectionContentOptions {
  data: IDisplayRow[]
  emptyText: string
  gridRef: React.RefObject<DataGrid | null>
  isLoading?: boolean
  onClick: (packageName: string) => void
  onContextMenu: (e: PointerEvent, row: IRow) => void
  onDoubleClick: (packageName: string) => void
  showDeviceTip?: boolean
  total: number
}

function renderSectionContent(options: ISectionContentOptions): ReactNode {
  const {
    data,
    emptyText,
    gridRef,
    isLoading,
    onClick,
    onContextMenu,
    onDoubleClick,
    showDeviceTip,
    total,
  } = options

  if (showDeviceTip) {
    return <div className={Style.empty}>{t('deviceNotConnected')}</div>
  }

  if (isLoading) {
    return <PannelLoading />
  }

  if (!total) {
    return <div className={Style.empty}>{emptyText}</div>
  }

  if (!data.length) {
    return <div className={Style.empty}>未找到匹配结果</div>
  }

  return (
    <LunaDataGrid
      className={Style.packages}
      columns={columns}
      data={data}
      selectable={true}
      uniqueId="id"
      onClick={(e: any, node) => {
        const row = (node.data as any).row as IRow
        if (row.info) {
          onClick((node.data as any).packageNameRaw)
        }
      }}
      onDoubleClick={(e: any, node) => {
        const row = (node.data as any).row as IRow
        if (row.info) {
          onDoubleClick((node.data as any).packageNameRaw)
        }
      }}
      onContextMenu={(e: any, node) => {
        onContextMenu(e, (node.data as any).row)
      }}
      onCreate={(dataGrid) => {
        gridRef.current = dataGrid
        dataGrid.fit()
      }}
    />
  )
}

interface ISectionProps {
  children: ReactNode
  className?: string
  title: string
}

function Section(props: ISectionProps) {
  return (
    <section className={className(Style.section, props.className)}>
      <div className={Style.sectionHeader}>
        <span className={Style.sectionTitle}>{props.title}</span>
      </div>
      <div className={Style.sectionBody}>{props.children}</div>
    </section>
  )
}

function getDisplayPackages(packages: IRow[], keyword: string): IDisplayRow[] {
  const tokens = keyword
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  return packages
    .map((pkg) => {
      const matchIndexes: Record<keyof IRow, number[]> = {
        packageName: [],
        deviceLabel: [],
        configLabel: [],
        versionName: [],
      }

      for (const token of tokens) {
        let matched = false

        for (const field of searchFields) {
          const indexes = getMatchIndexes(pkg[field], token)
          if (indexes.length) {
            matchIndexes[field].push(...indexes)
            matched = true
            break
          }
        }

        if (!matched) {
          return null
        }
      }

      return {
        id: pkg.id,
        row: pkg,
        packageNameRaw: pkg.packageName,
        packageName: renderHighlightedText(
          pkg.packageName,
          matchIndexes.packageName
        ),
        deviceLabel: renderHighlightedText(
          pkg.deviceLabel,
          matchIndexes.deviceLabel
        ),
        configLabel: renderHighlightedText(
          pkg.configLabel,
          matchIndexes.configLabel
        ),
        versionName: renderHighlightedText(
          pkg.versionName,
          matchIndexes.versionName
        ),
      }
    })
    .filter((pkg): pkg is IDisplayRow => pkg !== null)
}

function getMatchIndexes(text: string, keyword: string): number[] {
  const normalizedText = text.toLowerCase()
  const normalizedKeyword = keyword.toLowerCase()

  const start = normalizedText.indexOf(normalizedKeyword)
  if (start !== -1) {
    const indexes: number[] = []
    for (let i = start; i < start + normalizedKeyword.length; i++) {
      indexes.push(i)
    }
    return indexes
  }

  const indexes: number[] = []
  let cursor = 0

  for (const char of normalizedKeyword) {
    const idx = normalizedText.indexOf(char, cursor)
    if (idx === -1) {
      return []
    }
    indexes.push(idx)
    cursor = idx + 1
  }

  return indexes
}

function getMergedPackages(packageInfos: IPackageInfo[]): IRow[] {
  for (const info of packageInfos) {
    // Ignore system apps in case the upstream package list changes.
    if (info.system) {
      continue
    }
  }

  return packageInfos
    .filter((info) => !info.system)
    .map((info) => ({
      id: info.packageName,
      packageName: info.packageName,
      deviceLabel: info.label || '',
      configLabel: (CONFIG_LABELS_BY_PACKAGE[info.packageName] || []).join(
        ' / '
      ),
      versionName: info.versionName || '',
      info,
    }))
}

async function getPackageInfosByChunks(deviceId: string, packageNames: string[]) {
  let packageInfos: IPackageInfo[] = []

  for (const names of chunk(packageNames, 50)) {
    packageInfos = packageInfos.concat(await main.getPackageInfos(deviceId, names))
  }

  return packageInfos
}

function renderHighlightedText(text: string, indexes: number[]): HTMLElement {
  const el = document.createElement('span')
  if (!indexes.length) {
    el.textContent = text
    return el
  }

  const matched = new Set(indexes)
  let start = 0

  while (start < text.length) {
    const highlighted = matched.has(start)
    let end = start + 1
    while (end < text.length && matched.has(end) === highlighted) {
      end++
    }

    const content = text.slice(start, end)
    if (highlighted) {
      const mark = document.createElement('span')
      mark.className = Style.match
      mark.textContent = content
      el.appendChild(mark)
    } else {
      el.appendChild(document.createTextNode(content))
    }

    start = end
  }

  return el
}

function getConfigLabelsByPackage() {
  const result: Record<string, string[]> = {}

  for (const item of FIXED_PACKAGES) {
    if (!result[item.packageName]) {
      result[item.packageName] = []
    }

    if (!result[item.packageName].includes(item.label)) {
      result[item.packageName].push(item.label)
    }
  }

  return result
}

const columns = [
  {
    id: 'packageName',
    title: t('package'),
    sortable: true,
    weight: 28,
  },
  {
    id: 'deviceLabel',
    title: '设备上应用名称',
    sortable: true,
    weight: 24,
  },
  {
    id: 'configLabel',
    title: 'JZX 配置名称',
    sortable: true,
    weight: 30,
  },
  {
    id: 'versionName',
    title: t('version'),
    sortable: true,
    weight: 18,
  },
]
