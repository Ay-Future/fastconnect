import { observer } from 'mobx-react-lite'
import Style from './Tree.module.scss'
import { JSX, useEffect, useMemo, useRef, useState } from 'react'
import xpath from 'licia/xpath'
import copy from 'licia/copy'
import { Document, Element } from '@xmldom/xmldom'
import { t } from 'common/util'
import CopyButton from 'share/renderer/components/CopyButton'
import { PannelLoading } from '../common/loading'
import each from 'licia/each'
import className from 'licia/className'

interface IProps {
  hierarchy?: Document
  selected: Element | null
  isLoading: boolean
  onSelect?: (el: Element) => void
  onTreeCreate?: (tree: ITreeHandle) => void
}

export interface ITreeHandle {
  collapse: (recursive?: boolean) => void
  expand: (recursive?: boolean) => void
  select: (el: Element | null) => void
}

export default observer(function Tree(props: IProps) {
  const treeRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const allKeysRef = useRef<string[]>([])
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set(['0']))
  const [selectedKey, setSelectedKey] = useState('')

  const root = props.hierarchy?.documentElement

  useEffect(() => {
    if (!root) {
      allKeysRef.current = []
      setExpandedKeys(new Set(['0']))
      setSelectedKey('')
      return
    }

    const nextKeys: string[] = []
    collectKeys(root, '0', nextKeys)
    allKeysRef.current = nextKeys
    setExpandedKeys(new Set(['0']))
    setSelectedKey('')
  }, [root])

  useEffect(() => {
    const handle: ITreeHandle = {
      expand(recursive = false) {
        if (recursive) {
          setExpandedKeys(new Set(allKeysRef.current))
        } else {
          setExpandedKeys(new Set(['0']))
        }
      },
      collapse() {
        setExpandedKeys(new Set())
      },
      select(el) {
        if (!el || !root) {
          setSelectedKey('')
          return
        }

        const key = findElementKey(root, el, '0')
        if (key) {
          revealKey(key)
        }
      },
    }

    props.onTreeCreate?.(handle)
  }, [props.onTreeCreate, root])

  useEffect(() => {
    if (!props.selected || !root) {
      setSelectedKey('')
      return
    }

    const key = findElementKey(root, props.selected, '0')
    if (key) {
      revealKey(key)
    }
  }, [props.selected, root])

  const path = useMemo(
    () =>
      props.selected
        ? xpath(props.selected as any, true).replace(/@id=/g, '@resource-id=')
        : '',
    [props.selected]
  )

  function revealKey(key: string) {
    setSelectedKey(key)
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      const parts = key.split('/')
      for (let i = 0; i < parts.length; i++) {
        next.add(parts.slice(0, i + 1).join('/'))
      }
      return next
    })

    setTimeout(() => {
      nodeRefs.current[key]?.scrollIntoView({
        block: 'nearest',
      })
    }, 0)
  }

  let content: JSX.Element | null = null
  if (props.isLoading && !root) {
    content = <PannelLoading />
  } else if (root) {
    content = (
      <div className={Style.treeContent}>
        <TreeNode
          depth={0}
          element={root}
          expandedKeys={expandedKeys}
          nodeRefs={nodeRefs}
          onSelect={props.onSelect}
          selectedKey={selectedKey}
          setExpandedKeys={setExpandedKeys}
          treeKey="0"
        />
      </div>
    )
  }

  return (
    <div className={Style.container} ref={treeRef}>
      <div className={Style.tree}>
        {content}
      </div>
      <div className={Style.xpathContainer}>
        <div className={Style.xpath}>{path || t('componentNotSelected')}</div>
        <CopyButton
          onClick={() => {
            if (path) {
              copy(path)
            }
          }}
        />
      </div>
    </div>
  )
})

interface ITreeNodeProps {
  depth: number
  element: Element
  expandedKeys: Set<string>
  nodeRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  onSelect?: (el: Element) => void
  selectedKey: string
  setExpandedKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  treeKey: string
}

const TreeNode = function (props: ITreeNodeProps) {
  const children = getElementChildren(props.element)
  const isExpanded = props.expandedKeys.has(props.treeKey)
  const isSelected = props.selectedKey === props.treeKey

  function toggle() {
    props.setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(props.treeKey)) {
        next.delete(props.treeKey)
      } else {
        next.add(props.treeKey)
      }
      return next
    })
  }

  return (
    <div className={Style.node}>
      <div
        ref={(el) => (props.nodeRefs.current[props.treeKey] = el)}
        className={className(Style.nodeRow, {
          [Style.selected]: isSelected,
        })}
        style={{ paddingLeft: 8 + props.depth * 16 }}
        onClick={() => props.onSelect?.(props.element)}
      >
        {children.length ? (
          <button
            className={Style.toggle}
            onClick={(e) => {
              e.stopPropagation()
              toggle()
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className={Style.togglePlaceholder} />
        )}
        <span className={Style.label}>{getElementLabel(props.element)}</span>
      </div>
      {children.length && isExpanded ? (
        <div>
          {children.map((child, idx) => (
            <TreeNode
              key={`${props.treeKey}/${idx}`}
              depth={props.depth + 1}
              element={child}
              expandedKeys={props.expandedKeys}
              nodeRefs={props.nodeRefs}
              onSelect={props.onSelect}
              selectedKey={props.selectedKey}
              setExpandedKeys={props.setExpandedKeys}
              treeKey={`${props.treeKey}/${idx}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function getElementChildren(element: Element) {
  const children: Element[] = []

  each(element.childNodes, (child) => {
    if (child.nodeType === 1) {
      children.push(child as Element)
    }
  })

  return children
}

function getElementLabel(element: Element) {
  const tagName = element.getAttribute('class') || element.tagName
  const resourceId = element.getAttribute('resource-id')
  const text = element.getAttribute('text')
  const pieces = [tagName]

  if (resourceId) {
    pieces.push(`#${resourceId}`)
  }
  if (text) {
    pieces.push(`"${text}"`)
  }

  return pieces.join(' ')
}

function collectKeys(element: Element, key: string, keys: string[]) {
  keys.push(key)

  const children = getElementChildren(element)
  children.forEach((child, idx) => {
    collectKeys(child, `${key}/${idx}`, keys)
  })
}

function findElementKey(root: Element, target: Element, key: string): string {
  if (root === target) {
    return key
  }

  const children = getElementChildren(root)
  for (let i = 0; i < children.length; i++) {
    const found = findElementKey(children[i], target, `${key}/${i}`)
    if (found) {
      return found
    }
  }

  return ''
}
