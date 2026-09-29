import { app } from 'electron'
import childProcess, { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { handleEvent } from 'share/main/lib/util'
import {
  IFastbugCollectorOptions,
  IFastbugCollectorStatus,
} from 'common/types'

const DATA_ROOT = 'D:\\project\\collector-data'
const DEFAULT_PORT = 52741
const USER_ENV_NAMES = [
  'YUNXIAO_TOKEN',
  'FASTBUG_OSS_ENDPOINT',
  'FASTBUG_OSS_ACCESS_KEY_ID',
  'FASTBUG_OSS_ACCESS_KEY_SECRET',
  'FASTBUG_OSS_BUCKET',
  'FASTBUG_OSS_PREFIX',
]

let collectorProcess: ChildProcess | null = null
let status: IFastbugCollectorStatus = createStatus()

export function init() {
  void ensureDataRoot()
  handleEvent('getFastbugCollectorStatus', getStatus)
  handleEvent('startFastbugCollector', startCollector)
  handleEvent('restartFastbugCollector', restartCollector)
  handleEvent('stopFastbugCollector', stopCollector)
  app.on('before-quit', () => {
    void stopCollector()
  })
}

async function getStatus() {
  await ensureDataRoot()
  if (!collectorProcess && !status.starting && !status.running) {
    const external = await findExternalCollector(DEFAULT_PORT)
    if (external) {
      status = {
        ...createStatus(),
        running: true,
        managed: false,
        serial: external.serial,
        packageName: external.packageName,
        sessionId: external.sessionId,
        port: DEFAULT_PORT,
        url: buildUrl(DEFAULT_PORT),
        agentStatus: external.agentStatus,
        agentSessionId: external.agentSessionId,
        agentMessage: external.agentMessage,
        logs: ['已接入现有 FastBug Collector（由外部进程启动）'],
      }
    }
  }
  if (status.running) {
    await refreshConnectionStatus(status.port)
  }
  return cloneStatus()
}

async function startCollector(options: IFastbugCollectorOptions) {
  const serial = String(options?.serial || '').trim()
  const packageName = String(options?.packageName || '').trim()
  const port = normalizePort(options?.port)

  if (!serial) {
    throw new Error('请先选择已连接的 Android 设备')
  }
  if (!packageName) {
    throw new Error('请填写被测应用包名')
  }

  if (collectorProcess) {
    await stopCollector()
  }
  if (status.running) {
    throw new Error(
      `检测到 ${status.url} 已有外部 Collector 正在运行。请先在原进程中停止它，或继续使用已内嵌的工作台。`
    )
  }

  await ensureDataRoot()
  const entry = resolveCollectorEntry()
  const adbDir = resolveAdbDir()
  const sessionId = randomUUID()
  status = {
    ...createStatus(),
    starting: true,
    serial,
    packageName,
    sessionId,
    port,
    url: buildUrl(port),
  }

  const env = await createCollectorEnv(adbDir)
  const child = childProcess.spawn(
    process.execPath,
    [
      entry,
      'start',
      '--serial',
      serial,
      '--package',
      packageName,
      '--session',
      sessionId,
      '--port',
      String(port),
    ],
    {
      cwd: path.dirname(entry),
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  collectorProcess = child
  bindCollectorProcess(child)

  try {
    await waitForHealth(child, port)
    if (collectorProcess !== child) {
      throw new Error('Collector 在启动过程中已停止')
    }
    status.starting = false
    status.running = true
    status.managed = true
    await refreshConnectionStatus(port)
    appendLog('Collector 已就绪')
    return cloneStatus()
  } catch (error) {
    const message = getErrorMessage(error)
    status.starting = false
    status.running = false
    status.lastError = message
    appendLog(`启动失败：${message}`)
    await stopChild(child)
    if (collectorProcess === child) {
      collectorProcess = null
    }
    throw new Error(message)
  }
}

async function restartCollector(options: IFastbugCollectorOptions) {
  if (status.running && !collectorProcess) {
    throw new Error(
      `当前 Collector 由外部进程启动，${app.name} 无法安全重启它。请在原进程中停止后再由 ${app.name} 启动。`
    )
  }
  await stopCollector()
  return startCollector(options)
}

async function stopCollector() {
  const child = collectorProcess
  collectorProcess = null
  status.starting = false
  status.running = false
  status.managed = false
  if (child) {
    await stopChild(child)
    appendLog('Collector 已停止')
  }
  return cloneStatus()
}

function bindCollectorProcess(child: ChildProcess) {
  const writeOutput = (chunk: Buffer) => {
    const lines = chunk
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    for (const line of lines) {
      appendLog(line)
    }
  }

  child.stdout?.on('data', writeOutput)
  child.stderr?.on('data', writeOutput)
  child.on('error', (error) => {
    if (collectorProcess === child) {
      status.running = false
      status.starting = false
      status.lastError = getErrorMessage(error)
      appendLog(`Collector 进程错误：${status.lastError}`)
    }
  })
  child.on('exit', (code, signal) => {
    if (collectorProcess === child) {
      collectorProcess = null
      status.running = false
      status.starting = false
      status.managed = false
      if (code && !status.lastError) {
        status.lastError = `Collector 已退出（code ${code}${signal ? `, ${signal}` : ''}）`
      }
      appendLog(`Collector 已退出（${code ?? signal ?? 'unknown'}）`)
    }
  })
}

async function createCollectorEnv(adbDir: string) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }

  for (const name of USER_ENV_NAMES) {
    if (!env[name]) {
      const value = await readWindowsUserEnvironment(name)
      if (value) {
        env[name] = value
      }
    }
  }

  env.ELECTRON_RUN_AS_NODE = '1'
  env.FASTBUG_DATA_ROOT = DATA_ROOT
  env.PATH = `${adbDir}${path.delimiter}${env.PATH || ''}`
  return env
}

function readWindowsUserEnvironment(name: string): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.resolve('')
  }

  return new Promise((resolve) => {
    childProcess.execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Environment]::GetEnvironmentVariable('${name}', 'User')`,
      ],
      { windowsHide: true },
      (error, stdout) => {
        resolve(error ? '' : String(stdout || '').trim())
      }
    )
  })
}

async function waitForHealth(child: ChildProcess, port: number) {
  const startedAt = Date.now()
  let lastError = ''
  while (Date.now() - startedAt < 12_000) {
    if (child.exitCode !== null) {
      throw new Error(status.logs.slice(-8).join('\n') || 'Collector 启动后立即退出')
    }
    try {
      const response = await fetch(`${buildUrl(port)}/health`)
      if (response.ok) {
        const body = await response.json()
        if (body?.ok) {
          return
        }
      }
    } catch (error) {
      lastError = getErrorMessage(error)
    }
    await wait(300)
  }
  throw new Error(
    status.logs.slice(-8).join('\n') ||
      `未能连接 ${buildUrl(port)}${lastError ? `：${lastError}` : ''}`
  )
}

async function findExternalCollector(port: number) {
  try {
    const health = await fetch(`${buildUrl(port)}/health`)
    if (!health.ok) return null
    const healthBody = await health.json()
    if (!healthBody?.ok || !healthBody?.sessionId) return null
    const connection = await fetch(`${buildUrl(port)}/v1/connection`)
    const connectionBody = connection.ok ? await connection.json() : {}
    return {
      sessionId: String(healthBody.sessionId),
      serial: String(connectionBody.serial || ''),
      packageName: String(connectionBody.packageName || ''),
      agentStatus: normalizeAgentStatus(connectionBody.agentStatus),
      agentSessionId: String(connectionBody.agentSessionId || ''),
      agentMessage: String(connectionBody.agentMessage || '现有 Collector 未提供 Agent 校验状态'),
    }
  } catch {
    return null
  }
}

async function refreshConnectionStatus(port: number) {
  try {
    const response = await fetch(`${buildUrl(port)}/v1/connection`)
    if (!response.ok) return
    const connection = await response.json()
    status = {
      ...status,
      serial: String(connection.serial || status.serial),
      packageName: String(connection.packageName || status.packageName),
      agentStatus: normalizeAgentStatus(connection.agentStatus),
      agentSessionId: String(connection.agentSessionId || ''),
      agentMessage: String(connection.agentMessage || 'Collector 尚未返回 Agent 校验状态'),
    }
  } catch {
    // The existing status remains available if the Collector briefly restarts.
  }
}

function stopChild(child: ChildProcess) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Nothing else to do when Electron is already terminating.
      }
      resolve()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

function resolveCollectorEntry() {
  const candidates = [
    path.resolve(__dirname, '../resources/fastbug/collector/index.js'),
    path.resolve(__dirname, '../../fastbug/collector/index.js'),
    path.join(process.resourcesPath, 'fastbug', 'collector', 'index.js'),
  ]
  const entry = candidates.find((candidate) => {
    try {
      return fsSync.existsSync(candidate)
    } catch {
      return false
    }
  })
  if (!entry) {
    throw new Error('未找到内置 FastBug Collector 资源')
  }
  return entry
}

function resolveAdbDir() {
  const candidates = [
    path.resolve(__dirname, '../resources/adb'),
    path.resolve(__dirname, '../../resources/adb'),
    path.join(process.resourcesPath, 'adb'),
  ]
  const dir = candidates.find((candidate) => {
    try {
      return fsSync.existsSync(path.join(candidate, 'adb.exe'))
    } catch {
      return false
    }
  })
  if (!dir) {
    throw new Error('未找到 ADB，请先运行 npm run adb 生成 Windows 平台工具')
  }
  return dir
}

async function ensureDataRoot() {
  await fs.mkdir(DATA_ROOT, { recursive: true })
}

function appendLog(line: string) {
  status.logs.push(line)
  if (status.logs.length > 120) {
    status.logs.splice(0, status.logs.length - 120)
  }
}

function createStatus(): IFastbugCollectorStatus {
  return {
    running: false,
    starting: false,
    managed: false,
    serial: '',
    packageName: '',
    sessionId: '',
    port: DEFAULT_PORT,
    url: buildUrl(DEFAULT_PORT),
    dataRoot: DATA_ROOT,
    agentStatus: 'unchecked',
    agentSessionId: '',
    agentMessage: '尚未校验 FastBug Android Agent',
    lastError: '',
    logs: [],
  }
}

function normalizeAgentStatus(value: unknown): IFastbugCollectorStatus['agentStatus'] {
  return value === 'synced' || value === 'missing' || value === 'sync_failed'
    ? value
    : 'unchecked'
}

function cloneStatus(): IFastbugCollectorStatus {
  return { ...status, logs: [...status.logs] }
}

function buildUrl(port: number) {
  return `http://127.0.0.1:${port}`
}

function normalizePort(port?: number) {
  const value = Number(port || DEFAULT_PORT)
  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_PORT
  }
  return Math.min(65535, Math.floor(value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
