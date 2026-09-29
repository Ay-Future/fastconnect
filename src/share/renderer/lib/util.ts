import contain from 'licia/contain'
import h from 'licia/h'
import isArrBuffer from 'licia/isArrBuffer'
import convertBin from 'licia/convertBin'
import $ from 'licia/$'
import isUndef from 'licia/isUndef'
import { isObservable, toJS } from 'mobx'
import LunaNotification, { INotifyOptions } from 'luna-notification'

let notification: LunaNotification | null = null

export function notify(content: string, options?: INotifyOptions) {
  if (!notification) {
    const div = h('div')
    document.body.appendChild(div)
    notification = new LunaNotification(div, {
      position: {
        x: 'center',
        y: 'top',
      },
    })
  }

  notification.notify(content, options)
}

export async function setMemStore(name: string, val: any) {
  await main.setMemStore(name, isObservable(val) ? toJS(val) : val)
}

export function isFileDrop(e: React.DragEvent) {
  return contain(e.dataTransfer.types, 'Files')
}

export function copyData(buf: any, mime: string) {
  if (!isArrBuffer(buf)) {
    buf = convertBin(buf, 'ArrayBuffer')
  }
  navigator.clipboard.write([
    new ClipboardItem({
      [mime]: new Blob([buf], {
        type: mime,
      }),
    }),
  ])
}

let isCustomTitlebar: boolean

export async function getWindowHeight() {
  if (isUndef(isCustomTitlebar)) {
    isCustomTitlebar = await main.isCustomTitlebar()
  }

  if (isCustomTitlebar) {
    return window.innerHeight - $('.cet-titlebar').offset().height
  }

  return window.innerHeight
}
