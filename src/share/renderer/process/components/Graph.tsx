import { observer } from 'mobx-react-lite'
import Style from './Graph.module.scss'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import store from '../store'
import { colorPrimary, colorPrimaryDark } from 'common/theme'
import { t } from '../../../common/i18n'
import { useCallback, useEffect, useRef } from 'react'

export default observer(function Graph() {
  const dataRef = useRef({
    cpu: 0,
    mem: 0,
  })

  const cpuData = useCallback(() => {
    return +dataRef.current.cpu.toFixed(1)
  }, [])

  const memData = useCallback(() => {
    return +(dataRef.current.mem / 1024 / 1024).toFixed(2)
  }, [])

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null

    async function updateCpuAndMem() {
      timer = null
      const { cpu, memory } = await main.getCpuAndMem()
      dataRef.current.cpu = cpu
      dataRef.current.mem = memory
      timer = setTimeout(updateCpuAndMem, 2000)
    }

    updateCpuAndMem()

    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  const color = store.theme === 'dark' ? colorPrimaryDark : colorPrimary

  return (
    <div className={Style.container}>
      <LunaPerformanceMonitor
        title="CPU"
        data={cpuData}
        theme={store.theme}
        color={color}
        height={50}
        unit="%"
      />
      <LunaPerformanceMonitor
        title={t('memory')}
        data={memData}
        theme={store.theme}
        color={color}
        height={50}
        unit="GB"
      />
    </div>
  )
})
