export interface IDevice {
  id: string
  name: string
  serialno: string
  androidVersion: string
  sdkVersion: string
  type: 'emulator' | 'device' | 'offline' | 'unauthorized' | 'unknown'
}

export interface IAvd {
  id: string
  name: string
  abi: string
  sdkVersion: string
  memory: number
  internalStorage: number
  resolution: string
  folder: string
  pid: number
}

export interface IPackageInfo {
  icon: string
  label: string
  enabled: boolean
  packageName: string
  versionName: string
  apkPath: string
  apkSize: number
  system: boolean
  firstInstallTime: number
  lastUpdateTime: number
  minSdkVersion?: number
  targetSdkVersion?: number
  dataSize: number
  cacheSize: number
  appSize: number
  signatures: string[]
}

export interface IFileStat {
  size?: number
  mtime: Date
  directory: boolean
  mode: string
}

export interface IFile extends IFileStat {
  name: string
  mime?: string
}

export interface IWebview {
  id?: string
  title: string
  url: string
  type?: string
  source?: 'devtools' | 'logcat'
  devtoolsFrontendUrl: string
  webSocketDebuggerUrl: string
  faviconUrl?: string
}

export interface IWebviewResult {
  items: IWebview[]
  reason: string
  socketName: string
}

export interface IHttpCaptureEntry {
  id: string
  source: 'logcat' | 'cache'
  sourceLabel: string
  packageName: string
  time: number
  timeLabel: string
  method: string
  status: string
  code: string
  durationMs: number
  url: string
  requestPreview: string
  responsePreview: string
  raw: string
}

export interface IHttpCaptureSnapshotResult {
  items: IHttpCaptureEntry[]
  reason: string
  packageName: string
}

export interface IProcess {
  name: string
  pid: string
}

export interface IDeviceDiagnostics {
  batteryLevel: number
  batteryTemperature: number
  batteryVoltage: number
  batteryStatus: string
  charging: boolean
  chargeSource: string
  wifi: string
  wifiState: string
  gateway: string
  ip: string
  mac: string
  rssi: number
  frequency: number
  linkSpeed: number
  txLinkSpeed: number
  rxLinkSpeed: number
}

export interface IDevicePacketLossResult {
  target: string
  transmitted: number
  received: number
  packetLoss: number
  minLatency: number
  avgLatency: number
  maxLatency: number
  jitter: number
  raw: string
  parsed: boolean
}

export interface IProxySettingsStatus {
  computerIp: string
  computerWifi: string
  deviceIp: string
  deviceWifi: string
  currentProxy: string
  hasProxy: boolean
  sameSubnet: boolean
}

export interface IProxySettingsResult extends IProxySettingsStatus {
  success: boolean
  output: string
  appliedProxy: string
}

export interface IDevboxSessionOptions {
  host: string
  port?: number
  username?: string
  password?: string
}

export interface IFastbugCollectorOptions {
  serial: string
  packageName: string
  port?: number
}

export interface IFastbugCollectorStatus {
  running: boolean
  starting: boolean
  managed: boolean
  serial: string
  packageName: string
  sessionId: string
  port: number
  url: string
  dataRoot: string
  agentStatus: 'unchecked' | 'synced' | 'missing' | 'sync_failed'
  agentSessionId: string
  agentMessage: string
  lastError: string
  logs: string[]
}

export type ITestSessionActionType =
  | 'touch'
  | 'scroll'
  | 'key'
  | 'text'
  | 'deviceKey'
  | 'screenPower'

export interface ITestSessionSummary {
  id: string
  name: string
  status: 'recording' | 'finalizing' | 'completed' | 'failed'
  deviceId: string
  deviceName: string
  createdAt: number
  updatedAt: number
  durationMs: number
  directory: string
  videoPath: string
  actionsCount: number
  logCount: number
  performanceCount: number
  error?: string
}

export interface ITestSessionMeta extends ITestSessionSummary {
  startedAt: number
  endedAt: number
}

export interface ITestSessionAction {
  recordedAt: number
  at: number
  type: ITestSessionActionType
  summary: string
  detail: string
  payload?: any
}

export interface ITestSessionLogEntry {
  recordedAt: number
  at: number
  date: number
  pid: number
  tid: number
  priority: number
  tag: string
  message: string
  package?: string
}

export interface ITestSessionPerformanceSample {
  recordedAt: number
  at: number
  cpuPercent: number
  memUsed: number
  memTotal: number
  fps: number
  batteryLevel: number
  batteryTemperature: number
  topPackageName: string
  topPackageLabel: string
}

export interface ITestSessionEvidence {
  capturedAt: number
  videoPath: string
  screenshotPath: string
  uiXmlPath: string
  logPath: string
  actionsPath: string
  performancePath: string
  deviceInfoPath: string
  errors: string[]
}

export interface ITestSessionDraft {
  status: 'local_draft' | 'confirmed_locally'
  createdAt: number
  updatedAt: number
  title: string
  reproductionSteps: string[]
  expectedResult: string
  actualResult: string
  severity: string
  module: string
  testerNote: string
}

export interface ITestSessionArtifacts {
  meta: ITestSessionMeta
  actions: ITestSessionAction[]
  logs: ITestSessionLogEntry[]
  performance: ITestSessionPerformanceSample[]
  evidence: ITestSessionEvidence | null
  draft: ITestSessionDraft
}

export interface IScreencastTestSessionState {
  id: string
  startedAt: number
  videoPath: string
  recording: boolean
}

export enum TransferType {
  Upload,
  Download,
}

export type IpcGetFps = (deviceId: string, pkg: string) => Promise<number>
export type IpcGetFastbugCollectorStatus = () => Promise<IFastbugCollectorStatus>
export type IpcStartFastbugCollector = (
  options: IFastbugCollectorOptions
) => Promise<IFastbugCollectorStatus>
export type IpcRestartFastbugCollector = (
  options: IFastbugCollectorOptions
) => Promise<IFastbugCollectorStatus>
export type IpcStopFastbugCollector = () => Promise<IFastbugCollectorStatus>
export type IpcGetDevices = () => Promise<IDevice[]>
export type IpcGetDeviceDiagnostics = (
  deviceId: string
) => Promise<IDeviceDiagnostics>
export type IpcGetMockQuestionId = (deviceId: string) => Promise<string>
export type IpcGetProxySettingsStatus = (
  deviceId: string
) => Promise<IProxySettingsStatus>
export type IpcRunPacketLossTest = (
  deviceId: string,
  target?: string
) => Promise<IDevicePacketLossResult>
export type IpcSetHttpProxy = (
  deviceId: string,
  proxy: string
) => Promise<IProxySettingsResult>
export type IpcClearHttpProxy = (
  deviceId: string
) => Promise<IProxySettingsResult>
export type IpcSetMockQuestionId = (
  deviceId: string,
  questionId: string
) => Promise<string>
export type IpcResetMockQuestionId = (deviceId: string) => Promise<void>
export type IpcSetScreencastAlwaysOnTop = (alwaysOnTop: boolean) => void
export type IpcListForwards = (
  deviceId: string
) => Promise<Array<{ local: string; remote: string }>>
export type IpcListReverses = IpcListForwards
export type IpcForward = (
  deviceId: string,
  local: string,
  remote: string
) => void
export type IpcReverse = (
  deviceId: string,
  remote: string,
  local: string
) => void
export type IpcDumpWindowHierarchy = (deviceId: string) => Promise<string>
export type IpcGetPackageInfos = (
  deviceId: string,
  packageNames: string[]
) => Promise<IPackageInfo[]>
export type IpcGetAvds = (forceRefresh?: boolean) => Promise<IAvd[]>
export type IpcStartAvd = (avdId: string) => Promise<void>
export type IpcStopAvd = IpcStartAvd
export type IpcWipeAvdData = (avdId: string) => Promise<void>
export type IpcPairDevice = (
  host: string,
  port: number,
  password: string
) => Promise<void>
export type IpcCreateShell = (deviceId: string) => Promise<string>
export type IpcWriteShell = (sessionId: string, data: string) => void
export type IpcResizeShell = (
  sessionId: string,
  cols: number,
  rows: number
) => void
export type IpcKillShell = (sessionId: string) => void
export type IpcCreateDevboxSession = (
  options: IDevboxSessionOptions
) => Promise<string>
export type IpcWriteDevboxSession = (sessionId: string, data: string) => void
export type IpcResizeDevboxSession = (
  sessionId: string,
  cols: number,
  rows: number
) => void
export type IpcKillDevboxSession = (sessionId: string) => void
export type IpcScreencap = (deviceId: string) => Promise<string>
export type IpcOpenLogcat = (deviceId: string) => Promise<string>
export type IpcCloseLogcat = (logcatId: string) => Promise<void>
export type IpcResolveMainClose = (
  action: 'minimize' | 'quit' | 'cancel'
) => void
export type IpcPauseLogcat = IpcCloseLogcat
export type IpcResumeLogcat = IpcCloseLogcat
export type IpcInputKey = (deviceId: string, keyCode: number) => Promise<void>
export type IpcReverseTcp = (
  deviceId: string,
  remote: string
) => Promise<number>
export type IpcStartScrcpy = (deviceId: string, args: string[]) => Promise<void>
export type IpcConnectDevice = (host: string, port?: number) => Promise<void>
export type IpcDisconnectDevice = IpcConnectDevice
export type IpcMoveFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcStatFile = (deviceId: string, path: string) => Promise<IFileStat>
export type IpcReadDir = (deviceId: string, path: string) => Promise<IFile[]>
export type IpcCreateDir = (deviceId: string, path: string) => Promise<void>
export type IpcDeleteDir = IpcCreateDir
export type IpcDeleteFile = IpcCreateDir
export type IpcOpenFile = IpcCreateDir
export type IpcPushFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcPullFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcEnablePackage = (deviceId: string, pkg: string) => Promise<void>
export type IpcDisablePackage = IpcEnablePackage
export type IpcGetPackages = (
  deviceId: string,
  system?: boolean
) => Promise<string[]>
export type IpcInstallPackage = (
  deviceId: string,
  apkPath: string
) => Promise<void>
export type IpcUninstallPackage = (
  deviceId: string,
  pkg: string
) => Promise<void>
export type IpcStartPackage = (deviceId: string, pkg: string) => Promise<void>
export type IpcStopPackage = IpcStartPackage
export type IpcClearPackage = IpcStartPackage
export type IpcGetTopPackage = (deviceId: string) => Promise<{
  name: string
  pid: number
}>
export type IpcGetWebviews = (
  deviceId: string,
  pid: number
) => Promise<IWebviewResult>
export type IpcGetHttpCaptureSnapshot = (
  deviceId: string,
  pkg: string,
  limit?: number
) => Promise<IHttpCaptureSnapshotResult>
export type IpcGetHttpCaptureLogSnapshot = (
  deviceId: string,
  pkg: string,
  limit?: number
) => Promise<IHttpCaptureSnapshotResult>
export type IpcGetProcesses = (deviceId: string) => Promise<IProcess[]>
export type IpcGetFileUrl = (
  deviceId: string,
  path: string,
  port?: number
) => Promise<string>
