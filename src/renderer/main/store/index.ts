import { action, makeObservable, observable, runInAction } from 'mobx'
import isStr from 'licia/isStr'
import find from 'licia/find'
import BaseStore from 'share/renderer/store/BaseStore'
import { Settings } from './settings'
import { Application } from './application'
import { Process } from './process'
import { Webview } from './webview'
import { File } from './file'
import { Layout } from './layout'
import { installPackages, setMainStore } from '../../lib/util'
import { setMemStore } from 'share/renderer/lib/util'
import isEmpty from 'licia/isEmpty'
import { IDevice } from 'common/types'

export const VALID_PANELS = [
  'overview',
  'file',
  'application',
  'process',
  'performance',
  'shell',
  'layout',
  'screenshot',
  'logcat',
  'httpCapture',
  'webview',
  'precisionLearning',
  'devbox',
  'questionDebug',
  'proxySettings',
  'testSession',
] as const

const LEGACY_PANEL_MAP: Record<string, string> = {
  device: 'precisionLearning',
  deviceDashboard: 'precisionLearning',
}

export function normalizePanel(panel: string) {
  if (LEGACY_PANEL_MAP[panel]) {
    return LEGACY_PANEL_MAP[panel]
  }

  return panel
}

export function getSafePanel(panel: string) {
  const normalizedPanel = normalizePanel(panel)

  if ((VALID_PANELS as readonly string[]).includes(normalizedPanel)) {
    return normalizedPanel
  }

  if (normalizedPanel) {
    console.warn('Unknown panel name, fallback to overview', normalizedPanel)
  }

  return 'overview'
}

class Store extends BaseStore {
  devices: IDevice[] = []
  device: IDevice | null = null
  panel: string = 'overview'
  settings = new Settings()
  application = new Application()
  process = new Process()
  webview = new Webview()
  file = new File()
  layout = new Layout()
  ready = false
  constructor() {
    super()

    makeObservable(this, {
      devices: observable,
      device: observable,
      panel: observable,
      settings: observable,
      ready: observable,
      selectDevice: action,
      selectPanel: action,
    })

    this.bindEvent()
    this.init()
  }
  selectDevice = (device: string | IDevice | null) => {
    if (isStr(device)) {
      const d = find(this.devices, ({ id }) => id === device)
      if (d) {
        this.device = d
      }
    } else {
      this.device = device
    }

    setMainStore('device', this.device)
  }
  selectPanel(panel: string) {
    const nextPanel = getSafePanel(panel)
    this.panel = nextPanel
    setMainStore('panel', nextPanel)
  }
  private async init() {
    try {
      const panel = await main.getMainStore('panel')
      const nextPanel = getSafePanel(panel || '')
      runInAction(() => (this.panel = nextPanel))
      if (nextPanel !== panel) {
        setMainStore('panel', nextPanel)
      }

      const device = await main.getMainStore('device')
      if (device) {
        runInAction(() => (this.device = device))
      }
      await this.refreshDevices()

      const openFile = await main.getOpenFile('.apk')
      if (openFile && this.device) {
        installPackages(this.device.id, [openFile])
      }
    } catch (error) {
      console.error('Failed to initialize renderer store', error)
      runInAction(() => {
        this.devices = []
      })
    } finally {
      this.ready = true
    }
  }
  refreshDevices = async () => {
    try {
      const devices = await main.getDevices()
      runInAction(() => {
        this.devices = devices
        setMemStore('devices', devices)
      })
      if (!isEmpty(devices)) {
        if (!this.device) {
          this.selectDevice(devices[0])
        } else {
          const device = find(devices, ({ id }) => id === this.device!.id)
          if (!device) {
            this.selectDevice(devices[0])
          }
        }
      } else {
        if (this.device) {
          this.selectDevice(null)
        }
      }
    } catch (error) {
      console.error('Failed to refresh devices', error)
      runInAction(() => {
        this.devices = []
        setMemStore('devices', [])
      })
      if (this.device) {
        this.selectDevice(null)
      }
    }
  }
  private bindEvent() {
    main.on('changeDevice', this.refreshDevices)
    main.on('refreshDevices', this.refreshDevices)
    main.on('selectDevice', this.selectDevice)
    main.on('installPackage', async (path: string) => {
      if (this.device) {
        await installPackages(this.device.id, [path])
      }
    })
  }
}

export default new Store()
