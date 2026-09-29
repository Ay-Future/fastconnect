import { observer } from 'mobx-react-lite'
import { useEffect, useState } from 'react'
import LunaToolbar, {
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import className from 'licia/className'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { notify } from 'share/renderer/lib/util'
import { t } from 'common/util'
import {
  IDeviceDiagnostics,
  IDevicePacketLossResult,
} from 'common/types'
import Style from './DeviceDashboard.module.scss'
import store from '../../store'
import { PannelLoading } from '../common/loading'

const PACKET_TEST_FALLBACK_TARGET = '223.5.5.5'

interface IProps {
  active?: boolean
  embedded?: boolean
}

export default observer(function DeviceDashboard(props: IProps) {
  const [diagnostics, setDiagnostics] = useState<IDeviceDiagnostics | null>(null)
  const [packetLossResult, setPacketLossResult] =
    useState<IDevicePacketLossResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(0)
  const [testedAt, setTestedAt] = useState(0)
  const { device, panel } = store
  const isActive = props.active ?? panel === 'deviceDashboard'
  const contentClassName = props.embedded ? Style.embeddedContent : 'panel-body'

  useEffect(() => {
    setDiagnostics(null)
    setPacketLossResult(null)
    setUpdatedAt(0)
    setTestedAt(0)
  }, [device?.id])

  useEffect(() => {
    if (isActive) {
      refresh()
    }
  }, [device?.id, isActive])

  async function refresh() {
    if (!device || isLoading) {
      return
    }

    try {
      setIsLoading(true)
      const result = await main.getDeviceDiagnostics(device.id)
      setDiagnostics(result)
      setUpdatedAt(Date.now())
    } catch {
      notify(t('commonErr'), { icon: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  async function testPacketLoss() {
    if (!device || isTesting) {
      return
    }

    try {
      setIsTesting(true)
      const result = await main.runPacketLossTest(device.id, getPacketTarget())
      setPacketLossResult(result)
      setTestedAt(Date.now())
    } catch {
      notify('丢包测试失败', { icon: 'error' })
    } finally {
      setIsTesting(false)
    }
  }

  function getPacketTarget() {
    return diagnostics?.gateway || PACKET_TEST_FALLBACK_TARGET
  }

  let content: React.ReactNode = null

  if (!device) {
    content = (
      <div className={className(contentClassName, Style.empty)}>
        {t('deviceNotConnected')}
      </div>
    )
  } else if (isLoading && !diagnostics) {
    content = <PannelLoading />
  } else if (!diagnostics) {
    content = (
      <div className={className(contentClassName, Style.empty)}>
        暂无设备数据
      </div>
    )
  } else {
    const batteryLevel = `${diagnostics.batteryLevel}%`
    const batteryMeta = `${formatVoltage(diagnostics.batteryVoltage)} / ${formatTemperature(
      diagnostics.batteryTemperature
    )}`
    const chargingMeta = `${diagnostics.batteryStatus} / ${diagnostics.chargeSource}`
    const wifiMeta = diagnostics.wifi
      ? `${diagnostics.wifiState} / ${diagnostics.wifi}`
      : diagnostics.wifiState

    content = (
      <div className={className(contentClassName, Style.container)}>
        <div className={Style.content}>
          <div className={Style.summaryGrid}>
            <SummaryCard
              title="当前电量"
              value={batteryLevel}
              meta={batteryMeta}
            >
              <div className={Style.progressTrack}>
                <div
                  className={Style.progressValue}
                  style={{ width: `${Math.max(0, Math.min(100, diagnostics.batteryLevel))}%` }}
                />
              </div>
            </SummaryCard>
            <SummaryCard
              title="充电状态"
              value={diagnostics.charging ? '已接电源' : '未接电源'}
              meta={chargingMeta}
            />
            <SummaryCard
              title="Wi-Fi 状态"
              value={diagnostics.wifi || '未连接 Wi-Fi'}
              meta={wifiMeta}
            />
            <SummaryCard
              title="网络地址"
              value={diagnostics.gateway || '--'}
              meta={`IP ${diagnostics.ip || '--'} / MAC ${diagnostics.mac || '--'}`}
            />
          </div>

          <div className={Style.detailGrid}>
            <section className={Style.card}>
              <div className={Style.cardHeader}>
                <div>
                  <h3 className={Style.cardTitle}>Wi-Fi测速</h3>
                  <p className={Style.cardHint}>基于设备当前 Wi-Fi 链路信息</p>
                </div>
              </div>
              <div className={Style.metricGrid}>
                <MetricItem
                  title="下行链路"
                  value={formatSpeed(diagnostics.rxLinkSpeed || diagnostics.linkSpeed)}
                />
                <MetricItem
                  title="上行链路"
                  value={formatSpeed(diagnostics.txLinkSpeed || diagnostics.linkSpeed)}
                />
                <MetricItem
                  title="信号强度"
                  value={formatSignal(diagnostics.rssi)}
                />
                <MetricItem
                  title="频段"
                  value={formatFrequency(diagnostics.frequency)}
                />
                <MetricItem title="连接状态" value={diagnostics.wifiState} />
                <MetricItem title="测试目标" value={getPacketTarget()} />
              </div>
            </section>

            <section className={Style.card}>
              <div className={Style.cardHeader}>
                <div>
                  <h3 className={Style.cardTitle}>丢包测试</h3>
                  <p className={Style.cardHint}>
                    默认优先测试当前网关，不存在时回退到 {PACKET_TEST_FALLBACK_TARGET}
                  </p>
                </div>
                <button
                  className={Style.actionButton}
                  disabled={isTesting}
                  onClick={testPacketLoss}
                >
                  {isTesting ? '测试中...' : '开始测试'}
                </button>
              </div>

              {packetLossResult ? (
                <>
                  <div className={Style.metricGrid}>
                    <MetricItem
                      title="丢包率"
                      value={`${packetLossResult.packetLoss}%`}
                    />
                    <MetricItem
                      title="平均时延"
                      value={formatLatency(packetLossResult.avgLatency)}
                    />
                    <MetricItem
                      title="最小时延"
                      value={formatLatency(packetLossResult.minLatency)}
                    />
                    <MetricItem
                      title="最大时延"
                      value={formatLatency(packetLossResult.maxLatency)}
                    />
                    <MetricItem
                      title="发送/接收"
                      value={`${packetLossResult.transmitted}/${packetLossResult.received}`}
                    />
                    <MetricItem
                      title="抖动"
                      value={formatLatency(packetLossResult.jitter)}
                    />
                  </div>
                  <div className={Style.resultMeta}>
                    <span>目标：{packetLossResult.target}</span>
                    <span>完成时间：{formatTime(testedAt)}</span>
                  </div>
                  {!packetLossResult.parsed && (
                    <pre className={Style.rawOutput}>{packetLossResult.raw}</pre>
                  )}
                </>
              ) : (
                <div className={Style.placeholder}>
                  点击“开始测试”后展示丢包率和时延统计
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    )
  }

  const toolbar = (
    <LunaToolbar className={props.embedded ? Style.embeddedToolbar : 'panel-toolbar'}>
      <LunaToolbarText
        text={
          diagnostics
            ? `Wi-Fi ${diagnostics.wifi || '未连接'}`
            : device
              ? device.name
              : ''
        }
      />
      <LunaToolbarSpace />
      <LunaToolbarText
        text={updatedAt ? `更新时间 ${formatTime(updatedAt)}` : ''}
      />
      <ToolbarIcon
        icon="refresh"
        title={t('refresh')}
        disabled={!device || isLoading}
        onClick={refresh}
      />
    </LunaToolbar>
  )

  if (props.embedded) {
    return (
      <div className={Style.embedded}>
        {toolbar}
        {content}
      </div>
    )
  }

  return (
    <div className="panel-with-toolbar">
      {toolbar}
      {content}
    </div>
  )
})

interface ISummaryCardProps {
  children?: React.ReactNode
  meta: string
  title: string
  value: string
}

function SummaryCard(props: ISummaryCardProps) {
  return (
    <section className={Style.summaryCard}>
      <div className={Style.summaryTitle}>{props.title}</div>
      <div className={Style.summaryValue}>{props.value}</div>
      <div className={Style.summaryMeta}>{props.meta}</div>
      {props.children}
    </section>
  )
}

interface IMetricItemProps {
  title: string
  value: string
}

function MetricItem(props: IMetricItemProps) {
  return (
    <div className={Style.metricItem}>
      <div className={Style.metricTitle}>{props.title}</div>
      <div className={Style.metricValue}>{props.value}</div>
    </div>
  )
}

function formatTime(time: number) {
  if (!time) {
    return '--'
  }

  return new Date(time).toLocaleTimeString('zh-CN', {
    hour12: false,
  })
}

function formatSpeed(speed: number) {
  if (!speed) {
    return '--'
  }

  return `${speed} Mbps`
}

function formatFrequency(frequency: number) {
  if (!frequency) {
    return '--'
  }

  return `${frequency} MHz`
}

function formatSignal(rssi: number) {
  if (!rssi) {
    return '--'
  }

  return `${rssi} dBm`
}

function formatTemperature(temperature: number) {
  return `${temperature / 10}°C`
}

function formatVoltage(voltage: number) {
  return `${(voltage / 1000).toFixed(2)}V`
}

function formatLatency(latency: number) {
  if (!latency) {
    return '--'
  }

  return `${latency.toFixed(2)} ms`
}
