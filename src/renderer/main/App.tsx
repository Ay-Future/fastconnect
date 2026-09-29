import Toolbar from './components/toolbar/Toolbar'
import ClosePromptModal from './components/toolbar/ClosePromptModal'
import Logcat from './components/logcat/Logcat'
import Shell from './components/shell/Shell'
import Overview from './components/overview/Overview'
import Screenshot from './components/screenshot/Screenshot'
import Process from './components/process/Process'
import Performance from './components/performance/Performance'
import Webview from './components/webview/Webview'
import HttpCapture from './components/http-capture/HttpCapture'
import PrecisionLearning from './components/precision-learning/PrecisionLearning'
import Devbox from './components/devbox/Devbox'
import QuestionDebug from './components/question-debug/QuestionDebug'
import ProxySettings from './components/proxy-settings/ProxySettings'
import TestSession from './components/test-session/TestSession'
import Application from './components/application/Application'
import File from './components/file/File'
import Layout from './components/layout/Layout'
import Style from './App.module.scss'
import { useEffect, useState, PropsWithChildren, FC } from 'react'
import store from './store'
import { observer } from 'mobx-react-lite'
import { getSafePanel } from './store'

export default observer(function App() {
  useEffect(() => {
    const safePanel = getSafePanel(store.panel)
    if (safePanel !== store.panel) {
      store.selectPanel(safePanel)
    }
  }, [])

  return (
    <>
      <Toolbar />
      <ClosePromptModal />
      <div className={Style.workspace}>
        <div
          className={Style.panels}
          key={store.device ? store.device.id : ''}
        >
          <Panel panel="overview">
            <Overview />
          </Panel>
          <Panel panel="application">
            <Application />
          </Panel>
          <Panel panel="screenshot">
            <Screenshot />
          </Panel>
          <Panel panel="logcat">
            <Logcat />
          </Panel>
          <Panel panel="httpCapture">
            <HttpCapture />
          </Panel>
          <Panel panel="shell">
            <Shell />
          </Panel>
          <Panel panel="process">
            <Process />
          </Panel>
          <Panel panel="performance">
            <Performance />
          </Panel>
          <Panel panel="webview">
            <Webview />
          </Panel>
          <Panel panel="precisionLearning">
            <PrecisionLearning />
          </Panel>
          <Panel panel="questionDebug">
            <QuestionDebug />
          </Panel>
          <Panel panel="proxySettings">
            <ProxySettings />
          </Panel>
          <Panel panel="testSession">
            <TestSession />
          </Panel>
          <Panel panel="file">
            <File />
          </Panel>
          <Panel panel="layout">
            <Layout />
          </Panel>
        </div>
        <div className={Style.panelsGlobal}>
          <Panel panel="devbox">
            <Devbox />
          </Panel>
        </div>
      </div>
    </>
  )
})

interface IPanelProps {
  panel: string
}

const Panel: FC<PropsWithChildren<IPanelProps>> = observer(function Panel(
  props
) {
  const [used, setUsed] = useState(() => store.panel === props.panel)

  const activePanel = getSafePanel(store.panel)
  const visible = activePanel === props.panel

  useEffect(() => {
    if (visible && !used) {
      setUsed(true)
    }
  }, [used, visible])

  const style: React.CSSProperties = {}
  if (!visible) {
    style.opacity = 0
    style.pointerEvents = 'none'
  }

  return (
    <div className={Style.panel} style={style}>
      {used || visible ? props.children : null}
    </div>
  )
})
