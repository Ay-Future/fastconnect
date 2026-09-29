import { BrowserWindow } from 'electron'
import * as window from '../lib/window'

let win: BrowserWindow | null = null

export function showWin() {
  if (win) {
    win.focus()
    return
  }

  win = window.create({
    name: 'about',
    resizable: false,
    minWidth: 360,
    minHeight: 240,
    width: 360,
    height: 240,
  })

  win.on('close', () => {
    win?.destroy()
    win = null
  })

  window.loadPage(win, {
    page: 'about',
  })
}
