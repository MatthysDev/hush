import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg: unknown) => ipcRenderer.invoke('config:set', cfg),
  getBrand: () => ipcRenderer.invoke('brand:get'),
  getPermissions: () => ipcRenderer.invoke('perm:status'),
  captureCombo: () => ipcRenderer.invoke('capture:combo'),
  openAccessibility: () => ipcRenderer.send('perm:open-accessibility'),
  openInputMonitoring: () => ipcRenderer.send('perm:open-input'),
  quit: () => ipcRenderer.send('app:quit'),
  onStatus: (cb: (s: unknown) => void) => ipcRenderer.on('status', (_e, s) => cb(s)),
};

contextBridge.exposeInMainWorld('hush', bridge);
