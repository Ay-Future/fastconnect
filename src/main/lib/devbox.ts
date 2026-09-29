import types from 'licia/types'
import uniqId from 'licia/uniqId'
import trim from 'licia/trim'
import fs from 'node:fs'
import childProcess from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { spawn, IPty } from 'node-pty'
import isWindows from 'licia/isWindows'
import * as window from 'share/main/lib/window'
import { handleEvent } from 'share/main/lib/util'
import {
  IpcCreateDevboxSession,
  IpcKillDevboxSession,
  IpcResizeDevboxSession,
  IpcWriteDevboxSession,
} from 'common/types'

interface IDevboxSession {
  pty: IPty
  cols: number
  rows: number
  closed: boolean
  askpassScriptPath: string
}

const sessions: types.PlainObj<IDevboxSession> = {}
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32

const createDevboxSession: IpcCreateDevboxSession = async function (options) {
  const host = trim(options.host || '')
  if (!host) {
    throw new Error('请输入服务器地址')
  }

  const port = normalizePort(options.port) || 22
  const username = trim(options.username || '')
  const password = String(options.password || '')
  const sessionId = uniqId('devbox')
  const { command, args, description } = buildSshCommand(host, port, username)
  const { env, askpassScriptPath } = buildEnv(password, sessionId)

  let pty: IPty
  try {
    pty = spawn(command, args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: os.homedir(),
      env,
    })
  } catch (error) {
    cleanupAskpassScript(askpassScriptPath)
    throw createSshLaunchError(error, description)
  }

  const session: IDevboxSession = {
    pty,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    closed: false,
    askpassScriptPath,
  }
  sessions[sessionId] = session

  const sendData = (data: string) => {
    if (!sessions[sessionId]) {
      return
    }
    window.sendTo('main', 'devboxData', sessionId, normalizeOutput(data))
  }

  pty.onData((data) => {
    sendData(data)
  })

  pty.onExit(({ exitCode, signal }) => {
    const current = sessions[sessionId]
    if (!current || current.closed) {
      return
    }

    current.closed = true
    cleanupAskpassScript(current.askpassScriptPath)
    delete sessions[sessionId]
    sendData(
      `\r\n[devbox disconnected] exit=${exitCode} signal=${
        signal ?? 'none'
      }\r\n`
    )
  })

  sendData([
    '',
    `[devbox] 启动系统 SSH: ${buildConnectionText(host, port, username)}`,
    `[devbox] 使用系统 SSH，认证方式与终端保持一致`,
    '',
  ].join('\r\n'))

  return sessionId
}

const writeDevboxSession: IpcWriteDevboxSession = async function (sessionId, data) {
  const session = sessions[sessionId]
  if (!session) {
    return
  }

  session.pty.write(data)
}

const resizeDevboxSession: IpcResizeDevboxSession = async function (
  sessionId,
  cols,
  rows
) {
  const session = sessions[sessionId]
  if (!session) {
    return
  }

  session.cols = Math.max(1, cols || DEFAULT_COLS)
  session.rows = Math.max(1, rows || DEFAULT_ROWS)
  session.pty.resize(session.cols, session.rows)
}

const killDevboxSession: IpcKillDevboxSession = async function (sessionId) {
  const session = sessions[sessionId]
  if (!session) {
    return
  }

  session.closed = true
  cleanupAskpassScript(session.askpassScriptPath)
  session.pty.kill()
  delete sessions[sessionId]
}

export function init() {
  handleEvent('createDevboxSession', createDevboxSession)
  handleEvent('writeDevboxSession', writeDevboxSession)
  handleEvent('resizeDevboxSession', resizeDevboxSession)
  handleEvent('killDevboxSession', killDevboxSession)
}

function normalizePort(port?: number) {
  if (!port) {
    return 0
  }

  const normalizedPort = Number(port)
  if (!Number.isFinite(normalizedPort) || normalizedPort < 1) {
    return 0
  }

  return Math.min(65535, Math.floor(normalizedPort))
}

function normalizeOutput(output: string) {
  return output.replace(/\r?\n/g, '\r\n')
}

function buildSshCommand(host: string, port: number, username: string) {
  const args = buildSshArgs(host, port, username)

  if (isWindows) {
    const command = getWindowsSshCommand()
    return {
      command,
      args,
      description: command,
    }
  }

  return {
    command: '/usr/bin/env',
    args: ['ssh', ...args],
    description: '/usr/bin/env ssh',
  }
}

function buildSshArgs(host: string, port: number, username: string) {
  const args: string[] = []
  if (port && port !== 22) {
    args.push('-p', String(port))
  }

  args.push('-o', 'ServerAliveInterval=30')
  args.push('-o', 'ServerAliveCountMax=3')
  args.push('-o', 'StrictHostKeyChecking=accept-new')
  args.push('-o', 'UpdateHostKeys=yes')

  const target = username ? `${username}@${host}` : host
  args.push(target)

  return args
}

function getWindowsSshCommand() {
  const candidates: string[] = []
  const systemRoot = process.env.SystemRoot || process.env.WINDIR
  if (systemRoot) {
    candidates.push(path.join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe'))
  }

  const programFiles = process.env.ProgramFiles
  if (programFiles) {
    candidates.push(path.join(programFiles, 'Git', 'usr', 'bin', 'ssh.exe'))
  }

  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) {
    candidates.push(
      path.join(programFilesX86, 'Git', 'usr', 'bin', 'ssh.exe')
    )
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return 'ssh.exe'
}

function buildConnectionText(host: string, port: number, username: string) {
  const target = username ? `${username}@${host}` : host
  return `${target}${port !== 22 ? `:${port}` : ''}`
}

function buildEnv(password: string, sessionId: string) {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }

  env.TERM = 'xterm-256color'
  env.LANG = env.LANG || 'en_US.UTF-8'
  env.LC_ALL = env.LC_ALL || env.LANG

  let askpassScriptPath = ''
  if (password) {
    askpassScriptPath = createAskpassScript(sessionId)
    if (askpassScriptPath) {
      env.AYA_DEVBOX_PASSWORD = password
      env.SSH_ASKPASS = askpassScriptPath
      env.SSH_ASKPASS_REQUIRE = 'force'
      env.DISPLAY = env.DISPLAY || 'aya-devbox'
    }
  }

  return {
    env,
    askpassScriptPath,
  }
}

function createAskpassScript(sessionId: string) {
  try {
    const ext = isWindows ? '.cmd' : '.sh'
    const askpassScriptPath = path.join(
      os.tmpdir(),
      `aya-devbox-askpass-${sessionId}${ext}`
    )

    if (isWindows) {
      fs.writeFileSync(
        askpassScriptPath,
        '@echo off\r\nsetlocal enabledelayedexpansion\r\necho %AYA_DEVBOX_PASSWORD%\r\n'
      )
    } else {
      fs.writeFileSync(
        askpassScriptPath,
        '#!/bin/sh\nprintf "%s\\n" "$AYA_DEVBOX_PASSWORD"\n',
        {
          mode: 0o700,
        }
      )
    }

    return askpassScriptPath
  } catch {
    return ''
  }
}

function cleanupAskpassScript(filePath: string) {
  if (!filePath) {
    return
  }

  try {
    fs.unlinkSync(filePath)
  } catch {
    // Ignore cleanup failures for temporary askpass helper.
  }
}

function createSshLaunchError(error: unknown, command: string) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes('File not found')
  ) {
    if (isWindows) {
      return new Error(
        `未找到系统 SSH，可执行文件: ${command}。请安装 Windows OpenSSH Client，或安装 Git for Windows，并确保 ssh.exe 可用。`
      )
    }

    return new Error(`未找到系统 SSH，可执行文件: ${command}`)
  }

  if (error instanceof Error) {
    return error
  }

  return new Error(`启动 SSH 失败: ${String(error)}`)
}
