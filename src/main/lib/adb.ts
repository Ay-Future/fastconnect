import { app } from 'electron'
import Adb, { Client, Device } from '@devicefarmer/adbkit'
import androidDeviceList from 'android-device-list'
import {
  resolveResources,
  handleEvent,
  getUserDataPath,
} from 'share/main/lib/util'
import map from 'licia/map'
import types from 'licia/types'
import filter from 'licia/filter'
import isStrBlank from 'licia/isStrBlank'
import trim from 'licia/trim'
import startWith from 'licia/startWith'
import toNum from 'licia/toNum'
import contain from 'licia/contain'
import lowerCase from 'licia/lowerCase'
import * as window from 'share/main/lib/window'
import fs from 'fs-extra'
import { getSettingsStore } from './store'
import isWindows from 'licia/isWindows'
import isEmpty from 'licia/isEmpty'
import * as base from './adb/base'
import { shell, getAdbPath, spawnAdb, isRooted } from './adb/base'
import * as logcat from './adb/logcat'
import * as shellAdb from './adb/shell'
import * as server from './adb/server'
import * as scrcpy from './adb/scrcpy'
import * as packageAdb from './adb/package'
import * as file from './adb/file'
import * as fps from './adb/fps'
import * as webview from './adb/webview'
import * as httpCapture from './adb/httpCapture'
import * as port from './adb/port'
import { getCpuLoads, getCpus, getCpuTemperature } from './adb/cpu'
import log from 'share/common/log'
import {
  IpcClearHttpProxy,
  IpcConnectDevice,
  IpcDisconnectDevice,
  IpcDumpWindowHierarchy,
  IpcGetDeviceDiagnostics,
  IpcGetDevices,
  IpcGetMockQuestionId,
  IpcGetProxySettingsStatus,
  IpcInputKey,
  IpcPairDevice,
  IpcSetHttpProxy,
  IProxySettingsResult,
  IpcResetMockQuestionId,
  IpcRunPacketLossTest,
  IpcScreencap,
  IpcSetMockQuestionId,
} from 'common/types'
import path from 'node:path'
import childProcess from 'node:child_process'
import { networkInterfaces } from 'node:os'
import isMac from 'licia/isMac'
import sleep from 'licia/sleep'

const logger = log('adb')
const DEFAULT_HTTP_PROXY_PORT = 8888
const CLEAR_HTTP_PROXY_COMMAND = 'adb shell settings put global http_proxy :0'

const settingsStore = getSettingsStore()

let client: Client

const getDevices: IpcGetDevices = async function () {
  let devices = await client.listDevices()
  devices = filter(
    devices,
    (device: Device) => device.type === 'emulator' || device.type === 'device'
  )

  return Promise.all(
    map(devices, async (device: Device) => {
      const properties = await client.getDevice(device.id).getProperties()

      let name = `${properties['ro.product.manufacturer']} ${properties['ro.product.model']}`
      const marketName = getMarketName(properties)
      if (marketName) {
        name = marketName
      }

      return {
        id: device.id,
        type: device.type,
        serialno: properties['ro.serialno'] || '',
        name,
        androidVersion: properties['ro.build.version.release'],
        sdkVersion: properties['ro.build.version.sdk'],
      }
    })
  ).catch(() => [])
}

async function getOverview(deviceId: string) {
  const device = await client.getDevice(deviceId)
  const properties = await device.getProperties()
  const cpus = await getCpus(deviceId, false)
  const [kernelVersion, fontScale, wifi] = await shell(deviceId, [
    'uname -r',
    'settings get system font_scale',
    'dumpsys wifi',
  ])

  let ssidMatch = wifi.match(/mWifiInfo\s+SSID: "?(.+?)"?,/)
  if (ssidMatch && ssidMatch[1] === '<unknown ssid>') {
    ssidMatch = null
  }

  return {
    name: getMarketName(properties) || properties['ro.product.name'],
    processor: properties['ro.product.board'] || '',
    abi: properties['ro.product.cpu.abi'],
    brand: properties['ro.product.brand'],
    model: properties['ro.product.model'],
    serialno: properties['ro.serialno'] || '',
    cpuNum: cpus.length,
    kernelVersion,
    fontScale: fontScale === 'null' ? 0 : toNum(fontScale),
    wifi: ssidMatch ? ssidMatch[1] : '',
    root: await isRooted(deviceId),
    ...(await getIpAndMac(deviceId)),
    ...(await getStorage(deviceId)),
    ...(await getMemory(deviceId)),
    ...(await getScreen(deviceId)),
  }
}

async function getIpAndMac(deviceId: string) {
  try {
    const [routeInfo, addrInfo] = await shell(deviceId, ['ip route', 'ip addr'])
    const routeDevice = getRouteDeviceName(routeInfo)
    if (routeDevice) {
      const routeNetworkInfo = getIpAndMacFromInterface(addrInfo, routeDevice)
      if (routeNetworkInfo.ip) {
        return routeNetworkInfo
      }
    }

    const wlan0 = getIpAndMacFromInterface(addrInfo, 'wlan0')
    if (wlan0.ip) {
      return wlan0
    }

    return getFirstUsableIpAndMac(addrInfo)
  } catch {
    return {
      ip: '',
      mac: '',
    }
  }
}

async function setFontScale(deviceId: string, scale: number) {
  await shell(deviceId, `settings put system font_scale ${scale}`)
}

function getMarketName(properties: types.PlainObj<string>) {
  const keys = [
    // Oppo
    'ro.oppo.market.name',
    // Huawei, Honor
    'ro.config.marketing_name',
    // OnePlus, Realme
    'ro.vendor.oplus.market.enname',
    // Vivo
    'ro.vivo.market.name',
    // Xiaomi, Redmi
    'ro.product.marketname',
    // Asus
    'ro.asus.product.mkt_name',
  ]
  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i]
    if (properties[key]) {
      return properties[key]
    }
  }

  const device = properties['ro.product.device']
  const model = properties['ro.product.model']

  let marketName = ''

  const devices: any[] = androidDeviceList.getDevicesByDeviceId(device)
  if (!isEmpty(devices)) {
    const deviceFilter = filter(devices, (device) => device.model === model)
    if (!isEmpty(deviceFilter)) {
      marketName = deviceFilter[0].name
    } else {
      marketName = devices[0].name
    }
  }

  return marketName
}

async function getPerformance(deviceId: string) {
  const cpus = await getCpus(deviceId)

  return {
    cpus,
    cpuLoads: await getCpuLoads(deviceId, cpus),
    cpuTemperature: await getCpuTemperature(deviceId),
    ...(await getMemory(deviceId)),
    ...(await getBattery(deviceId)),
  }
}

async function getUptime(deviceId: string) {
  const result = await shell(deviceId, 'cat /proc/uptime')
  const [uptime] = result.split(' ')
  return Math.round(toNum(uptime) * 1000)
}

async function getBattery(deviceId: string) {
  const result = await shell(deviceId, 'dumpsys battery')

  return getBatteryStatus(result)
}

const getDeviceDiagnostics: IpcGetDeviceDiagnostics = async function (deviceId) {
  const [batteryInfo, wifiInfo, routeInfo, wlan0] = await shell(deviceId, [
    'dumpsys battery',
    'dumpsys wifi',
    'ip route',
    'ip addr show wlan0',
  ])

  return {
    ...getBatteryStatus(batteryInfo),
    ...getWifiStatus(wifiInfo, routeInfo, wlan0),
  }
}

const getProxySettingsStatus: IpcGetProxySettingsStatus = async function (
  deviceId
) {
  const computerIp = await getComputerIp()
  const computerWifi = await getComputerWifiName()
  const { ip: deviceIp } = await getIpAndMac(deviceId)
  const deviceWifi = await getDeviceWifiName(deviceId)
  const currentProxy = await getHttpProxy(deviceId)

  return {
    computerIp,
    computerWifi,
    deviceIp,
    deviceWifi,
    currentProxy,
    hasProxy: Boolean(currentProxy),
    sameSubnet: checkSameSubnet(computerIp, deviceIp),
  }
}

const runPacketLossTest: IpcRunPacketLossTest = async function (
  deviceId,
  target
) {
  const normalizedTarget = trim(target || (await getGateway(deviceId)) || '223.5.5.5')
  const result = await shell(
    deviceId,
    `ping -c 10 -W 1 ${normalizedTarget}`
  )

  return parsePacketLossResult(result, normalizedTarget)
}

const setHttpProxy: IpcSetHttpProxy = async function (deviceId, proxy) {
  const output: string[] = []
  const computerIp = await getComputerIp()
  const computerWifi = await getComputerWifiName()
  const { ip: deviceIp } = await getIpAndMac(deviceId)
  const deviceWifi = await getDeviceWifiName(deviceId)

  output.push('[信息] 开始设置代理')

  if (!computerIp) {
    output.push('[错误] 无法获取电脑局域网 IP 地址')
    output.push(`[命令] 清空代理：${CLEAR_HTTP_PROXY_COMMAND}`)

    return buildProxySettingsResult(
      false,
      output,
      computerIp,
      computerWifi,
      deviceIp,
      deviceWifi,
      '',
      ''
    )
  }

  if (!deviceIp) {
    output.push(`[信息] 当前电脑 IP: ${computerIp}`)
    output.push('[错误] 无法获取设备 IP 地址，请确认设备已连接 Wi-Fi')
    output.push(`[命令] 清空代理：${CLEAR_HTTP_PROXY_COMMAND}`)

    return buildProxySettingsResult(
      false,
      output,
      computerIp,
      computerWifi,
      deviceIp,
      deviceWifi,
      '',
      await getHttpProxy(deviceId)
    )
  }

  const parsedProxy = parseProxyInput(proxy, computerIp)
  if (!parsedProxy) {
    output.push('[错误] 代理输入格式无效，请输入端口或 IP:端口')
    output.push(`[信息] 示例：8888 或 ${computerIp}:${DEFAULT_HTTP_PROXY_PORT}`)
    output.push(`[命令] 清空代理：${CLEAR_HTTP_PROXY_COMMAND}`)

    return buildProxySettingsResult(
      false,
      output,
      computerIp,
      computerWifi,
      deviceIp,
      deviceWifi,
      '',
      await getHttpProxy(deviceId)
    )
  }

  const { ip: inputIp, port } = parsedProxy
  const normalizedProxy = `${inputIp}:${port}`

  output.push(`[信息] 当前电脑 IP: ${computerIp}`)
  output.push(`[信息] 当前设备 IP: ${deviceIp}`)
  output.push(`[信息] 实际下发代理: ${normalizedProxy}`)

  output.push(
    `[命令] adb shell settings put global http_proxy ${normalizedProxy}`
  )

  try {
    await shell(
      deviceId,
      `settings put global http_proxy ${toShellString(normalizedProxy)}`
    )
  } catch (err) {
    output.push(`[错误] 代理命令执行失败：${getErrorMessage(err)}`)
    output.push(`[命令] 清空代理：${CLEAR_HTTP_PROXY_COMMAND}`)

    return buildProxySettingsResult(
      false,
      output,
      computerIp,
      computerWifi,
      deviceIp,
      deviceWifi,
      normalizedProxy,
      await safeGetHttpProxy(deviceId)
    )
  }

  const currentProxy = await getHttpProxy(deviceId)
  output.push(`[信息] 设备返回代理: ${currentProxy || ':0'}`)

  if (currentProxy !== normalizedProxy) {
    output.push(
      `[错误] 代理设置失败，期望值 ${normalizedProxy}，实际返回 ${
        currentProxy || ':0'
      }`
    )
    output.push('[错误] 请确认设备允许写入 global 设置，且 ADB 连接正常')
    output.push(`[命令] 清空代理：${CLEAR_HTTP_PROXY_COMMAND}`)

    return buildProxySettingsResult(
      false,
      output,
      computerIp,
      computerWifi,
      deviceIp,
      deviceWifi,
      normalizedProxy,
      currentProxy
    )
  }

  if (!checkSameSubnet(computerIp, deviceIp)) {
    output.push(
      `[警告] 电脑与设备不在同一网段（电脑网段: ${getSubnet(
        computerIp
      )}，设备网段: ${getSubnet(deviceIp)}），代理虽然已写入，但可能无法使用`
    )
  }

  output.push('[成功] 代理设置成功')
  output.push(`[命令] 清空代理：${CLEAR_HTTP_PROXY_COMMAND}`)

  return buildProxySettingsResult(
    true,
    output,
    computerIp,
    computerWifi,
    deviceIp,
    deviceWifi,
    normalizedProxy,
    currentProxy
  )
}

const clearHttpProxy: IpcClearHttpProxy = async function (deviceId) {
  const output: string[] = []
  const computerIp = await getComputerIp()
  const computerWifi = await getComputerWifiName()
  const { ip: deviceIp } = await getIpAndMac(deviceId)
  const deviceWifi = await getDeviceWifiName(deviceId)

  output.push('[信息] 开始清空代理')
  output.push(`[命令] ${CLEAR_HTTP_PROXY_COMMAND}`)

  try {
    await shell(deviceId, 'settings put global http_proxy :0')
  } catch (err) {
    output.push(`[错误] 清空代理命令执行失败：${getErrorMessage(err)}`)

    return buildProxySettingsResult(
      false,
      output,
      computerIp,
      computerWifi,
      deviceIp,
      deviceWifi,
      '',
      await safeGetHttpProxy(deviceId)
    )
  }

  const currentProxy = await getHttpProxy(deviceId)
  output.push(`[信息] 设备返回代理: ${currentProxy || ':0'}`)

  if (currentProxy) {
    output.push(`[错误] 代理清空失败，当前设备代理仍为 ${currentProxy}`)

    return buildProxySettingsResult(
      false,
      output,
      computerIp,
      computerWifi,
      deviceIp,
      deviceWifi,
      '',
      currentProxy
    )
  }

  output.push('[成功] 代理已清空')

  return buildProxySettingsResult(
    true,
    output,
    computerIp,
    computerWifi,
    deviceIp,
    deviceWifi,
    '',
    currentProxy
  )
}

const getMockQuestionId: IpcGetMockQuestionId = async function (deviceId) {
  const result = await shell(deviceId, 'settings get global mock_question_id')

  return result === 'null' ? '' : trim(result)
}

const setMockQuestionId: IpcSetMockQuestionId = async function (
  deviceId,
  questionId
) {
  const normalizedQuestionId = trim(questionId)
  await shell(
    deviceId,
    `settings put global mock_question_id ${toShellString(normalizedQuestionId)}`
  )

  return getMockQuestionId(deviceId)
}

const resetMockQuestionId: IpcResetMockQuestionId = async function (deviceId) {
  await shell(deviceId, `settings put global mock_question_id ${toShellString('')}`)
}

function getBatteryStatus(result: string) {
  const acPowered = getPropValue('AC powered', result) === 'true'
  const usbPowered = getPropValue('USB powered', result) === 'true'
  const wirelessPowered = getPropValue('Wireless powered', result) === 'true'
  const dockPowered = getPropValue('Dock powered', result) === 'true'
  const status = toNum(getPropValue('status', result))
  const charging =
    acPowered || usbPowered || wirelessPowered || dockPowered || status === 2

  let chargeSource = '未接电源'
  if (wirelessPowered) {
    chargeSource = '无线充电'
  } else if (usbPowered) {
    chargeSource = 'USB充电'
  } else if (acPowered) {
    chargeSource = 'AC充电'
  } else if (dockPowered) {
    chargeSource = '底座充电'
  }

  return {
    batteryLevel: toNum(getPropValue('level', result)),
    batteryTemperature: toNum(getPropValue('temperature', result)),
    batteryVoltage: toNum(getPropValue('voltage', result)),
    batteryStatus: getBatteryStatusText(status),
    charging,
    chargeSource,
  }
}

function getBatteryStatusText(status: number) {
  switch (status) {
    case 2:
      return '充电中'
    case 3:
      return '放电中'
    case 4:
      return '未充电'
    case 5:
      return '已充满'
    default:
      return '未知'
  }
}

function getWifiStatus(wifiInfo: string, routeInfo: string, wlan0: string) {
  return {
    wifi: getWifiName(wifiInfo),
    wifiState: getWifiStateText(
      getFirstMatch(wifiInfo, [
        /Supplicant state:\s*([A-Z_]+)/i,
        /mNetworkInfo.*state:\s*([A-Z_]+)/i,
        /curState=([A-Za-z]+)/,
      ])
    ),
    gateway: getGatewayFromRoute(routeInfo),
    ...(getIpAndMacFromWlan0(wlan0)),
    rssi: getFirstNumberMatch(wifiInfo, [
      /RSSI:\s*(-?\d+)/i,
      /rssi=(-?\d+)/i,
    ]),
    frequency: getFirstNumberMatch(wifiInfo, [
      /Frequency:\s*(\d+)/i,
      /frequency=(\d+)/i,
    ]),
    linkSpeed: getFirstNumberMatch(wifiInfo, [
      /(?:^|[\s,{])Link speed:\s*(\d+)\s*Mbps/i,
      /\blinkSpeed=(\d+)/i,
    ]),
    txLinkSpeed: getFirstNumberMatch(wifiInfo, [
      /Tx Link speed:\s*(\d+)\s*Mbps/i,
      /txLinkSpeedMbps=(\d+)/i,
    ]),
    rxLinkSpeed: getFirstNumberMatch(wifiInfo, [
      /Rx Link speed:\s*(\d+)\s*Mbps/i,
      /rxLinkSpeedMbps=(\d+)/i,
    ]),
  }
}

function getWifiStateText(state: string) {
  const normalizedState = state.toUpperCase()

  if (
    normalizedState === 'COMPLETED' ||
    normalizedState === 'CONNECTED' ||
    normalizedState === 'COMPLETEDSTATE'
  ) {
    return '已连接'
  }

  if (
    normalizedState === 'DISCONNECTED' ||
    normalizedState === 'DISCONNECTEDSTATE'
  ) {
    return '未连接'
  }

  if (normalizedState === 'SCANNING' || normalizedState === 'SCANNINGSTATE') {
    return '扫描中'
  }

  if (!normalizedState) {
    return '未知'
  }

  return normalizedState
}

async function getComputerIp() {
  if (isWindows) {
    const routeIp = await getWindowsDefaultRouteIp()
    if (routeIp) {
      return routeIp
    }
  }

  const interfaces = networkInterfaces()
  const candidates: Array<{ address: string; score: number }> = []

  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos || []) {
      if (info.family !== 'IPv4' || info.internal) {
        continue
      }

      if (!isUsableLocalIpv4(info.address)) {
        continue
      }

      const score = getInterfaceScore(name, info.address)
      if (score <= Number.NEGATIVE_INFINITY) {
        continue
      }

      candidates.push({
        address: info.address,
        score,
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  return candidates[0]?.address || ''
}

async function getComputerWifiName() {
  if (isMac) {
    const airportPath =
      '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
    if (await fs.pathExists(airportPath)) {
      const wifi = getWifiName(await runLocalCommand(airportPath, ['-I']))
      if (wifi) {
        return wifi
      }
    }

    const networksetup = await runLocalCommand('networksetup', [
      '-getairportnetwork',
      'en0',
    ])
    const networksetupWifi = getFirstMatch(networksetup, [
      /Current (?:Wi-Fi|AirPort) Network:\s*(.+)$/im,
    ])
    if (
      networksetupWifi &&
      !contain(lowerCase(networksetupWifi), 'not associated')
    ) {
      return networksetupWifi
    }

    const systemProfiler = await runLocalCommand('system_profiler', [
      'SPAirPortDataType',
    ])
    const profilerWifi = getFirstMatch(systemProfiler, [
      /Current Network Information:\s*\n\s*([^:\n]+):/im,
      /SSID:\s*"?(.+?)"?\s*$/im,
    ])
    if (profilerWifi) {
      return profilerWifi
    }
  } else if (isWindows) {
    const output = await runLocalCommand('netsh', ['wlan', 'show', 'interfaces'])
    const wifi = getFirstMatch(output, [/^\s*SSID(?:\s+\d+)?\s*:\s*(.+)$/im])
    if (wifi && !startWith(wifi, 'BSSID')) {
      return wifi
    }
  } else {
    const iwgetid = trim(await runLocalCommand('iwgetid', ['-r']))
    if (iwgetid) {
      return iwgetid
    }

    const nmcli = await runLocalCommand('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi'])
    const wifi = getFirstMatch(nmcli, [/^yes:(.+)$/im])
    if (wifi) {
      return wifi
    }
  }

  return ''
}

async function getWindowsDefaultRouteIp() {
  const output = await runLocalCommand('route', ['print', '-4'])
  if (!output) {
    return ''
  }

  const matches = Array.from(
    output.matchAll(
      /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s*$/gm
    )
  )

  if (!matches.length) {
    return ''
  }

  const candidates = matches
    .map((match) => ({
      gateway: match[1],
      address: match[2],
      metric: Number(match[3]) || Number.MAX_SAFE_INTEGER,
    }))
    .filter(
      (item) =>
        isUsableLocalIpv4(item.address) &&
        item.gateway !== '0.0.0.0' &&
        item.gateway !== item.address
    )
    .sort((a, b) => a.metric - b.metric)

  return candidates[0]?.address || ''
}

async function getDeviceWifiName(deviceId: string) {
  return getWifiName(await shell(deviceId, 'dumpsys wifi'))
}

function parseProxyInput(proxy: string, fallbackIp: string) {
  const normalizedProxy = trim(proxy)
  if (!normalizedProxy) {
    return {
      ip: fallbackIp,
      port: DEFAULT_HTTP_PROXY_PORT,
    }
  }

  if (/^\d{1,5}$/.test(normalizedProxy)) {
    const port = toNum(normalizedProxy)
    if (port <= 0 || port > 65535) {
      return null
    }

    return {
      ip: fallbackIp,
      port,
    }
  }

  const match = normalizedProxy.match(/^([^:\s]+)?:(\d{1,5})$/)
  if (!match) {
    return null
  }

  const ip = trim(match[1] || fallbackIp)
  const port = toNum(match[2])
  if (!ip || port <= 0 || port > 65535) {
    return null
  }

  return {
    ip,
    port,
  }
}

function isUsableLocalIpv4(ip: string) {
  return Boolean(ip) && !/^169\.254\./.test(ip) && ip !== '0.0.0.0'
}

function getInterfaceScore(name: string, address: string) {
  const normalizedName = lowerCase(name)
  let score = 0

  if (!isUsableLocalIpv4(address)) {
    return Number.NEGATIVE_INFINITY
  }

  if (
    /(vethernet|vmware|virtual|docker|hyper-v|tailscale|loopback|hamachi|vbox|utun|tap|tun|bridge)/i.test(
      normalizedName
    )
  ) {
    return Number.NEGATIVE_INFINITY
  }

  if (/(wi-?fi|wlan|wireless)/i.test(normalizedName)) {
    score += 120
  }

  if (/^(en|eth|wlan|wl)/i.test(normalizedName)) {
    score += 90
  }

  if (/(ethernet|lan)/i.test(normalizedName)) {
    score += 70
  }

  if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address)) {
    score += 30
  }

  return score
}

function getSubnet(ip: string) {
  const parts = ip.split('.')
  if (parts.length < 3) {
    return '--'
  }

  return parts.slice(0, 3).join('.')
}

function checkSameSubnet(ip1: string, ip2: string) {
  return Boolean(ip1) && Boolean(ip2) && getSubnet(ip1) === getSubnet(ip2)
}

async function getHttpProxy(deviceId: string) {
  const proxy = trim(await shell(deviceId, 'settings get global http_proxy'))

  if (!proxy || proxy === 'null' || proxy === ':0' || proxy === '0') {
    return ''
  }

  return proxy
}

async function runLocalCommand(command: string, args: string[]) {
  return new Promise<string>((resolve) => {
    const cp = childProcess.spawn(command, args, {
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    cp.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    cp.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    cp.on('error', () => resolve(''))
    cp.on('close', () => resolve(trim(stdout || stderr)))
  })
}

function buildProxySettingsResult(
  success: boolean,
  output: string[],
  computerIp: string,
  computerWifi: string,
  deviceIp: string,
  deviceWifi: string,
  appliedProxy: string,
  currentProxy: string
): IProxySettingsResult {
  return {
    success,
    output: output.join('\n'),
    computerIp,
    computerWifi,
    deviceIp,
    deviceWifi,
    appliedProxy,
    currentProxy,
    hasProxy: Boolean(currentProxy),
    sameSubnet: checkSameSubnet(computerIp, deviceIp),
  }
}

async function safeGetHttpProxy(deviceId: string) {
  try {
    return await getHttpProxy(deviceId)
  } catch {
    return ''
  }
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) {
    return err.message
  }

  return String(err || 'unknown error')
}

function getWifiName(wifiInfo: string) {
  const ssid = getFirstMatch(wifiInfo, [
    /mWifiInfo\s+SSID:\s*"?(.+?)"?,/i,
    /WifiInfo.*SSID:\s*"?(.+?)"?,/i,
    /(?:^|[\s,{])SSID:\s*"?(.+?)"?[,}\n]/i,
  ])

  if (ssid === '<unknown ssid>' || ssid === 'unknown ssid') {
    return ''
  }

  return ssid
}

async function getGateway(deviceId: string) {
  const routeInfo = await shell(deviceId, 'ip route')

  return getGatewayFromRoute(routeInfo)
}

function getGatewayFromRoute(routeInfo: string) {
  const defaultGateway = getFirstMatch(routeInfo, [
    /default via (\d+\.\d+\.\d+\.\d+) dev wlan0/i,
    /default via (\d+\.\d+\.\d+\.\d+)/i,
  ])

  return defaultGateway
}

function getIpAndMacFromWlan0(wlan0: string) {
  let ip = ''
  let mac = ''

  const ipMatch = wlan0.match(/inet (\d+\.\d+\.\d+\.\d+)/)
  if (ipMatch) {
    ip = ipMatch[1]
  }
  const macMatch = wlan0.match(
    /link\/ether (([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2}))/
  )
  if (macMatch) {
    mac = macMatch[1]
  }

  return {
    ip,
    mac,
  }
}

function getRouteDeviceName(routeInfo: string) {
  return getFirstMatch(routeInfo, [
    /default via \d+\.\d+\.\d+\.\d+ dev ([^\s]+)/i,
    /default dev ([^\s]+)/i,
  ])
}

function getIpAndMacFromInterface(addrInfo: string, iface: string) {
  if (!iface) {
    return {
      ip: '',
      mac: '',
    }
  }

  const escapedIface = iface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = addrInfo.split(/\n(?=\d+:\s)/)
  for (const block of blocks) {
    if (!new RegExp(`^\\d+:\\s+${escapedIface}(?:@[^:]+)?:`, 'm').test(block)) {
      continue
    }

    return getIpAndMacFromWlan0(block)
  }

  return {
    ip: '',
    mac: '',
  }
}

function getFirstUsableIpAndMac(addrInfo: string) {
  const blocks = addrInfo.split(/\n(?=\d+:\s)/)
  for (const block of blocks) {
    const match = block.match(/^\d+:\s+([^:@\s]+)(?:@[^:]+)?:/m)
    const iface = match?.[1] || ''
    if (
      !iface ||
      /^(lo|sit|tunl|ip6tnl|ifb)/i.test(iface) ||
      /(rmnet|dummy|bond|veth|docker|bridge)/i.test(iface)
    ) {
      continue
    }

    const networkInfo = getIpAndMacFromWlan0(block)
    if (networkInfo.ip) {
      return networkInfo
    }
  }

  return {
    ip: '',
    mac: '',
  }
}

function getFirstMatch(str: string, matchers: RegExp[]) {
  for (let i = 0; i < matchers.length; i++) {
    const match = str.match(matchers[i])
    if (match && match[1]) {
      return trim(match[1].replace(/^"|"$/g, ''))
    }
  }

  return ''
}

function getFirstNumberMatch(str: string, matchers: RegExp[]) {
  return toNum(getFirstMatch(str, matchers))
}

function parsePacketLossResult(result: string, target: string) {
  const packetMatch = result.match(
    /(\d+)\s+packets transmitted,\s+(\d+)(?:\s+packets)? received,\s+(\d+)% packet loss/i
  )
  const latencyMatch = result.match(
    /=\s*([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))?/i
  )

  return {
    target,
    transmitted: packetMatch ? toNum(packetMatch[1]) : 0,
    received: packetMatch ? toNum(packetMatch[2]) : 0,
    packetLoss: packetMatch ? toNum(packetMatch[3]) : 0,
    minLatency: latencyMatch ? toNum(latencyMatch[1]) : 0,
    avgLatency: latencyMatch ? toNum(latencyMatch[2]) : 0,
    maxLatency: latencyMatch ? toNum(latencyMatch[3]) : 0,
    jitter: latencyMatch ? toNum(latencyMatch[4]) : 0,
    raw: result,
    parsed: Boolean(packetMatch),
  }
}

function toShellString(str: string) {
  return `'${str.replace(/'/g, `'\\''`)}'`
}

const screencap: IpcScreencap = async function (deviceId) {
  const device = await client.getDevice(deviceId)
  const data = await device.screencap()
  const buf = await Adb.util.readAll(data)

  return buf.toString('base64')
}

const dumpWindowHierarchy: IpcDumpWindowHierarchy = async function (deviceId) {
  const path = '/data/local/tmp/aya_uidump.xml'
  await shell(deviceId, `uiautomator dump ${path}`)
  const data = await file.pullFileData(deviceId, path)
  return data.toString('utf8')
}

async function getScreen(deviceId: string) {
  const [wmSize, wmDensity] = await shell(deviceId, ['wm size', 'wm density'])

  const physicalResolution = getPropValue('Physical size', wmSize)
  const physicalDensity = getPropValue('Physical density', wmDensity)

  const hasOverrideResolution = contain(wmSize, 'Override')
  const hasOverrideDensity = contain(wmDensity, 'Override')
  const resolution = hasOverrideResolution
    ? getPropValue('Override size', wmSize)
    : physicalResolution
  const density = hasOverrideDensity
    ? getPropValue('Override density', wmDensity)
    : physicalDensity

  return {
    resolution,
    physicalResolution,
    density,
    physicalDensity,
  }
}

async function getMemory(deviceId: string) {
  const memInfo = await shell(deviceId, 'cat /proc/meminfo')
  let memTotal = 0
  let memFree = 0

  const totalMatch = getPropValue('MemTotal', memInfo)
  let freeMatch = getPropValue('MemAvailable', memInfo)
  if (!freeMatch) {
    freeMatch = getPropValue('MemFree', memInfo)
  }
  if (totalMatch && freeMatch) {
    memTotal = parseInt(totalMatch, 10) * 1024
    memFree = parseInt(freeMatch, 10) * 1024
  }

  return {
    memTotal,
    memUsed: memTotal - memFree,
  }
}

async function getStorage(deviceId: string) {
  const storageInfo = await shell(deviceId, 'dumpsys diskstats')
  let storageTotal = 0
  let storageFree = 0

  const match = storageInfo.match(new RegExp('Data-Free: (\\d+)K / (\\d+)K'))
  if (match) {
    storageFree = parseInt(match[1], 10) * 1024
    storageTotal = parseInt(match[2], 10) * 1024
  }

  return {
    storageTotal,
    storageUsed: storageTotal - storageFree,
  }
}

function getPropValue(key: string, str: string) {
  const lines = str.split('\n')
  for (let i = 0, len = lines.length; i < len; i++) {
    const line = trim(lines[i])
    if (startWith(line, key)) {
      return trim(line.replace(/.*:/, ''))
    }
  }

  return ''
}

const connectDevice: IpcConnectDevice = async function (host, port) {
  await client.connect(host, port)
}

const disconnectDevice: IpcDisconnectDevice = async function (host, port) {
  await client.disconnect(host, port)
}

const pairDevice: IpcPairDevice = async function (host, port, password) {
  const { stdout } = await spawnAdb(['pair', `${host}:${port}`, password])
  if (!contain(stdout, 'Successfully')) {
    throw new Error(`Pair device failed: ${stdout}`)
  }
}

const inputKey: IpcInputKey = async function (deviceId, keyCode) {
  await base.shell(deviceId, `input keyevent ${keyCode}`)
}

async function openAdbCli() {
  let cwd = resolveResources('adb')
  const adbPath = settingsStore.get('adbPath')
  if (!isStrBlank(adbPath) && fs.existsSync(adbPath)) {
    cwd = path.dirname(adbPath)
  } else if (isWindows) {
    // Microsoft store app permission issue workaround
    const newCwd = getUserDataPath('adb')
    if (!(await fs.existsSync(newCwd))) {
      await fs.copy(cwd, newCwd)
    }
    cwd = newCwd
  }

  if (isMac) {
    const child = childProcess.spawn('open', ['-a', 'Terminal', cwd], {
      stdio: 'ignore',
    })
    child.unref()
  } else if (isWindows) {
    const child = childProcess.exec('start cmd', {
      cwd,
    })
    child.unref()
  } else {
    const child = childProcess.spawn('x-terminal-emulator', ['-w', cwd], {
      stdio: 'ignore',
    })
    child.unref()
  }
}

async function root(deviceId: string) {
  const id = await shell(deviceId, 'id')
  if (contain(id, 'uid=0')) {
    return
  }
  const device = await client.getDevice(deviceId)
  await device.root()
}

async function startWireless(deviceId: string) {
  const device = await client.getDevice(deviceId)
  const { ip } = await getIpAndMac(deviceId)
  const port = await device.tcpip(5555)
  await sleep(500)
  await connectDevice(ip, port)
}

async function restartAdbServer() {
  await client.kill()
  await client.version()
}

export async function init() {
  logger.info('init')

  app.on('will-quit', async () => {
    if (settingsStore.get('killAdbWhenExit')) {
      logger.info('kill adb')
      await client.kill()
    }
  })

  client = Adb.createClient({
    bin: getAdbPath(),
  })
  async function track() {
    logger.info('track devices')
    try {
      const tracker = await client.trackDevices()
      tracker.on('add', onDeviceChange)
      tracker.on('remove', onDeviceChange)
      tracker.on('error', () => {
        logger.error('tracker error')
      })
      tracker.on('end', async () => {
        logger.info('tracker end')
        await sleep(2000)
        track()
      })
    } catch (e) {
      logger.error('track error', e)
    }
  }
  function onDeviceChange() {
    logger.info('device change')
    setTimeout(() => window.sendAll('changeDevice'), 2000)
  }
  track()

  base.init(client)
  logcat.init(client)
  shellAdb.init(client)
  server.init(client)
  scrcpy.init(client)
  packageAdb.init(client)
  file.init(client)
  fps.init()
  webview.init()
  httpCapture.init()
  port.init(client)

  handleEvent('getDevices', getDevices)
  handleEvent('getDeviceDiagnostics', getDeviceDiagnostics)
  handleEvent('getMockQuestionId', getMockQuestionId)
  handleEvent('getProxySettingsStatus', getProxySettingsStatus)
  handleEvent('getOverview', getOverview)
  handleEvent('clearHttpProxy', clearHttpProxy)
  handleEvent('resetMockQuestionId', resetMockQuestionId)
  handleEvent('runPacketLossTest', runPacketLossTest)
  handleEvent('setHttpProxy', setHttpProxy)
  handleEvent('setMockQuestionId', setMockQuestionId)
  handleEvent('setFontScale', setFontScale)
  handleEvent('screencap', screencap)
  handleEvent('getMemory', getMemory)
  handleEvent('getPerformance', getPerformance)
  handleEvent('getUptime', getUptime)
  handleEvent('connectDevice', connectDevice)
  handleEvent('disconnectDevice', disconnectDevice)
  handleEvent('inputKey', inputKey)
  handleEvent('openAdbCli', openAdbCli)
  handleEvent('dumpWindowHierarchy', dumpWindowHierarchy)
  handleEvent('root', root)
  handleEvent('startWireless', startWireless)
  handleEvent('restartAdbServer', restartAdbServer)
  handleEvent('pairDevice', pairDevice)
}
