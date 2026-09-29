import { observer } from 'mobx-react-lite'
import { useCallback, useEffect, useRef, useState } from 'react'
import store from '../../store'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import {
  green4,
  green4Dark,
  green6,
  green6Dark,
  orange6,
  orange6Dark,
  purple6,
  purple6Dark,
} from 'common/theme'
import { t } from 'common/util'
import sum from 'licia/sum'
import Style from './Performance.module.scss'
import durationFormat from 'licia/durationFormat'
import LunaToolbar, {
  LunaToolbarHtml,
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import isEmpty from 'licia/isEmpty'
import map from 'licia/map'
import extend from 'licia/extend'
import className from 'licia/className'

interface IAppMemory {
  name: string
  pid: string
  bytes: number
}

export default observer(function Performance() {
  const [uptime, setUptime] = useState(0)
  const [appMemories, setAppMemories] = useState<IAppMemory[]>([])
  const nextProcessMemoryAtRef = useRef(0)
  const dataRef = useRef({
    topPackage: {
      name: '',
      label: '',
      pid: 0,
    },
    memUsed: 0,
    memTotal: 0,
    batteryLevel: 0,
    batteryTemperature: 0,
    batteryVoltage: 0,
    cpuLoads: [],
    cpus: [],
    cpuTemperature: 0,
    fps: 0,
  })

  const memData = useCallback(() => {
    return Math.round(dataRef.current.memUsed / 1024 / 1024)
  }, [])

  const cpuData = useCallback(() => {
    const cpuLoads = dataRef.current.cpuLoads
    if (isEmpty(cpuLoads)) {
      return 0
    }
    const cpuLoad = sum(...cpuLoads) / cpuLoads.length
    return Math.floor(cpuLoad * 100)
  }, [])

  const fpsData = useCallback(() => dataRef.current.fps, [])

  const { device } = store

  useEffect(() => {
    let destroyed = false

    async function getPerformance() {
      if (device) {
        if (store.panel === 'performance') {
          try {
            main.getUptime(device.id).then(setUptime)
            main.getPerformance(device.id).then((performance) => {
              extend(dataRef.current, performance)
            })
            if (Date.now() >= nextProcessMemoryAtRef.current) {
              nextProcessMemoryAtRef.current = Date.now() + 2_000
              main.getProcesses(device.id).then((processes) => {
                if (!destroyed) setAppMemories(getAppMemories(processes))
              }).catch(() => undefined)
            }
            main.getTopPackage(device.id).then(async (topPackage) => {
              extend(dataRef.current.topPackage, topPackage)
              if (topPackage.name) {
                const packageInfos = await main.getPackageInfos(device.id, [
                  topPackage.name,
                ])
                dataRef.current.topPackage.label = packageInfos[0].label
              }
            })
            main
              .getFps(device.id, dataRef.current.topPackage.name)
              .then((fps) => {
                dataRef.current.fps = fps
              })
          } catch {
            // ignore
          }
        }
      }
      if (!destroyed) {
        setTimeout(getPerformance, 1000)
      }
    }

    getPerformance()

    return () => {
      destroyed = true
    }
  }, [])

  const isDark = store.theme === 'dark'

  const data = dataRef.current
  const batteryLevel = data.batteryLevel + '%'
  const batteryVoltage = `${(data.batteryVoltage / 1000).toFixed(2)}V`
  const batteryTemperature = `${data.batteryTemperature / 10}°C`
  const batteryInfo = `${batteryVoltage} ${batteryTemperature}`

  return (
    <div className={className('panel-with-toolbar', Style.container)}>
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarText
          text={`${t('uptime')} ${durationFormat(uptime, 'd:hh:mm:ss')}`}
        />
        <LunaToolbarSpace />
        <LunaToolbarHtml>
          <div className={Style.batteryContainer}>
            <span className={Style.batteryInfo}>{batteryInfo}</span>
            <span className={Style.batteryLevel}>{batteryLevel}</span>
            <div className={Style.battery}>
              <div className={Style.batteryHead} />
              <div
                className={Style.batteryInside}
                style={{ width: batteryLevel }}
              />
            </div>
          </div>
        </LunaToolbarHtml>
      </LunaToolbar>
      <div className={className('panel-body', Style.charts)}>
        <LunaPerformanceMonitor
          title={`CPU ${data.cpuTemperature}°C`}
          data={cpuData}
          theme={store.theme}
          max={100}
          color={isDark ? green6Dark : green6}
          height={80}
          unit="%"
        />
        <div className={Style.cpuContainer}>
          {map(data.cpuLoads, (load, idx) => (
            <Cpu key={idx} index={idx} dataRef={dataRef} load={load} />
          ))}
        </div>
        <LunaPerformanceMonitor
          title={`${t('memory')} ${
            data.memUsed
              ? Math.round((data.memUsed / data.memTotal) * 100) + '%'
              : ''
          }`}
          data={memData}
          theme={store.theme}
          smooth={false}
          color={isDark ? purple6Dark : purple6}
          height={80}
          unit="MB"
        />
        <LunaPerformanceMonitor
          title={`FPS ${data.topPackage.label}`}
          data={fpsData}
          theme={store.theme}
          smooth={false}
          height={80}
          color={isDark ? orange6Dark : orange6}
        />
        <section className={Style.appMemory} aria-label="当前应用内存占用">
          <div className={Style.appMemoryHeader}>
            <h3>当前应用内存占用</h3>
            <span>按 RSS 排序 · 每 2 秒刷新</span>
          </div>
          <div className={Style.appMemoryList}>
            {appMemories.length ? appMemories.map((app) => (
              <div className={Style.appMemoryItem} key={`${app.pid}-${app.name}`} title={app.name}>
                <div><strong>{app.name}</strong><small>PID {app.pid}</small></div>
                <b>{formatMemory(app.bytes)}</b>
              </div>
            )) : <div className={Style.appMemoryEmpty}>正在读取应用内存占用…</div>}
          </div>
        </section>
      </div>
    </div>
  )
})

interface ICpuProps {
  dataRef: any
  index: number
  load: number
}

const Cpu = observer(function (props: ICpuProps) {
  const cpuData = useCallback(() => {
    const cpuLoad = props.dataRef.current.cpuLoads[props.index]!
    return Math.floor(cpuLoad * 100)
  }, [])

  const isDark = store.theme === 'dark'
  const speed = props.dataRef.current.cpus[props.index]!.speed

  return (
    <LunaPerformanceMonitor
      title={`CPU${props.index} ${speed}MHz`}
      data={cpuData}
      theme={store.theme}
      max={100}
      height={50}
      color={isDark ? green4Dark : green4}
      unit="%"
    />
  )
})

function getAppMemories(processes: any[]): IAppMemory[] {
  return processes
    .map((process) => ({
      name: String(process.name || process.args || ''),
      pid: String(process.pid || ''),
      bytes: parseMemory(process.res),
    }))
    .filter((process) => process.name.includes('.') && process.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
}

function parseMemory(value: unknown) {
  const match = String(value || '').trim().match(/^([\d.]+)\s*([KMG])?B?$/i)
  if (!match) return 0
  const unit = (match[2] || 'K').toUpperCase()
  const multiplier = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : 1024
  return Math.round(Number(match[1]) * multiplier)
}

function formatMemory(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}
