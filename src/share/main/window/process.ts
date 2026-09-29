import { BrowserWindow, app, webContents } from 'electron'
import * as window from '../../main/lib/window'
import once from 'licia/once'
import { handleEvent } from '../lib/util'
import {
  IpcGetCpuAndMem,
  IpcGetProcessData,
  IpcKillProcess,
  IpcOpenDevtools,
  IProcess,
} from '../../common/types'
import map from 'licia/map'
import { t } from '../../common/i18n'
import { isDev } from '../../common/util'
import isEmpty from 'licia/isEmpty'
import singleton from 'licia/singleton'
import each from 'licia/each'
import os from 'os'

let win: BrowserWindow | null = null

export function showWin() {
  if (win) {
    win.focus()
    return
  }

  initIpc()

  win = window.create({
    name: 'process',
    width: 640,
    height: 480,
    minWidth: 640,
    minHeight: 480,
  })

  win.on('close', () => {
    win?.destroy()
    win = null
  })

  window.loadPage(win, { page: 'process' })
}

let debugWin: BrowserWindow | null = null

export async function debugMainProcess() {
  if (!isDev()) {
    return
  }

  if (debugWin) {
    debugWin.focus()
    return
  }

  const json = await fetch('http://127.0.0.1:9229/json/list').then((res) =>
    res.json()
  )

  if (!isEmpty(json)) {
    const url = json[0].devtoolsFrontendUrl
    debugWin = window.create({
      name: 'devtools',
      preload: false,
      customTitlebar: false,
      menu: false,
    })

    debugWin.loadURL(url)

    debugWin.on('close', () => {
      debugWin?.destroy()
      debugWin = null
    })
  }
}

const processCallbacks: Array<() => Promise<IProcess | void>> = []

export function addProcess(callback: () => Promise<IProcess | void>) {
  processCallbacks.push(callback)
}

const cpuNum = os.cpus().length

const getProcessData: IpcGetProcessData = singleton(async () => {
  const allWebContents = Object.fromEntries(
    map(webContents.getAllWebContents(), (webContent) => [
      webContent.getOSProcessId(),
      webContent,
    ])
  )

  const processData = map(app.getAppMetrics(), (metric) => {
    const ret: IProcess = {
      name: metric.name || metric.serviceName || '',
      pid: metric.pid,
      cpu: metric.cpu.percentCPUUsage * cpuNum,
      memory: metric.memory.workingSetSize,
      type: metric.type,
    }

    const webContent = allWebContents[metric.pid]
    if (webContent) {
      ret.name = webContent.getTitle() || ret.name
      ret.webContentsId = webContent.id
    }
    if (metric.pid === process.pid) {
      ret.name = t('mainProcess')
    }

    return ret
  })

  for (let i = 0, len = processCallbacks.length; i < len; i++) {
    const callback = processCallbacks[i]
    const process = await callback()
    if (process) {
      processData.push(process)
    }
  }

  return processData
})

export const getCpuAndMem: IpcGetCpuAndMem = async () => {
  const processData = await getProcessData()
  let cpu = 0
  let memory = 0
  each(processData, (p) => {
    cpu += p.cpu
    memory += p.memory
  })
  return {
    cpu: cpu / cpuNum,
    memory,
  }
}

const initIpc = once(() => {
  handleEvent('getProcessData', getProcessData)
  handleEvent('killProcess', <IpcKillProcess>((pid) => process.kill(pid)))
  handleEvent('openDevtools', <IpcOpenDevtools>((webContentsId) => {
    const wc = webContents.fromId(webContentsId)
    if (wc) {
      wc.openDevTools({ mode: 'detach' })
    }
  }))
  handleEvent('debugMainProcess', debugMainProcess)
})
