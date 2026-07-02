import { IpcMain } from 'electron';
import { HushConfig } from '../types';
import { comboLabel } from '../combo';
import * as rpc from './rpc';
import * as hid from './hid';
import * as ax from './ax';
import * as audio from './audio';

// Wire every experiment behind IPC channels. Kept fully separate from the real
// push-to-talk engine — this is a test bench, not the product flow.
export function registerTestBench(ipcMain: IpcMain, getCfg: () => HushConfig): void {
  ipcMain.handle('test:discordCombo', () => {
    const combo = getCfg().discordCombo;
    return { combo, label: comboLabel(combo) };
  });

  // A — Discord RPC
  ipcMain.handle('test:rpc:connect', (_e, id: string, secret: string) => rpc.connect(id, secret));
  ipcMain.handle('test:rpc:setMute', (_e, mute: boolean) => rpc.setMute(mute));
  ipcMain.handle('test:rpc:disconnect', () => rpc.disconnect());

  // B — HID keystroke (uses the configured Discord mute combo)
  ipcMain.handle('test:hid:tap', () => hid.tapCombo(getCfg().discordCombo));

  // C — Accessibility button press
  ipcMain.handle('test:ax:toggle', () => ax.toggleMute());
  ipcMain.handle('test:ax:dump', () => ax.dumpButtons());

  // D — Audio device
  ipcMain.handle('test:audio:detect', () => audio.detect());
  ipcMain.handle('test:audio:degradedMute', (_e, mute: boolean) => audio.degradedInputMute(mute));
}
