import BaseStore from 'share/renderer/store/BaseStore'
import { IDevice, IScreencastTestSessionState } from 'common/types'
import { action, makeObservable, observable, runInAction, toJS } from 'mobx'
import ScrcpyClient from './lib/ScrcpyClient'
import { ScrcpyOptions3_1 } from '@yume-chan/scrcpy'
import defaults from 'licia/defaults'

class Store extends BaseStore {
  device!: IDevice
  scrcpyClient!: ScrcpyClient
  alwaysOnTop = false
  settings = defaultSettings
  screenOff = false
  recording = false
  testSession: IScreencastTestSessionState | null = null
  constructor() {
    super()

    makeObservable(this, {
      alwaysOnTop: observable,
      settings: observable,
      device: observable,
      screenOff: observable,
      recording: observable,
      testSession: observable,
      setAlwaysOnTop: action,
      turnOnScreen: action,
      turnOffScreen: action,
      startRecording: action,
      stopRecording: action,
      setTestSession: action,
    })

    this.init()
    this.bindEvent()
  }
  setAlwaysOnTop(val: boolean) {
    this.alwaysOnTop = val
    main.setScreencastStore('alwaysOnTop', val)
    main.setScreencastAlwaysOnTop(val)
  }
  turnOnScreen() {
    this.screenOff = false
    this.scrcpyClient.turnOnScreen()
  }
  turnOffScreen() {
    this.screenOff = true
    this.scrcpyClient.turnOffScreen()
  }
  async startRecording(filePath = '') {
    this.recording = true
    await this.scrcpyClient.startRecording(filePath)
  }
  stopRecording() {
    this.recording = false
    this.scrcpyClient.stopRecording()
  }
  setTestSession(val: IScreencastTestSessionState | null) {
    this.testSession = val
  }
  private syncTestSession = async (
    val: IScreencastTestSessionState | null
  ) => {
    const previousSession = this.testSession
    this.setTestSession(val)
    if (!this.scrcpyClient) {
      return
    }

    if (val?.recording) {
      if (!this.recording) {
        try {
          await this.startRecording(val.videoPath)
          main.sendToWindow('main', 'testSessionRecordingStarted')
        } catch (err: any) {
          console.error('test session recording start failed', err)
          runInAction(() => {
            this.recording = false
          })
          this.setTestSession(null)
          main.setScreencastStore('testSession', null)
          main.sendToWindow(
            'main',
            'testSessionRecordingStartFailed',
            err?.message || '录制启动失败'
          )
        }
      }
    } else if (this.recording) {
      if (previousSession?.videoPath) {
        await this.scrcpyClient.stopRecordingTo(previousSession.videoPath)
      } else {
        await this.scrcpyClient.stopRecording()
      }
      runInAction(() => {
        this.recording = false
      })
      main.sendToWindow('main', 'testSessionRecordingStopped')
    }
  }
  async setDevice(device: IDevice | null) {
    if (device === null) {
      main.closeScreencast()
    } else {
      const deviceSettings = await main.getScreencastStore('settings')
      let settings = { ...defaultSettings }
      if (deviceSettings[device.id]) {
        settings = defaults(deviceSettings[device.id], defaultSettings)
      }

      // Upgrade the old, intentionally constrained defaults. Previously these
      // values were also hard-capped at connection time, so the quality options
      // in the settings dialog could not take effect.
      if (
        settings.videoBitRate === legacyDefaultSettings.videoBitRate &&
        settings.maxSize === legacyDefaultSettings.maxSize
      ) {
        settings = { ...defaultSettings }
        deviceSettings[device.id] = toJS(settings)
        main.setScreencastStore('settings', deviceSettings)
      }

      this.scrcpyClient = new ScrcpyClient(
        device.id,
        new ScrcpyOptions3_1({
          audio: false,
          videoBitRate: settings.videoBitRate || defaultSettings.videoBitRate,
          maxSize: settings.maxSize,
          maxFps: 30,
          clipboardAutosync: true,
          stayAwake: true,
        })
      )
      this.scrcpyClient.on('close', () => {
        if (this.device.id === device.id) {
          this.setDevice(null)
        }
      })
      this.scrcpyClient.on('interaction', (event) => {
        if (this.testSession) {
          main.sendToWindow('main', 'testSessionInteraction', event)
        }
      })

      runInAction(() => {
        this.settings = settings
        this.screenOff = false
        this.device = device
      })
    }
  }
  async setSettings(name: string, val: any) {
    runInAction(() => (this.settings[name] = val))
    const deviceSettings = await main.getScreencastStore('settings')
    deviceSettings[this.device.id] = toJS(this.settings)
    main.setScreencastStore('settings', deviceSettings)
  }
  private async init() {
    const device = await main.getMainStore('device')
    await this.setDevice(device)
    const alwaysOnTop = await main.getScreencastStore('alwaysOnTop')
    if (alwaysOnTop) {
      main.setScreencastAlwaysOnTop(true)
      runInAction(() => (this.alwaysOnTop = true))
    }
    const testSession = await main.getScreencastStore('testSession')
    if (testSession) {
      await this.syncTestSession(testSession)
    }
  }
  private bindEvent() {
    main.on('changeMainStore', (name: string, val: any) => {
      if (name === 'device') {
        this.setDevice(val)
      }
    })
    main.on('changeScreencastStore', (name: string, val: any) => {
      if (name === 'testSession') {
        this.syncTestSession(val)
      }
    })
    main.on('focusWin', async () => {
      const text = await navigator.clipboard.readText()
      this.scrcpyClient.setClipboard(text)
    })
  }
}

const defaultSettings = {
  videoBitRate: 8000000,
  maxSize: 1920,
}

const legacyDefaultSettings = {
  videoBitRate: 2000000,
  maxSize: 960,
}

export default new Store()
