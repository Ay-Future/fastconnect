import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState } from 'react'
import LunaToolbar, {
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import className from 'licia/className'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { notify } from 'share/renderer/lib/util'
import { t } from 'common/util'
import {
  IProxySettingsResult,
  IProxySettingsStatus,
} from 'common/types'
import Style from './ProxySettings.module.scss'
import store from '../../store'
import { PannelLoading } from '../common/loading'

const DEFAULT_PROXY_PORT = 8888

export default observer(function ProxySettings() {
  const [status, setStatus] = useState<IProxySettingsStatus | null>(null)
  const [proxyInput, setProxyInput] = useState('')
  const [output, setOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const suggestedProxyRef = useRef('')
  const { device, panel } = store

  useEffect(() => {
    setStatus(null)
    setProxyInput('')
    setOutput('')
    setIsLoading(false)
    setIsSubmitting(false)
    suggestedProxyRef.current = ''
  }, [device?.id])

  useEffect(() => {
    if (panel === 'proxySettings') {
      refresh()
    }
  }, [device?.id, panel])

  async function refresh() {
    if (!device || isLoading) {
      return
    }

    try {
      setIsLoading(true)
      const nextStatus = await main.getProxySettingsStatus(device.id)
      setStatus(nextStatus)
      syncProxyInput(nextStatus)
    } catch {
      notify('读取代理状态失败', { icon: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  async function applyProxy() {
    if (!device || isSubmitting) {
      return
    }

    try {
      setIsSubmitting(true)
      const result = await main.setHttpProxy(device.id, proxyInput)
      setOutput(result.output)
      applyResult(result)

      if (result.success) {
        notify('代理设置成功', { icon: 'success' })
      } else {
        notify('设置代理失败', { icon: 'error' })
      }
    } catch {
      notify('设置代理失败', { icon: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function clearProxy() {
    if (!device || isSubmitting) {
      return
    }

    try {
      setIsSubmitting(true)
      const result = await main.clearHttpProxy(device.id)
      setOutput(result.output)
      applyResult(result, true)

      if (result.success) {
        notify('代理已清空', { icon: 'success' })
      } else {
        notify('清空代理失败', { icon: 'error' })
      }
    } catch {
      notify('清空代理失败', { icon: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  function syncProxyInput(nextStatus: IProxySettingsStatus, force = false) {
    const suggestedProxy = getSuggestedProxy(nextStatus)
    if (force || !proxyInput || proxyInput === suggestedProxyRef.current) {
      setProxyInput(suggestedProxy)
    }
    suggestedProxyRef.current = suggestedProxy
  }

  function applyResult(result: IProxySettingsResult, forceSuggested = false) {
    const nextStatus: IProxySettingsStatus = {
      computerIp: result.computerIp,
      computerWifi: result.computerWifi,
      deviceIp: result.deviceIp,
      deviceWifi: result.deviceWifi,
      currentProxy: result.currentProxy,
      hasProxy: result.hasProxy,
      sameSubnet: result.sameSubnet,
    }

    setStatus(nextStatus)
    syncProxyInput(nextStatus, forceSuggested)
  }

  let content: React.ReactNode = null

  if (!device) {
    content = (
      <div className={className('panel-body', Style.empty)}>
        {t('deviceNotConnected')}
      </div>
    )
  } else if (isLoading && !status) {
    content = <PannelLoading />
  } else {
    const computerIpRaw = status?.computerIp || '--'
    const computerIp = computerIpRaw
    const deviceIp = formatIpWithWifi(status?.deviceIp, status?.deviceWifi)
    const currentProxy = status?.currentProxy || '未设置代理'

    content = (
      <div className={className('panel-body', Style.container)}>
        <div className={Style.content}>
          <section className={Style.card}>
            <div className={Style.cardHeader}>
              <div>
                <h3 className={Style.cardTitle}>代理状态</h3>
                <p className={Style.cardHint}>
                  这里会展示当前电脑 IP、设备 IP，以及设备上是否已经存在代理设置。
                </p>
              </div>
            </div>
            <div className={Style.summaryGrid}>
              <StatusCard
                title="电脑 IP"
                value={computerIp}
                meta={
                  status?.sameSubnet
                    ? '与设备处于同一网段'
                    : '与设备可能不在同一网段'
                }
              />
              <StatusCard
                title="设备 IP"
                value={deviceIp}
                meta={status?.sameSubnet ? '当前网络可直接联通' : '请确认设备 Wi-Fi'}
              />
              <StatusCard
                title="当前代理"
                value={currentProxy}
                meta={status?.hasProxy ? '设备已存在代理设置' : '设备当前未设置代理'}
                active={Boolean(status?.hasProxy)}
                tag={status?.hasProxy ? '已启用' : '未启用'}
              />
            </div>
          </section>

          <section className={Style.card}>
            <div className={Style.cardHeader}>
              <div>
                <h3 className={Style.cardTitle}>设置代理</h3>
                <p className={Style.cardHint}>
                  输入端口或 `IP:端口` 后点击“设置代理”。如果只输入端口，会默认使用当前电脑局域网
                  IP；如果输入完整的 `IP:端口`，会按你填写的地址直接写入设备。默认建议值为电脑局域网
                  IP 和 `:{DEFAULT_PROXY_PORT}`。
                </p>
              </div>
            </div>
            <div className={Style.formRow}>
              <input
                className={Style.proxyInput}
                value={proxyInput}
                placeholder={`例如 8888 或 ${computerIpRaw}:${DEFAULT_PROXY_PORT}`}
                onChange={(e) => setProxyInput(e.target.value)}
                spellCheck={false}
              />
              <button
                className={Style.primaryButton}
                disabled={!device || isSubmitting}
                onClick={applyProxy}
              >
                {isSubmitting ? '执行中...' : '设置代理'}
              </button>
              <button
                className={Style.secondaryButton}
                disabled={!device || isSubmitting}
                onClick={clearProxy}
              >
                清空代理
              </button>
            </div>
          </section>

          <section className={className(Style.card, Style.outputCard)}>
            <div className={Style.cardHeader}>
              <div>
                <h3 className={Style.cardTitle}>脚本输出</h3>
                <p className={Style.cardHint}>
                  这里展示执行设置代理或清空代理时的完整输出内容。
                </p>
              </div>
            </div>
            <div
              className={className(Style.output, {
                [Style.outputEmpty]: !output,
              })}
            >
              {output
                ? renderOutput(output)
                : '点击“设置代理”或“清空代理”后，这里会显示脚本执行结果。'}
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarText
          text={status?.hasProxy ? `代理 ${status.currentProxy}` : '代理未启用'}
        />
        <LunaToolbarSpace />
        <ToolbarIcon
          icon="refresh"
          title={t('refresh')}
          disabled={!device || isLoading || isSubmitting}
          onClick={refresh}
        />
      </LunaToolbar>
      {content}
    </div>
  )
})

interface IStatusCardProps {
  active?: boolean
  meta: string
  tag?: string
  title: string
  value: string
}

function StatusCard(props: IStatusCardProps) {
  return (
    <div
      className={className(Style.statusCard, {
        [Style.statusCardActive]: props.active,
      })}
    >
      <div className={Style.statusHeader}>
        <span className={Style.statusTitle}>{props.title}</span>
        {props.tag ? (
          <span
            className={className(Style.statusTag, {
              [Style.statusTagActive]: props.active,
            })}
          >
            {props.tag}
          </span>
        ) : null}
      </div>
      <div className={Style.statusValue}>{props.value}</div>
      <div className={Style.statusMeta}>{props.meta}</div>
    </div>
  )
}

function getSuggestedProxy(status: IProxySettingsStatus) {
  const currentPort = getProxyPort(status.currentProxy)

  if (status.computerIp && currentPort) {
    return `${status.computerIp}:${currentPort}`
  }

  if (status.computerIp) {
    return `${status.computerIp}:${DEFAULT_PROXY_PORT}`
  }

  return ''
}

function getProxyPort(proxy: string) {
  const match = proxy.match(/:(\d{1,5})$/)

  return match ? match[1] : ''
}

function renderOutput(output: string) {
  return output.split('\n').map((line, index) => (
    <div
      key={`${index}-${line}`}
      className={className(Style.outputLine, getOutputLineClass(line))}
    >
      {line || ' '}
    </div>
  ))
}

function getOutputLineClass(line: string) {
  if (line.startsWith('[成功]')) {
    return Style.outputSuccess
  }

  if (line.startsWith('[警告]')) {
    return Style.outputWarning
  }

  if (line.startsWith('[错误]')) {
    return Style.outputError
  }

  if (line.startsWith('[命令]')) {
    return Style.outputCommand
  }

  return Style.outputInfo
}

function formatIpWithWifi(ip = '', wifi = '') {
  const value = ip || '--'

  if (!wifi) {
    return value
  }

  return `${value} (${wifi})`
}
