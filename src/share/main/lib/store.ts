import fs from 'fs-extra'
import memoize from 'licia/memoize'
import Store from 'licia/Store'
import FileStore from 'licia/FileStore'
import { getUserDataPath } from './util'

fs.exists(getUserDataPath('data'), function (exists) {
  if (!exists) {
    fs.mkdirp(getUserDataPath('data'))
  }
})

export const getMemStore = memoize(function () {
  return new Store({})
})

export const getWindowStore = memoize(function () {
  return new FileStore(getUserDataPath('data/window.json'), {})
})
