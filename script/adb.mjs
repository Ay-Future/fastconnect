import { fs } from 'zx'
import isWindows from 'licia/isWindows.js'
import isMac from 'licia/isMac.js'
import normalizePath from 'licia/normalizePath.js'
import path from 'path'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import extract from 'extract-zip'

const adbDir = resolve(__dirname, '../resources/adb')

await fs.ensureDir(adbDir)

const platformToolsPath = resolve(
  adbDir,
  `platform-tools-latest-${getPlatformName()}.zip`
)
const platformToolsDir = resolve(adbDir, 'platform-tools')
const downloadUrl = `https://dl.google.com/android/repository/platform-tools-latest-${getPlatformName()}.zip`

await downloadFile(downloadUrl, platformToolsPath)
await fs.remove(platformToolsDir)
await extract(platformToolsPath, { dir: adbDir })
await fs.remove(platformToolsPath)

let files = ['adb']
if (isWindows) {
  files = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll']
}

for (const file of files) {
  await fs.copy(resolve(platformToolsDir, file), resolve(adbDir, file), {
    overwrite: true,
  })
}

await fs.remove(platformToolsDir)

function getPlatformName() {
  if (isWindows) {
    return 'windows'
  }

  if (isMac) {
    return 'darwin'
  }

  return 'linux'
}

async function downloadFile(url, dest) {
  const response = await fetch(url)

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest))
}

function resolve(...args) {
  return normalizePath(path.resolve(...args))
}
