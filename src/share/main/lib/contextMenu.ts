import { Menu } from 'electron'
import each from 'licia/each'
import * as window from './window'
import { IpcShowContextMenu } from '../../common/types'

const contextMenu: IpcShowContextMenu = function (x, y, template) {
  x = Math.round(x)
  y = Math.round(y)

  transTpl(template)
  const menu = Menu.buildFromTemplate(template)
  menu.popup({
    x,
    y,
  })
}

export default contextMenu

function transTpl(template: any) {
  each(template, (item: any) => {
    if (item.click) {
      const id: string = item.click
      item.click = function () {
        window.sendFocused('clickContextMenu', id)
      }
    }
    if (item.type === 'submenu') {
      item.submenu = transTpl(item.submenu)
    }
  })
  return template
}
