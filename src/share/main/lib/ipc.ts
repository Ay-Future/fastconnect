import { dialog, shell, app, ipcMain, BrowserWindow } from 'electron'
import * as window from './window'
import contextMenu from './contextMenu'
import { getOpenFileFromArgv, handleEvent, resolveResources } from './util'
import { getMemStore } from './store'
import log from '../../common/log'
import {
  IpcGetFileIcon,
  IpcGetOpenFile,
  IpcGetPath,
  IpcGetStore,
  IpcOpenExternal,
  IpcOpenPath,
  IpcOpenWindow,
  IpcResolveResources,
  IpcSendToWindow,
  IpcSetStore,
  IpcShowItemInFolder,
  IpcShowOpenDialog,
  IpcShowSaveDialog,
  IpcShowVideo,
} from '../../common/types'
import isMac from 'licia/isMac'
import endWith from 'licia/endWith'
import types from 'licia/types'
import * as terminal from '../window/terminal'
import * as video from '../window/video'
import * as processWindow from '../window/process'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import { getSettingsStore } from '../../../main/lib/store'

const settingsStore = getSettingsStore()
const memStore = getMemStore()

const logger = log('ipc')

const openWindow: IpcOpenWindow = (url, name, options) => {
  options = options || {}

  const { openDevTools, ...winOptions } = options

  const win = window.create({
    name: name || url,
    preload: false,
    customTitlebar: false,
    menu: false,
    ...winOptions,
  })

  if (openDevTools) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.openDevTools()
      }
    })
  }

  win.loadURL(url)
}

let openFile = ''
if (isMac) {
  app.on('open-file', (_, path) => {
    openFile = path
  })
}

const getOpenFile: IpcGetOpenFile = (ext) => {
  if (isMac && endWith(openFile, ext)) {
    return openFile
  }

  return getOpenFileFromArgv(process.argv, ext)
}

const fileIcons: types.PlainObj<string> = {}
const getFileIcon: IpcGetFileIcon = async (ext) => {
  if (fileIcons[ext]) {
    return fileIcons[ext]
  }

  let dataUrl =
    'data:image/svg+xml;base64,PHN2ZyB0PSIxNzM2NDI4Mzk1MTI4IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIgogIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgcC1pZD0iMTI4NiIgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiPgogIDxwYXRoCiAgICBkPSJNMTYwIDMyYy0xMiAwLTI0LjggNC44LTMzLjYgMTQuNFMxMTIgNjggMTEyIDgwdjg2NGMwIDEyIDQuOCAyNC44IDE0LjQgMzMuNiA5LjYgOS42IDIxLjYgMTQuNCAzMy42IDE0LjRoNzA0YzEyIDAgMjQuOC00LjggMzMuNi0xNC40IDkuNi05LjYgMTQuNC0yMS42IDE0LjQtMzMuNlYzMDRMNjQwIDMySDE2MHoiCiAgICBmaWxsPSIjRTVFNUU1IiBwLWlkPSIxMjg3Ij48L3BhdGg+CiAgPHBhdGggZD0iTTkxMiAzMDRINjg4Yy0xMiAwLTI0LjgtNC44LTMzLjYtMTQuNC05LjYtOC44LTE0LjQtMjEuNi0xNC40LTMzLjZWMzJsMjcyIDI3MnoiCiAgICBmaWxsPSIjQ0NDQ0NDIiBwLWlkPSIxMjg4Ij48L3BhdGg+Cjwvc3ZnPg=='

  if (!ext) {
    return dataUrl
  }

  const p = path.resolve(os.tmpdir(), `rem-file${ext}`)
  await fs.writeFile(p, '')
  try {
    const image = await app.getFileIcon(p, {
      size: isMac ? 'normal' : 'large',
    })
    dataUrl = image.toDataURL()
  } catch {
    // ignore
  }
  fileIcons[ext] = dataUrl
  return fileIcons[ext]
}

export function init() {
  logger.info('init')

  handleEvent('setSettingsStore', <IpcSetStore>((name, val) => {
    settingsStore.set(name, val)
  }))
  handleEvent('getSettingsStore', <IpcGetStore>(
    ((name) => settingsStore.get(name))
  ))
  settingsStore.on('change', (name, val) => {
    window.sendAll('changeSettingsStore', name, val)
  })
  handleEvent('showOpenDialog', <IpcShowOpenDialog>(
    ((options) => dialog.showOpenDialog(options))
  ))
  handleEvent('showSaveDialog', <IpcShowSaveDialog>(
    ((options) => dialog.showSaveDialog(options))
  ))
  handleEvent('openExternal', <IpcOpenExternal>((url) => {
    shell.openExternal(url)
  }))
  handleEvent('toggleDevTools', () => {
    const win = window.getFocusedWin()
    if (win) {
      win.webContents.toggleDevTools()
    }
  })
  handleEvent('sendToWindow', <IpcSendToWindow>((name, channel, ...args) => {
    window.sendTo(name, channel, ...args)
  }))
  handleEvent('setMemStore', <IpcSetStore>((name, val) => {
    memStore.set(name, val)
  }))
  handleEvent('getMemStore', <IpcGetStore>((name) => memStore.get(name)))
  memStore.on('change', (name, val) => {
    window.sendAll('changeMemStore', name, val)
  })
  ipcMain.handle('showContextMenu', (event, x, y, template) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.focus()
      contextMenu(x, y, template)
    }
  })
  ipcMain.handle('closeWin', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.close()
    }
  })
  ipcMain.handle('hideWin', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.hide()
    }
  })
  ipcMain.handle('toggleWinMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })
  handleEvent('relaunch', () => {
    app.relaunch()
    app.exit()
  })
  handleEvent('openPath', <IpcOpenPath>((path: string) => {
    shell.openPath(path)
  }))
  handleEvent('showItemInFolder', <IpcShowItemInFolder>((path: string) => {
    shell.showItemInFolder(path)
  }))
  handleEvent('openWindow', openWindow)
  ipcMain.handle('isCustomTitlebar', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    if (win) {
      return (win as any).customTitlebar
    }

    return true
  })
  handleEvent('getOpenFile', getOpenFile)
  handleEvent('showTerminal', () => terminal.showWin())
  handleEvent('showVideo', <IpcShowVideo>((url) => video.showWin(url)))
  handleEvent('showProcess', () => processWindow.showWin())
  handleEvent('resolveResources', <IpcResolveResources>(
    ((p: string) => resolveResources(p))
  ))
  handleEvent('getCpuAndMem', processWindow.getCpuAndMem)
  handleEvent('getFileIcon', getFileIcon)
  handleEvent('getPath', <IpcGetPath>((name) => app.getPath(name)))
}
