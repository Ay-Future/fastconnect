#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import readline from 'node:readline'
import process from 'node:process'

const DEFAULT_PACKAGE = 'com.jzx.client.aiteacher.math'
const DEFAULT_LIMIT = 20

const args = process.argv.slice(2)
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'watch'
const options = parseArgs(command === args[0] ? args.slice(1) : args)
const serialArgs = options.serial ? ['-s', options.serial] : []

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})

async function main() {
  if (options.help || command === 'help') {
    printHelp()
    return
  }

  ensureAdbAvailable()

  switch (command) {
    case 'watch':
      await watchTraffic()
      return
    case 'snapshot':
      await printCacheSnapshot()
      return
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

async function watchTraffic() {
  const pkg = options.pkg || DEFAULT_PACKAGE
  const pids = getPackagePids(pkg)

  if (!pids.length) {
    throw new Error(`${pkg} is not running. Open the app first, then rerun this command.`)
  }

  if (options.clear) {
    adbSync(['logcat', '-c'])
  }

  console.log(`# watching ${pkg}`)
  console.log(`# pids: ${pids.join(', ')}`)
  console.log('# press Ctrl+C to stop')

  const pidArgs = pids.map((pid) => `--pid=${pid}`)
  const child = spawn(
    'adb',
    [...serialArgs, 'logcat', ...pidArgs, '-v', 'brief'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  const stdout = readline.createInterface({ input: child.stdout })
  const stderr = readline.createInterface({ input: child.stderr })

  stdout.on('line', (line) => {
    if (!shouldPrintLine(line)) {
      return
    }

    if (options.raw) {
      console.log(line)
      return
    }

    const summary = formatSpanLine(line)
    console.log(summary || line)
  })

  stderr.on('line', (line) => {
    if (line.trim()) {
      console.error(line)
    }
  })

  await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || code === null) {
        resolve()
        return
      }
      reject(new Error(`adb logcat exited with code ${code}`))
    })
  })
}

async function printCacheSnapshot() {
  const pkg = options.pkg || DEFAULT_PACKAGE
  const limit = Number.parseInt(options.limit || DEFAULT_LIMIT, 10)

  ensureRunAs(pkg)

  const entries = listCacheEntries(pkg).slice(0, limit)

  if (!entries.length) {
    console.log(`No OkHttp cache entries found for ${pkg}.`)
    return
  }

  console.log(`# cache snapshot for ${pkg}`)
  console.log(`# showing ${entries.length} most recent entries`)

  for (const file of entries) {
    const meta = adbSync(['shell', 'run-as', pkg, 'cat', `cache/http/${file}`])
    const entry = parseCacheMetadata(file, meta)

    if (!entry.url) {
      continue
    }

    const parts = [
      entry.method || 'UNKNOWN',
      entry.status || 'UNKNOWN',
      entry.url,
    ]

    if (entry.sentMillis && entry.receivedMillis) {
      const elapsed = Number(entry.receivedMillis) - Number(entry.sentMillis)
      if (Number.isFinite(elapsed)) {
        parts.splice(2, 0, `${elapsed}ms`)
      }
    }

    console.log(parts.join('  '))
  }
}

function ensureAdbAvailable() {
  const result = spawnSync('adb', ['version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    throw new Error('adb is not available in PATH.')
  }
}

function ensureRunAs(pkg) {
  const result = spawnSync('adb', [...serialArgs, 'shell', 'run-as', pkg, 'pwd'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    throw new Error(`run-as failed for ${pkg}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
}

function getPackagePids(pkg) {
  const output = adbSync(['shell', 'pidof', pkg], { allowFailure: true }).trim()
  if (!output) {
    return []
  }

  return output
    .split(/\s+/)
    .map((pid) => pid.trim())
    .filter(Boolean)
}

function listCacheEntries(pkg) {
  const output = adbSync(['shell', 'run-as', pkg, 'ls', '-lt', 'cache/http'])

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\.0$/.test(line))
    .map((line) => line.split(/\s+/).at(-1))
}

function shouldPrintLine(line) {
  return (
    line.includes('LoggingSpanExporter:') ||
    line.includes('[OkHttp] sendRequest') ||
    line.includes('bizRequestUrl=')
  )
}

function formatSpanLine(line) {
  if (!line.includes('LoggingSpanExporter:')) {
    return line
  }

  const time = matchField(line, /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)/)
  const url =
    matchField(line, /bizRequestUrl=([^,\s}]+)/) ||
    matchField(line, /LoggingSpanExporter: '([^']+)'/)
  const method = matchField(line, /bizRequestType=([^,\s}]+)/)
  const status = matchField(line, /nodeStatus=([^,\s}]+)/)
  const code = matchField(line, /bizResponseCode=([^,\s}]+)/)
  const elapsed = matchField(line, /nodeElapsedTime=([^,\s}]+)/)

  if (!url) {
    return line
  }

  const parts = []
  if (time) {
    parts.push(`[${time}]`)
  }
  if (method) {
    parts.push(method)
  }
  if (status) {
    parts.push(status)
  }
  if (code) {
    parts.push(`code=${code}`)
  }
  if (elapsed) {
    parts.push(`${elapsed}ms`)
  }
  parts.push(url)

  return parts.join('  ')
}

function parseCacheMetadata(file, meta) {
  const lines = meta.split('\n')

  return {
    file,
    url: lines[0]?.trim(),
    method: lines[1]?.trim(),
    status: lines[3]?.trim(),
    sentMillis: matchField(meta, /^OkHttp-Sent-Millis: (\d+)$/m),
    receivedMillis: matchField(meta, /^OkHttp-Received-Millis: (\d+)$/m),
  }
}

function matchField(text, pattern) {
  const match = text.match(pattern)
  return match?.[1]?.trim() || ''
}

function adbSync(args, { allowFailure = false } = {}) {
  const result = spawnSync('adb', [...serialArgs, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  })

  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `adb ${args.join(' ')} failed`)
  }

  return result.stdout || ''
}

function parseArgs(argv) {
  const parsed = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (!arg.startsWith('--')) {
      continue
    }

    const key = arg.slice(2)
    const next = argv[i + 1]

    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }

    parsed[key] = next
    i += 1
  }

  return parsed
}

function printHelp() {
  console.log(`Usage:
  node script/capture-http.mjs watch [--pkg <package>] [--serial <device>] [--clear] [--raw]
  node script/capture-http.mjs snapshot [--pkg <package>] [--serial <device>] [--limit <n>]

Defaults:
  --pkg ${DEFAULT_PACKAGE}

Examples:
  node script/capture-http.mjs watch --clear
  node script/capture-http.mjs snapshot --limit 10`)
}
