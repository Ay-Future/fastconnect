import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { observer } from 'mobx-react-lite'
import map from 'licia/map'
import { t } from 'common/util'
import Style from './Tabs.module.scss'
import store from '../../store'

export default observer(function Panels() {
  const tabItems = map(
    [
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
    ],
    (panel) => {
      let title = t(panel)
      if (panel === 'precisionLearning') {
        title = 'JZX'
      } else if (panel === 'devbox') {
        title = 'devbox'
      } else if (panel === 'questionDebug') {
        title = '题目调试'
      } else if (panel === 'proxySettings') {
        title = '设置代理'
      } else if (panel === 'testSession') {
        title = 'Fastbug'
      } else if (panel === 'httpCapture') {
        title = '接口抓包'
      }

      return (
        <LunaTabItem
          key={panel}
          id={panel}
          title={title}
          selected={panel === store.panel}
        />
      )
    }
  )

  return (
    <LunaTab
      className={Style.container}
      height={31}
      onSelect={(panel) => store.selectPanel(panel)}
    >
      {tabItems}
    </LunaTab>
  )
})
