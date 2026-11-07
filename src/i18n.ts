// UI language for the main process (tray menu, macOS app menu, tooltip). The
// settings window has its own string tables in renderer/i18n.js.

export type Language = 'en' | 'fr';
export const LANGUAGES: Language[] = ['en', 'fr'];

// The saved choice wins; with none saved, follow the system language, so a
// French system keeps the original French UI and everything else gets English.
export function resolveLanguage(saved: unknown, systemLocale: string): Language {
  if (saved === 'en' || saved === 'fr') return saved;
  return systemLocale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export interface TrayStrings {
  tagline: string;
  connected: string;
  connecting: string;
  notConnected: string;
  thisComputer: string;
  anotherComputer: string;
  anotherComputerEllipsis: string;
  modeHold: string;
  modeToggle: string;
  statusPerms: string;
  statusListenerFailed: string;
  statusMuted: string;
  statusReady: string;
  shortcut: string;
  mode: string;
  discord: string;
  discordLocation: string;
  updateDownload: string;
  settings: string;
  quitHush: string;
  about: string;
  quit: string;
  edit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
}

export const TRAY: Record<Language, TrayStrings> = {
  en: {
    tagline: 'Mute Discord while you dictate.',
    connected: 'connected ✓',
    connecting: 'connecting…',
    notConnected: 'not connected',
    thisComputer: 'This computer',
    anotherComputer: 'Another computer',
    anotherComputerEllipsis: 'Another computer…',
    modeHold: 'Hold',
    modeToggle: 'Toggle',
    statusPerms: '⚠︎ Permissions needed',
    statusListenerFailed: '⚠︎ Shortcut listener failed',
    statusMuted: '● Discord muted — dictating',
    statusReady: '○ Ready',
    shortcut: 'Shortcut: ',
    mode: 'Mode: ',
    discord: 'Discord: ',
    discordLocation: 'Discord location',
    updateDownload: '⬆︎ New version {version} — Download',
    settings: 'Settings…',
    quitHush: 'Quit Hush',
    about: 'About',
    quit: 'Quit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
  },
  fr: {
    tagline: 'Coupe Discord pendant que tu dictes.',
    connected: 'connecté ✓',
    connecting: 'connexion…',
    notConnected: 'non connecté',
    thisComputer: 'Cette machine',
    anotherComputer: 'Autre machine',
    anotherComputerEllipsis: 'Autre machine…',
    modeHold: 'Maintenir',
    modeToggle: 'Bascule',
    statusPerms: '⚠︎ Permissions requises',
    statusListenerFailed: '⚠︎ Écoute du raccourci impossible',
    statusMuted: '● Micro coupé — dictée en cours',
    statusReady: '○ Prêt',
    shortcut: 'Raccourci : ',
    mode: 'Mode : ',
    discord: 'Discord : ',
    discordLocation: 'Emplacement de Discord',
    updateDownload: '⬆︎ Nouvelle version {version} — Télécharger',
    settings: 'Réglages…',
    quitHush: 'Quitter Hush',
    about: 'À propos de',
    quit: 'Quitter',
    edit: 'Édition',
    undo: 'Annuler',
    redo: 'Rétablir',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller',
    selectAll: 'Tout sélectionner',
  },
};
