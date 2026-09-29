# FastConnect

FastConnect 是一款用于控制和检查 Android 设备的 ADB 桌面应用。

FastConnect is an ADB desktop application for controlling and inspecting Android devices.

## 上游项目与许可证 / Upstream and licensing

本项目是 [AYA](https://github.com/liriliri/aya) 的修改版衍生项目。AYA 由其原始贡献者开发，并以 GNU Affero General Public License v3.0（AGPL-3.0）发布；本衍生项目整体也以 AGPL-3.0 发布。

This project is a modified derivative of [AYA](https://github.com/liriliri/aya), created by its original contributors. AYA is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0); this entire derivative is also licensed under AGPL-3.0.

原始作者仍保有其贡献部分的版权。请参阅 [NOTICE.md](NOTICE.md) 了解署名与下游改动说明，并参阅 [LICENSE](LICENSE) 获取完整许可证文本。

The original authors retain copyright in their contributions. See [NOTICE.md](NOTICE.md) for attribution and the downstream change notice, and see [LICENSE](LICENSE) for the complete license text.

FastConnect 是独立的下游项目，与 AYA 项目及其原始作者不存在从属、认可或支持关系。

FastConnect is an independent downstream project. It is not affiliated with, endorsed by, or supported by the AYA project or its original authors.

## 功能 / Features

- 屏幕镜像与录制 / Screen mirroring and recording
- 文件浏览与 APK 管理 / File explorer and APK management
- 进程、CPU、内存、FPS 与 Logcat 工具 / Process, CPU, memory, FPS, and Logcat tools
- 交互式 ADB Shell 与设备管理 / Interactive ADB shell and device management
- 布局检查与 HTTP 抓包 / Layout inspection and HTTP capture

## 开发 / Development

安装依赖并启动开发模式：

Install dependencies and start development mode:

```bash
npm install
npm run dev
```

构建桌面应用：

Build the desktop application:

```bash
npm run build
```

打包前请确保运行时资源已就绪；按需执行以下命令生成：

Before packaging, make sure runtime resources are present. Generate them where needed:

```bash
npm run adb
npm run scrcpy
npm run server
```

为当前平台打包：

Package for the current platform:

```bash
npm run pack
```

产物会写入 `release/<version>/`。

Artifacts are written to `release/<version>/`.

## 发布与对应源码 / Publishing releases and corresponding source

每个公开发布的安装包，都必须按 AGPL-3.0 在本仓库公开提供对应版本的完整“对应源码”（Corresponding Source）。发布安装包前，请遵循 [RELEASING.md](RELEASING.md)。

Every public installer release must have matching **Corresponding Source** publicly available in this repository under AGPL-3.0. Follow [RELEASING.md](RELEASING.md) before publishing an installer.

具体而言，请为构建安装包所用的准确提交创建 Git tag，并从该 tag 创建发布版本；不得删除或限制对其源码、`LICENSE`、`NOTICE.md`、构建脚本或已纳入仓库的共享源码目录的访问。

In particular, publish a Git tag for the exact commit used to build the installer, create the release from that tag, and do not remove or restrict access to its source, `LICENSE`, `NOTICE.md`, build scripts, or vendored shared-source directories.

## Windows AppX

AppX 包必须使用下游发布者自己的 Microsoft Store 身份。执行 `npm run pack:appx` 前，请将以下环境变量设置为 Microsoft Store 帐户签发的值：

AppX packages must use the downstream publisher's own Microsoft Store identity. Before `npm run pack:appx`, set these environment variables to the values issued for your Store account:

```powershell
$env:WINDOWS_APPX_IDENTITY_NAME = 'YourStoreIdentityName'
$env:WINDOWS_APPX_PUBLISHER = 'CN=YourCertificateSubject'
```
