import {
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron'

export interface IModalProps {
  visible: boolean
  onClose: () => void
}

export type IpcGetLanguage = () => string
export type IpcGetTheme = () => string
export type IpcGetStore = (name: string) => any
export type IpcSetStore = (name: string, val: any) => void
export type IpcShowContextMenu = (x: number, y: number, template: any) => void
export type IpcShowOpenDialog = (
  options: OpenDialogOptions
) => Promise<OpenDialogReturnValue>
export type IpcShowSaveDialog = (
  options: SaveDialogOptions
) => Promise<SaveDialogReturnValue>
export type IpcSendToWindow = (
  name: string,
  channel: string,
  ...args: any[]
) => void
export type IpcOpenExternal = (url: string) => void
export type IpcOpenPath = (path: string) => void
export type IpcShowItemInFolder = IpcOpenPath
export type IpcOpenWindow = (
  url: string,
  name?: string,
  options?: {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    openDevTools?: boolean
  }
) => void
export type IpcGetLogs = () => string[]
export type IpcIsCustomTitlebar = () => boolean
export type IpcGetOpenFile = (ext: string) => string | void
export type IpcResolveResources = (p: string) => string

export interface IProcess {
  name: string
  pid: number
  cpu: number
  memory: number
  type: string
  webContentsId?: number
}
export type IpcGetProcessData = () => Promise<Array<IProcess>>
export type IpcKillProcess = (pid: number) => void
export type IpcOpenDevtools = (webContentsId: number) => void
export type IpcGetCpuAndMem = () => Promise<{ cpu: number; memory: number }>
export type IpcGetFileIcon = (ext: string) => Promise<string>
export type IpcShowVideo = (url: string) => void
export type IpcGetPath = (
  name: Parameters<Electron.App['getPath']>[0]
) => string
