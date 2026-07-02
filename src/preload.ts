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
  openTestBench: () => ipcRenderer.send('testbench:open'),
  test: {
    discordCombo: () => ipcRenderer.invoke('test:discordCombo'),
    rpcConnect: (id: string, secret: string) => ipcRenderer.invoke('test:rpc:connect', id, secret),
    rpcSetMute: (mute: boolean) => ipcRenderer.invoke('test:rpc:setMute', mute),
    rpcDisconnect: () => ipcRenderer.invoke('test:rpc:disconnect'),
    hidTap: () => ipcRenderer.invoke('test:hid:tap'),
    axToggle: () => ipcRenderer.invoke('test:ax:toggle'),
    axDump: () => ipcRenderer.invoke('test:ax:dump'),
    audioDetect: () => ipcRenderer.invoke('test:audio:detect'),
    audioDegradedMute: (mute: boolean) => ipcRenderer.invoke('test:audio:degradedMute', mute),
  },
};

contextBridge.exposeInMainWorld('hush', bridge);
