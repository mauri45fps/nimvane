const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  newTab: () => ipcRenderer.send('tab:new'),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  activate: (id) => ipcRenderer.send('tab:activate', id),
  suspend: (id) => ipcRenderer.send('tab:suspend', id),
  suspendAll: () => ipcRenderer.send('tab:suspend-all'),
  navigate: (text) => ipcRenderer.send('nav:go', text),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  focusPage: () => ipcRenderer.send('nav:focus-page'),
  toggleUsage: (open) => ipcRenderer.send('usage:toggle', open),
  installUpdate: () => ipcRenderer.send('update:install'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusOmnibox: (cb) => ipcRenderer.on('focus-omnibox', () => cb()),
  onUsage: (cb) => ipcRenderer.on('usage', (_e, u) => cb(u)),
  onUsageBrief: (cb) => ipcRenderer.on('usage-brief', (_e, u) => cb(u)),
});
