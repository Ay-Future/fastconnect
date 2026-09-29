/* eslint-disable */
import { ipcRenderer } from 'electron'

export function invoke<T extends Function>(channel) {
  return function (...args: any[]) {
    return ipcRenderer.invoke(channel, ...args)
  } as Promisify<T>
}

type Parameters<F extends Function> = F extends (...args: infer L) => any
  ? L
  : never

type Return<F extends Function> = F extends (...args: any[]) => infer R
  ? R
  : never

type Promisify<F extends Function> = Return<F> extends Promise<any>
  ? F
  : (...args: Parameters<F>) => Promise<Return<F>>
