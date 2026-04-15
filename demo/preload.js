'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sunvote', {
  // Driver helpers
  checkDriver: () => ipcRenderer.invoke('driver:check'),
  openDriverDownload: () => ipcRenderer.invoke('driver:open-download'),

  // Ports & connection
  listPorts: () => ipcRenderer.invoke('ports:list'),
  connect: (opts) => ipcRenderer.invoke('sunvote:connect', opts),
  disconnect: () => ipcRenderer.invoke('sunvote:disconnect'),

  // Config management
  writeConfig: (cfg) => ipcRenderer.invoke('sunvote:write-config', cfg),

  // Keypad programming
  writeKeypadId: (id) => ipcRenderer.invoke('sunvote:write-keypad-id', id),
  readKeypadId: () => ipcRenderer.invoke('sunvote:read-keypad-id'),

  // Voting
  startVoting: (opts) => ipcRenderer.invoke('sunvote:start-voting', opts),
  stopVoting: () => ipcRenderer.invoke('sunvote:stop-voting'),
  snapshot: () => ipcRenderer.invoke('sunvote:snapshot'),

  // Events
  onKeypadPress: (cb) => ipcRenderer.on('keypad:press', (_e, p) => cb(p)),
  onKeypadClick: (cb) => ipcRenderer.on('keypad:click', (_e, p) => cb(p)),
  onKeypadNew: (cb) => ipcRenderer.on('keypad:new', (_e, id) => cb(id)),
  onStateChange: (cb) => ipcRenderer.on('state:change', (_e, s) => cb(s)),
  onBaseConfig: (cb) => ipcRenderer.on('base:config', (_e, c) => cb(c)),
  onError: (cb) => ipcRenderer.on('sdk:error', (_e, m) => cb(m)),
});
