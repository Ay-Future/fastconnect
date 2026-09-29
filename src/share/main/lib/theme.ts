import { nativeTheme } from 'electron'
import { getSettingsStore } from '../../../main/lib/store'
import { getTheme, handleEvent } from './util'
import * as window from './window'
import log from '../../common/log'
import { IpcGetTheme } from '../../common/types'
import Emitter from 'licia/Emitter'
import types from 'licia/types'

const logger = log('theme')

type Theme = 'system' | 'light' | 'dark'

const store = getSettingsStore()

export const get: IpcGetTheme = () => {
  return getTheme()
}

function set(theme: Theme) {
  nativeTheme.themeSource = theme
}

export function init() {
  logger.info('init')

  set(store.get('theme'))
  handleEvent('getTheme', get)
  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource === 'system') {
      emitter.emit('change')
    }
  })
  store.on('change', (name, val) => {
    if (name === 'theme') {
      set(val)
      emitter.emit('change')
    }
  })
}

const emitter = new Emitter()

export function on(event: string, listener: types.AnyFn) {
  emitter.on(event, listener)
}

on('change', () => {
  window.sendAll('changeTheme')
})
