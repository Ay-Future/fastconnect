import { observer } from 'mobx-react-lite'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useEffect, useRef } from 'react'
import {
  colorBgContainer,
  colorBgContainerDark,
  colorPrimary,
  colorText,
  colorTextDark,
  fontFamilyCode,
} from 'common/theme'
import copy from 'licia/copy'
import isHidden from 'licia/isHidden'
import contextMenu from 'share/renderer/lib/contextMenu'
import { t } from 'common/util'
import store from '../../store'
import Style from './DevboxTerm.module.scss'
import '@xterm/xterm/css/xterm.css'

interface IDevboxTermProps {
  visible: boolean
  sessionId: string
}

export default observer(function DevboxTerm(props: IDevboxTermProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal>(null)
  const fitAddonRef = useRef<FitAddon>(null)
  const sessionIdRef = useRef('')

  useEffect(() => {
    const term = new Terminal({
      allowProposedApi: true,
      fontSize: 14,
      fontFamily: fontFamilyCode,
      theme: getTheme(store.theme === 'dark'),
      cursorBlink: true,
      scrollback: 6000,
    })

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)

    const fit = () => {
      if (!isHidden(terminalRef.current!)) {
        fitAddon.fit()
      }
    }
    window.addEventListener('resize', fit)

    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      term.loadAddon(new CanvasAddon())
    }

    term.open(terminalRef.current!)
    termRef.current = term

    const offDevboxData = main.on('devboxData', (id, data) => {
      if (sessionIdRef.current !== id) {
        return
      }
      term.write(data)
    })

    term.onData((data) => {
      if (sessionIdRef.current) {
        main.writeDevboxSession(sessionIdRef.current, data)
      }
    })

    term.onResize((size) => {
      if (sessionIdRef.current) {
        main.resizeDevboxSession(sessionIdRef.current, size.cols, size.rows)
      }
    })

    fit()

    return () => {
      offDevboxData()
      term.dispose()
      window.removeEventListener('resize', fit)
    }
  }, [])

  useEffect(() => {
    sessionIdRef.current = props.sessionId
    if (fitAddonRef.current && props.visible) {
      fitAddonRef.current.fit()
    }

    if (props.visible) {
      setTimeout(() => {
        if (termRef.current) {
          termRef.current.focus()
        }
      }, 100)
    }
  }, [props.sessionId, props.visible])

  const theme = getTheme(store.theme === 'dark')
  if (termRef.current) {
    termRef.current.options.theme = theme
  }

  const onContextMenu = (e: React.MouseEvent) => {
    const term = termRef.current
    if (!term) {
      return
    }

    contextMenu(e, [
      {
        label: t('copy'),
        click() {
          if (term.hasSelection()) {
            copy(term.getSelection())
            term.focus()
          }
        },
      },
      {
        label: t('paste'),
        click: async () => {
          const text = await navigator.clipboard.readText()
          if (text && sessionIdRef.current) {
            main.writeDevboxSession(sessionIdRef.current, text)
          }
        },
      },
      {
        label: t('selectAll'),
        click() {
          term.selectAll()
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('clear'),
        click() {
          term.clear()
          term.focus()
        },
      },
    ])
  }

  return (
    <div
      className={Style.term}
      style={{ display: props.visible ? 'block' : 'none' }}
      ref={terminalRef}
      onContextMenu={onContextMenu}
    />
  )
})

function getTheme(dark = false) {
  let theme: ITheme = {
    background: colorBgContainer,
    foreground: colorText,
    cursor: colorText,
  }

  if (dark) {
    theme = {
      background: colorBgContainerDark,
      foreground: colorTextDark,
      cursor: colorTextDark,
    }
  }

  return {
    selectionForeground: '#fff',
    selectionBackground: colorPrimary,
    ...theme,
  }
}
