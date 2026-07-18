import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const api = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, cb: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  off: (channel: string, cb: (...args: unknown[]) => void): void => {
    ipcRenderer.off(channel, cb)
  },
}

contextBridge.exposeInMainWorld('polenta', api)

export type PolentaApi = typeof api

declare global {
  interface Window {
    polenta: PolentaApi
  }
}
