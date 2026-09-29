import { getSettingsStore } from '../../../main/lib/store'
import { i18n, hasLocale } from '../../common/i18n'
import { app } from 'electron'
import { handleEvent } from './util'
import log from '../../common/log'
import { IpcGetLanguage } from '../../common/types'

const logger = log('language')

const store = getSettingsStore()

let language = 'en-US'
export const get: IpcGetLanguage = function () {
  return language
}

export function init() {
  logger.info('init')

  const lang = store.get('language')
  const systemLanguage = resolveLocale(app.getLocale()) || 'en-US'

  if (lang === 'system') {
    language = systemLanguage
  } else {
    language = resolveLocale(lang) || systemLanguage
  }

  i18n.locale(language)
  handleEvent('getLanguage', get)
}

function resolveLocale(locale: string) {
  if (hasLocale(locale)) {
    return locale
  }
  const [lang] = locale.split('-')
  if (hasLocale(lang)) {
    return lang
  }
}
