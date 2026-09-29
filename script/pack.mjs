import { $, cd, fs, usePowerShell } from 'zx'
import builder from 'electron-builder'
import isMac from 'licia/isMac.js'
import isWindows from 'licia/isWindows.js'

if (process.platform === 'win32') {
  usePowerShell()
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

await $`${npm} run build`

cd('dist')

const pkg = await fs.readJson('package.json')

const config = {
  appId: pkg.appId,
  directories: {
    output: `../release/${pkg.version}`,
  },
  files: ['main', 'preload', 'renderer', 'node_modules'],
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  // node-pty ships a compatible Windows prebuild. Avoid requiring a local
  // Visual Studio C++ toolchain solely to rebuild it during packaging.
  npmRebuild: false,
  extraResources: {
    from: 'resources',
    to: './',
    filter: ['**/*'],
  },
  nsis: {
    allowToChangeInstallationDirectory: true,
    oneClick: false,
    installerSidebar: 'build/installerSidebar.bmp',
  },
  win: {
    // Keep local Windows packaging functional where symlink creation is
    // unavailable. Enable this after configuring the host's Developer Mode
    // or equivalent privilege to edit Windows executable version resources.
    signAndEditExecutable: false,
    target: [
      {
        target: 'nsis',
      },
    ],
  },
  mac: {
    electronLanguages: ['zh_CN', 'en'],
    target: [
      {
        target: 'dmg',
      },
    ],
    icon: 'build/icon.icns',
  },
}

const localElectronDist = '../node_modules/electron/dist'
if (await fs.pathExists(localElectronDist)) {
  config.electronDist = localElectronDist
}

if (isMac) {
  const args = process.argv.slice(2)
  const entitlements = {
    entitlements: 'build/entitlements.mas.plist',
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
  }
  if (args.includes('--mas-dev')) {
    config.mac.target = [
      {
        target: 'mas-dev',
      },
    ]
    config.masDev = {
      ...entitlements,
      provisioningProfile: 'build/mas-dev.provisionprofile',
    }
  } else if (args.includes('--mas')) {
    config.mac.target = [
      {
        target: 'mas',
      },
    ]
    config.mac.extendInfo = {
      LSMinimumSystemVersion: '12.0',
    }
    config.mas = {
      ...entitlements,
      provisioningProfile: 'build/mas.provisionprofile',
    }
  }
}

if (isWindows) {
  const args = process.argv.slice(2)
  if (args.includes('--appx')) {
    config.win.target = [
      {
        target: 'appx',
      },
    ]
    const identityName = process.env.WINDOWS_APPX_IDENTITY_NAME
    const publisher = process.env.WINDOWS_APPX_PUBLISHER
    if (!identityName || !publisher) {
      throw new Error(
        'AppX packaging requires WINDOWS_APPX_IDENTITY_NAME and WINDOWS_APPX_PUBLISHER for your own Microsoft Store identity.'
      )
    }
    config.appx = {
      identityName,
      publisher,
      publisherDisplayName: pkg.author,
      displayName: pkg.productName,
    }
  }
}

await builder.build({
  config,
})
