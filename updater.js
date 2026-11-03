const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Checks GitHub Releases (build.publish in package.json) for a newer version, downloads it
// in the background, then the toolbar offers "Restart to update".
const FIRST_CHECK_MS = 15 * 1000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

function startUpdater(onChange) {
  if (!app.isPackaged) return null; // npm start never updates itself
  const updaterLib = require('electron-updater');
  const { PacmanUpdater } = updaterLib;
  // electron-builder labels .deb/.rpm installs (resources/package-type) but not .pacman ones,
  // so electron-updater would treat an Arch install as an AppImage and never update it.
  const autoUpdater = installedByPacman() ? new PacmanUpdater() : updaterLib.autoUpdater;

  // The stock pacman fallback runs `pacman -Sy`, a partial sync that Arch warns can leave the
  // system half-upgraded. Install the downloaded package or fail, nothing else.
  PacmanUpdater.installWithCommandRunner = (installerPath, run) => run(['pacman', '-U', '--noconfirm', installerPath]);

  // Installing a .pacman/.deb needs a password prompt, so on those only install when the user
  // clicks the button, not silently every time the browser quits.
  const needsRoot = process.platform === 'linux' && !process.env.APPIMAGE;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = !needsRoot;

  let state = { status: 'idle', version: null, percent: 0 };
  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('update-not-available', () => set({ status: 'idle' }));
  autoUpdater.on('error', (err) => {
    console.warn('update check failed:', err && err.message);
    if (state.status !== 'ready') set({ status: 'idle' });
  });

  const check = () => {
    if (state.status === 'idle') autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);

  return {
    check,
    install: () => {
      if (state.status === 'ready') autoUpdater.quitAndInstall(false, true);
    },
  };
}

function installedByPacman() {
  if (process.platform !== 'linux' || process.env.APPIMAGE) return false;
  if (fs.existsSync(path.join(process.resourcesPath, 'package-type'))) return false;
  try {
    execFileSync('pacman', ['-Qqo', process.execPath], { stdio: 'ignore', timeout: 3000 });
    return true; // pacman owns this file
  } catch {
    return false;
  }
}

module.exports = { startUpdater };
