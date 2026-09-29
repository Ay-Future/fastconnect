import { Titlebar, TitlebarColor } from 'custom-electron-titlebar'
import { colorBgContainer, colorBgContainerDark } from 'common/theme'
import getUrlParam from 'licia/getUrlParam'
import isMac from 'licia/isMac'
import $ from 'licia/$'
import mainObj from './main'
import { webFrame, webUtils } from 'electron'

let titleBar: Titlebar

window.addEventListener('DOMContentLoaded', async () => {
  const isCustomTitleBar = await mainObj.isCustomTitlebar()
  if (isCustomTitleBar) {
    titleBar = new Titlebar({
      containerOverflow: 'hidden',
    })
    const $body = $('body')
    $body.addClass('custom-titlebar')
    if (getUrlParam('page') && !isMac) {
      $body.addClass('hide-cet-menubar')
    }
  }

  updateTheme()
  mainObj.on('changeTheme', updateTheme)
})

async function updateTheme() {
  const theme = await mainObj.getTheme()
  if (theme === 'dark') {
    document.body.classList.add('-theme-with-dark-background')
  } else {
    document.body.classList.remove('-theme-with-dark-background')
  }
  const isCustomTitlebar = await mainObj.isCustomTitlebar()
  if (isCustomTitlebar) {
    const backgroundColor = TitlebarColor.fromHex(
      theme === 'dark' ? colorBgContainerDark : colorBgContainer
    )
    ;(titleBar as any).currentOptions.menuBarBackgroundColor = backgroundColor
    titleBar.updateBackground(backgroundColor)
  }
}

async function updateZoomFactor(zoomFactor?: number) {
  zoomFactor = zoomFactor || (await mainObj.getSettingsStore('zoomFactor'))
  if (zoomFactor) {
    webFrame.setZoomFactor(zoomFactor)
  }
}
updateZoomFactor()

mainObj.on('changeSettingsStore', (name: string, val: any) => {
  if (name === 'zoomFactor') {
    updateZoomFactor(val)
  }
})

mainObj.on('refreshMenu', () => {
  if (titleBar) {
    titleBar.refreshMenu()
  }
})

export default {
  setTitle: (title: string) => {
    document.title = title
    if (titleBar) {
      titleBar.updateTitle(title)
    }
  },
  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file)
  },
}
