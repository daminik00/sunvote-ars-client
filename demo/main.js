'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const {
  SunVoteController,
  checkDriver,
  getDriverInstallInfo,
  openDriverDownloadPage,
} = require('sunvote-ars-client');

let mainWindow = null;
let controller = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    title: 'SunVote ARS Client — Demo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function ensureController() {
  if (controller) return controller;
  controller = new SunVoteController();

  controller.on('keypad:press', (press) => send('keypad:press', press));
  controller.on('keypad:new', (keypadId) => send('keypad:new', keypadId));
  controller.on('state:change', (newState, oldState) =>
    send('state:change', { newState, oldState }),
  );
  controller.on('base:config', (config) => send('base:config', config));
  controller.on('error', (err) => send('sdk:error', err.message || String(err)));

  return controller;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  if (controller) {
    try {
      await controller.disconnect();
    } catch {
      // ignore — we're shutting down anyway
    }
    controller = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// -----------------------------------------------------------------------------
// IPC handlers
// -----------------------------------------------------------------------------

ipcMain.handle('driver:check', async () => {
  const status = await checkDriver();
  return { status, info: getDriverInstallInfo(status) };
});

ipcMain.handle('driver:open-download', async () => {
  return openDriverDownloadPage();
});

ipcMain.handle('ports:list', async () => {
  return SunVoteController.listPorts();
});

ipcMain.handle('sunvote:connect', async (_e, { debug = false } = {}) => {
  const ctrl = ensureController();
  const config = await ctrl.autoConnect({ debug });
  return config;
});

ipcMain.handle('sunvote:disconnect', async () => {
  if (!controller) return;
  await controller.disconnect();
});

ipcMain.handle('sunvote:start-voting', async (_e, opts = {}) => {
  if (!controller) throw new Error('Not connected');
  await controller.startVoting(opts);
});

ipcMain.handle('sunvote:stop-voting', async () => {
  if (!controller) return;
  await controller.stopVoting();
});

ipcMain.handle('sunvote:snapshot', () => {
  if (!controller) {
    return { state: 'idle', config: null, keypads: [] };
  }
  const keypads = Array.from(controller.getKeypads().entries()).map(([id, press]) => ({
    keypadId: id,
    press,
  }));
  return {
    state: controller.currentState,
    config: controller.config,
    keypads,
  };
});
