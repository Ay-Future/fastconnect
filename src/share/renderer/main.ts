import hotKey from 'licia/hotkey'
import { spy } from 'mobx'
import { isDev, getPlatform } from '../common/util'

if (isDev()) {
  hotKey.on('f5', () => location.reload())
  hotKey.on('f12', () => main.toggleDevTools())

  spy((event) => {
    switch (event.type) {
      case 'action':
        // console.log('mobx action', event.name, ...event.arguments)
        break
      case 'add':
        // console.log('mobx add', event.debugObjectName)
        break
      case 'update':
        // console.log('mobx update', event.debugObjectName)
        break
    }
  })
}

document.body.classList.add(`platform-${getPlatform()}`)
