import LunaToolbar, {
  LunaToolbarButton,
  LunaToolbarCheckbox,
  LunaToolbarSeparator,
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import { observer } from 'mobx-react-lite'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { t } from 'common/util'
import Style from './Layout.module.scss'
import Tree, { ITreeHandle } from './Tree'
import Detail from './Detail'
import Screenshot, { IImage } from './Screenshot'
import className from 'licia/className'
import { useEffect, useRef, useState } from 'react'
import store from '../../store'
import copy from 'licia/copy'
import dataUrl from 'licia/dataUrl'
import each from 'licia/each'
import toNum from 'licia/toNum'
import toStr from 'licia/toStr'
import CopyButton from 'share/renderer/components/CopyButton'
import { xmlToDom } from '../../lib/util'
import { Document, Element } from '@xmldom/xmldom'
import loadImg from 'licia/loadImg'
import download from 'licia/download'
import toBool from 'licia/toBool'
import ImageViewer from 'luna-image-viewer'
import isEmpty from 'licia/isEmpty'
import LunaSplitPane, { LunaSplitPaneItem } from 'luna-split-pane/react'
import { notify } from 'share/renderer/lib/util'
import { PannelLoading } from '../common/loading'

export default observer(function Layout() {
  const [image, setImage] = useState<IImage>({
    url: '',
    width: 0,
    height: 0,
  })
  const imageViewerRef = useRef<ImageViewer>(null)
  const treeRef = useRef<ITreeHandle>(null)
  const windowHierarchyRef = useRef('')
  const [hierarchy, setHierarchy] = useState<any>(null)
  const [selected, setSelected] = useState<Element | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const { device, layout } = store

  useEffect(() => {
    setImage({
      url: '',
      width: 0,
      height: 0,
    })
    windowHierarchyRef.current = ''
    setHierarchy(null)
    setSelected(null)
    setError('')
  }, [device?.id])

  useEffect(() => {
    if (store.panel === 'layout') {
      refresh()
    }
  }, [device?.id, store.panel])

  async function refresh() {
    if (!device || isLoading) {
      return
    }

    let step = '开始加载布局'

    try {
      setIsLoading(true)
      setError('')

      step = '抓取截图'
      const data = await main.screencap(device.id)
      step = '生成截图地址'
      const url = dataUrl.stringify(data, 'image/png')
      step = '解析截图尺寸'
      const img = await loadLayoutImage(url)

      setImage({
        url,
        width: img.width,
        height: img.height,
      })
      setSelected(null)
      step = '抓取窗口层级'
      windowHierarchyRef.current = await main.dumpWindowHierarchy(device.id)
      step = '解析窗口层级 XML'
      const doc = xmlToDom(windowHierarchyRef.current)
      step = '转换窗口层级节点'
      transformHierarchy(doc, windowHierarchyRef.current)
      step = '更新布局视图'
      setHierarchy(doc)
    } catch (err) {
      const message = err instanceof Error ? err.message : toStr(err)
      const errorText = `${step}失败${message ? `：${message}` : ''}`
      console.error('layout refresh failed', { step, err })
      setError(errorText)
      notify(errorText, { icon: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  function save() {
    download(windowHierarchyRef.current, 'window_hierarchy.xml', 'text/xml')
  }

  function select(el: Element) {
    if (treeRef.current) {
      treeRef.current.select(el)
    }
    setSelected(el)
  }

  const hasImage = toBool(image.url)
  let content: React.ReactNode = null

  if (!device) {
    content = (
      <div className={className('panel-body', Style.state)}>
        {t('deviceNotConnected')}
      </div>
    )
  } else if (isLoading && !hierarchy) {
    content = <PannelLoading />
  } else if (error && !hierarchy) {
    content = <div className={className('panel-body', Style.state)}>{error}</div>
  } else {
    content = (
      <div className={className('panel-body', Style.body)}>
        <LunaSplitPane onResize={(weights) => layout.set('weights', weights)}>
          <LunaSplitPaneItem minSize={250} weight={layout.weights[0]}>
            <Tree
              hierarchy={hierarchy}
              isLoading={isLoading}
              onSelect={select}
              selected={selected}
              onTreeCreate={(tree) => {
                tree.expand()
                treeRef.current = tree
              }}
            />
          </LunaSplitPaneItem>
          <LunaSplitPaneItem minSize={200} weight={layout.weights[1]}>
            <Screenshot
              image={image}
              hierarchy={hierarchy}
              selected={selected}
              onImageViewerCreate={(imageViewer) =>
                (imageViewerRef.current = imageViewer)
              }
              onSelect={select}
            />
          </LunaSplitPaneItem>
          <LunaSplitPaneItem minSize={250} weight={layout.weights[2]}>
            <Detail selected={selected} />
          </LunaSplitPaneItem>
        </LunaSplitPane>
      </div>
    )
  }

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar className="panel-toolbar">
        <ToolbarIcon
          icon="refresh"
          title={t('refresh')}
          onClick={refresh}
          disabled={!device}
        />
        <ToolbarIcon
          icon="save"
          title={t('save')}
          onClick={save}
          disabled={!windowHierarchyRef.current}
        />
        <LunaToolbarButton
          onClick={() => {}}
          disabled={!windowHierarchyRef.current}
        >
          <CopyButton
            className="toolbar-icon"
            onClick={() => copy(windowHierarchyRef.current)}
          />
        </LunaToolbarButton>
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="expand"
          title={t('expandAll')}
          onClick={() => treeRef.current?.expand(true)}
          disabled={!windowHierarchyRef.current}
        />
        <ToolbarIcon
          icon="collapse"
          title={t('collapseAll')}
          onClick={() => treeRef.current?.collapse(true)}
          disabled={!windowHierarchyRef.current}
        />
        <LunaToolbarCheckbox
          keyName="attribute"
          label={t('showAttr')}
          value={layout.attribute}
          onChange={(value) => (layout.attribute = value)}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="rotate-left"
          title={t('rotateLeft')}
          onClick={() => imageViewerRef.current?.rotate(-90)}
          disabled={!hasImage}
        />
        <ToolbarIcon
          icon="rotate-right"
          title={t('rotateRight')}
          onClick={() => imageViewerRef.current?.rotate(90)}
          disabled={!hasImage}
        />
        <ToolbarIcon
          icon="zoom-in"
          title={t('zoomIn')}
          onClick={() => imageViewerRef.current?.zoom(0.1)}
          disabled={!hasImage}
        />
        <ToolbarIcon
          icon="zoom-out"
          title={t('zoomOut')}
          onClick={() => imageViewerRef.current?.zoom(-0.1)}
          disabled={!hasImage}
        />
        <ToolbarIcon
          icon="original"
          title={t('actualSize')}
          onClick={() => imageViewerRef.current?.zoomTo(1)}
          disabled={!hasImage}
        />
        <ToolbarIcon
          icon="reset"
          title={t('reset')}
          onClick={() => imageViewerRef.current?.reset()}
          disabled={!hasImage}
        />
        <LunaToolbarCheckbox
          keyName="border"
          label={t('showBorder')}
          value={layout.border}
          onChange={(value) => (layout.border = value)}
        />
        <LunaToolbarSpace />
        <LunaToolbarText
          text={image.url ? `${image.width}x${image.height}` : ''}
        />
      </LunaToolbar>
      {content}
    </div>
  )
})

function loadLayoutImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    loadImg(url, (err, img) => {
      if (err || !img) {
        reject(err || new Error('load image failed'))
        return
      }

      resolve(img)
    })
  })
}

function changeElType(doc: Document, oldEl: Element, newType: string): Element {
  const newEl = doc.createElement(newType)

  for (const attr of oldEl.attributes) {
    newEl.setAttribute(attr.name, attr.value)
  }

  while (oldEl.firstChild) {
    newEl.appendChild(oldEl.firstChild)
  }

  if (oldEl.parentNode) {
    oldEl.parentNode.replaceChild(newEl, oldEl)
  }

  return newEl
}

function transformHierarchy(hierarchy: Document, windowHierarchy: string) {
  const resourceIds = windowHierarchy.match(/resource-id="([^"]+)"/g) || []
  const resourceIdsMap: Record<string, number> = {}
  each(resourceIds, (resourceId) => {
    const count = resourceIdsMap[resourceId] || 0
    resourceIdsMap[resourceId] = count + 1
  })

  const transformRecursively = (el: Element) => {
    const className = el.getAttribute('class')
    if (className) {
      el = changeElType(hierarchy, el, className)
    }

    const resourceId = el.getAttribute('resource-id') || ''
    if (resourceId) {
      if (resourceIdsMap[`resource-id="${resourceId}"`] === 1) {
        el.setAttribute('id', resourceId)
      }
    }

    const bounds = el.getAttribute('bounds')
    if (bounds) {
      const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
      if (match) {
        const left = toNum(match[1])
        const top = toNum(match[2])
        const right = toNum(match[3])
        const bottom = toNum(match[4])
        el.setAttribute('x', toStr(left))
        el.setAttribute('y', toStr(top))
        el.setAttribute('width', toStr(right - left))
        el.setAttribute('height', toStr(bottom - top))
      }
    }

    const text = el.getAttribute('text')
    if (text && isEmpty(el.childNodes)) {
      el.appendChild(hierarchy.createTextNode(text))
    } else {
      each(el.childNodes, (child) => {
        if (child.nodeType !== 1) {
          return
        }
        transformRecursively(child as Element)
      })
    }
  }

  if (hierarchy.documentElement) {
    transformRecursively(hierarchy.documentElement)
  }
}
