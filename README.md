# FastConnect

FastConnect is an Android ADB desktop application for controlling and inspecting Android devices.

## Upstream and licensing

This is a modified derivative of [AYA](https://github.com/liriliri/aya), created by its original contributors. AYA is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0); this entire derivative is also licensed under AGPL-3.0.

The original authors retain copyright in their contributions. See [NOTICE.md](NOTICE.md) for attribution and the downstream change notice, and see [LICENSE](LICENSE) for the complete license text.

FastConnect is an independent downstream project. It is not affiliated with, endorsed by, or supported by the AYA project or its original authors.

## Features

- Screen mirror and recording
- File explorer and APK management
- Process, CPU, memory, FPS, and Logcat tools
- Interactive ADB shell and device management
- Layout inspection and HTTP capture

## Development

```bash
npm install
npm run dev
```

Build the desktop application:

```bash
npm run build
```

Before packaging, make sure the runtime resources are present. Generate them where needed:

```bash
npm run adb
npm run scrcpy
npm run server
```

Package for the current platform:

```bash
npm run pack
```

Artifacts are written to `release/<version>/`.

## Publishing releases and corresponding source

Every public installer release must have matching **Corresponding Source** publicly available in this repository under AGPL-3.0. Follow [RELEASING.md](RELEASING.md) before publishing an installer.

In particular, publish a Git tag for the exact commit used to build the installer, create the release from that tag, and do not remove or restrict access to its source, `LICENSE`, `NOTICE.md`, build scripts, or vendored shared-source directories.

## Windows AppX

AppX packages must use the downstream publisher's own Microsoft Store identity. Before `npm run pack:appx`, set these environment variables to the values issued for your Store account:

```powershell
$env:WINDOWS_APPX_IDENTITY_NAME = 'YourStoreIdentityName'
$env:WINDOWS_APPX_PUBLISHER = 'CN=YourCertificateSubject'
```
