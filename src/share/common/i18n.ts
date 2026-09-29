import I18n from 'licia/I18n'
import defaults from 'licia/defaults'
import enUS from './langs/en-US.json'
import zhCN from './langs/zh-CN.json'
import types from 'licia/types'
import keys from 'licia/keys'
import contain from 'licia/contain'
import unique from 'licia/unique'
import concat from 'licia/concat'
import each from 'licia/each'

const langs = {
  'en-US': enUS,
  'zh-CN': defaults(zhCN, enUS),
}

let locales = keys(langs)

export const i18n = new I18n('en-US', langs)

export function init(langs: types.PlainObj<any>) {
  locales = unique(concat(locales, keys(langs)))
  each(langs, (lang, locale) => {
    i18n.set(locale, lang)
  })
}

export function hasLocale(locale: string) {
  return contain(locales, locale)
}

export function t(path: string | string[], data?: types.PlainObj<any>) {
  return i18n.t(path, data)
}
