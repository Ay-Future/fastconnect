import Emitter from 'licia/Emitter'
import types from 'licia/types'
import { Client } from '@devicefarmer/adbkit'
import { getDeviceStore, getPidNames, setDeviceStore } from './base'
import uniqId from 'licia/uniqId'
import * as window from 'share/main/lib/window'
import { handleEvent } from 'share/main/lib/util'
import {
  IpcCloseLogcat,
  IpcOpenLogcat,
  IpcPauseLogcat,
  IpcResumeLogcat,
} from 'common/types'

let client: Client
const PID_NAMES_REFRESH_INTERVAL_MS = 5000

class Logcat extends Emitter {
  private reader: any
  private paused = false
  private pidNames: types.PlainObj<string> = {}
  private pidNamesRefreshPromise: Promise<void> | null = null
  private lastPidNamesRefreshAt = 0
  constructor(reader: any) {
    super()

    this.reader = reader
  }
  async init(deviceId: string) {
    const { reader } = this

    this.pidNames = getDeviceStore(deviceId, 'pidNames') || {}
    void this.refreshPidNames(deviceId)

    reader.on('entry', (entry) => {
      if (this.paused) {
        return
      }
      if (entry.pid != 0) {
        entry.package = this.pidNames[entry.pid] || `pid-${entry.pid}`
        if (!this.pidNames[entry.pid]) {
          void this.refreshPidNames(deviceId)
        }
      }
      this.emit('entry', entry)
    })
  }

  private async refreshPidNames(deviceId: string) {
    const now = Date.now()
    if (
      this.pidNamesRefreshPromise ||
      now - this.lastPidNamesRefreshAt < PID_NAMES_REFRESH_INTERVAL_MS
    ) {
      return this.pidNamesRefreshPromise
    }

    this.lastPidNamesRefreshAt = now
    const refreshPromise = getPidNames(deviceId)
      .then((pidNames) => {
        this.pidNames = pidNames
        setDeviceStore(deviceId, 'pidNames', pidNames)
      })
      .catch(() => {})
      .finally(() => {
        if (this.pidNamesRefreshPromise === refreshPromise) {
          this.pidNamesRefreshPromise = null
        }
      })
    this.pidNamesRefreshPromise = refreshPromise
    return refreshPromise
  }
  close() {
    this.reader.end()
  }
  pause() {
    this.paused = true
  }
  resume() {
    this.paused = false
  }
}

const logcats: types.PlainObj<Logcat> = {}

const openLogcat: IpcOpenLogcat = async function (deviceId) {
  const device = await client.getDevice(deviceId)
  const reader = await device.openLogcat({
    clear: true,
  })
  const logcat = new Logcat(reader)
  await logcat.init(deviceId)
  const logcatId = uniqId('logcat')
  logcat.on('entry', (entry) => {
    window.sendTo('main', 'logcatEntry', logcatId, entry)
  })
  logcats[logcatId] = logcat

  return logcatId
}

const pauseLogcat: IpcPauseLogcat = async function (logcatId) {
  const logcat = logcats[logcatId]
  if (!logcat) {
    return
  }
  logcat.pause()
}

const resumeLogcat: IpcResumeLogcat = async function (logcatId) {
  const logcat = logcats[logcatId]
  if (!logcat) {
    return
  }
  logcat.resume()
}

const closeLogcat: IpcCloseLogcat = async function (logcatId) {
  const logcat = logcats[logcatId]
  if (!logcat) {
    return
  }
  logcat.close()
  delete logcats[logcatId]
}

export function init(c: Client) {
  client = c

  handleEvent('openLogcat', openLogcat)
  handleEvent('closeLogcat', closeLogcat)
  handleEvent('pauseLogcat', pauseLogcat)
  handleEvent('resumeLogcat', resumeLogcat)
}
