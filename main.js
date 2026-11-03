const { app, BaseWindow, WebContentsView, Menu, ipcMain, session, dialog, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { resolveInput, stripTracking, matchShortcut, summarizeMetrics, clientHintHeaders, wantsDetailedHints, cleanUserAgent, SEARCH } = require('./util');
const { Blocker } = require('./blocker');
const { startUpdater } = require('./updater');

// ---------------------------------------------------------------- speed flags
// Must be set before the app is ready.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
const features = ['CanvasOopRasterization', 'BackForwardCache'];
// Linux: run natively on Wayland when available (sharp fractional scaling), X11 otherwise.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  features.push('WaylandWindowDecorations');
}
app.commandLine.appendSwitch('enable-features', features.join(','));
app.commandLine.appendSwitch(
  'disable-features',
  'Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,InterestFeedContentSuggestions'
);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('no-pings');

// The app was called OptiBrowser before. Move its profile (cookies, logins, blocklist) over once.
{
  const legacy = path.join(app.getPath('appData'), 'OptiBrowser');
  const profile = app.getPath('userData');
  // Electron has already created the new folder (with Crashpad) by now, so move item by item.
  const fresh = !fs.existsSync(path.join(profile, 'Preferences'));
  if (fresh && fs.existsSync(legacy)) {
    try {
      fs.mkdirSync(profile, { recursive: true });
      for (const name of fs.readdirSync(legacy)) {
        const dest = path.join(profile, name);
        if (!fs.existsSync(dest)) fs.renameSync(path.join(legacy, name), dest);
      }
      fs.rmSync(legacy, { recursive: true, force: true });
    } catch {
      /* keep whatever moved; the rest starts fresh */
    }
  }
}

// ---------------------------------------------------------------- settings
const CHROME_H = 80; // height of the tab strip + toolbar
const SUSPEND_AFTER_MS = 5 * 60 * 1000; // free a background tab after 5 min idle
const SUSPEND_CHECK_MS = 60 * 1000;
const USAGE_W = 380; // usage panel size
const USAGE_H = 560;
const USAGE_POLL_MS = 1500; // while the usage panel is open
const BADGE_POLL_MS = 5000; // toolbar memory badge otherwise
const HOME = pathToFileURL(path.join(__dirname, 'ui', 'home.html')).toString();
const ICON = path.join(__dirname, 'build', 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
// Granted silently. Camera and microphone ('media') ask first; everything else is denied.
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const IS_MAC = process.platform === 'darwin';

// ---------------------------------------------------------------- state
let win = null;
let chromeView = null;
let usageView = null;
let usageClosedAt = 0;
const tabs = new Map(); // id -> tab (insertion order = tab order)
let activeId = null;
let nextId = 1;
let userAgent = null;
let uaData = null; // the engine's navigator.userAgentData, for client hint headers
let htmlFullscreen = false;
let blockedTotal = 0;
const closedTabs = []; // URLs for Ctrl+Shift+T
const mediaDecisions = new Map(); // "origin|audio,video" -> boolean, for this session
const externalAllowed = new Set(); // "origin|scheme" pairs allowed to open apps without asking
const blocker = new Blocker();
let updater = null;
let updateState = null; // { status, version, percent } from updater.js

// ---------------------------------------------------------------- tabs
function createTab(url, background = false) {
  const id = nextId++;
  tabs.set(id, {
    id,
    url: url || HOME,
    title: url ? url : 'New tab',
    favicon: null,
    loading: false,
    suspended: false,
    blocked: 0,
    lastActive: Date.now(),
    lastCrash: 0,
    view: null,
  });
  if (background) {
    ensureView(tabs.get(id)); // loads off-screen until you switch to it
    push();
  } else {
    activate(id);
  }
  return id;
}

function tabForWebContentsId(wcId) {
  for (const t of tabs.values()) {
    if (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === wcId) return t;
  }
  return null;
}

function ensureView(tab) {
  if (tab.view) return;
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  tab.view = view;
  tab.suspended = false;
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url, disposition }) => {
    // Real popups (window.open with features) stay popups so sign-in flows keep window.opener.
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          icon: fs.existsSync(ICON) ? ICON : undefined,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
        },
      };
    }
    if (/^https?:/i.test(url)) createTab(url, disposition === 'background-tab');
    else if (isExternal(url)) openExternal(url, wc.getURL());
    return { action: 'deny' };
  });
  wc.on('before-input-event', onInput);
  wc.on('context-menu', (_e, params) => showContextMenu(wc, params, true));
  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    push();
  });
  wc.on('did-navigate', (_e, url) => {
    tab.url = url;
    tab.title = wc.getTitle() || url;
    tab.favicon = null;
    push();
  });
  wc.on('did-navigate-in-page', (_e, url, isMain) => {
    if (isMain) {
      tab.url = url;
      push();
    }
  });
  wc.on('did-start-loading', () => {
    tab.loading = true;
    push();
  });
  wc.on('did-stop-loading', () => {
    tab.loading = false;
    push();
  });
  wc.on('page-favicon-updated', (_e, icons) => {
    tab.favicon = icons[0] || null;
    push();
  });
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      tab.blocked = 0;
      push();
    }
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // -3 is ERR_ABORTED: a new navigation replaced this one, or a download started.
    if (!isMainFrame || code === -3) return;
    tab.url = url;
    tab.loading = false;
    wc.executeJavaScript(errorPageScript(code, desc, url), true).catch(() => {});
    push();
  });
  wc.on('enter-html-full-screen', () => setHtmlFullscreen(true));
  wc.on('leave-html-full-screen', () => setHtmlFullscreen(false));
  wc.on('render-process-gone', (_e, details) => {
    if (tab.view !== view || details.reason === 'clean-exit') return;
    // Free the dead renderer. The active tab reloads once; a repeat crash leaves it asleep.
    const crashedRecently = Date.now() - tab.lastCrash < 10000;
    tab.lastCrash = Date.now();
    destroyView(tab);
    tab.suspended = true;
    tab.loading = false;
    tab.title = 'Crashed: ' + tab.title.replace(/^Crashed: /, '');
    if (tab.id === activeId && !crashedRecently) activate(tab.id);
    else push();
  });

  wc.loadURL(tab.url).catch(() => {});
}

function detach(tab) {
  if (tab.view && win.contentView.children.includes(tab.view)) win.contentView.removeChildView(tab.view);
}

function destroyView(tab) {
  if (!tab.view) return;
  detach(tab);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  tab.view = null;
}

function activate(id) {
  const tab = tabs.get(id);
  if (!tab || !win) return;
  const prev = tabs.get(activeId);
  if (prev && prev !== tab) {
    detach(prev);
    prev.lastActive = Date.now(); // idle time counts from when you left the tab
  }
  if (htmlFullscreen && prev !== tab) setHtmlFullscreen(false);
  activeId = id;
  tab.lastActive = Date.now();
  ensureView(tab);
  win.contentView.addChildView(tab.view);
  if (usageView) win.contentView.addChildView(usageView); // keep the panel on top
  layout();
  if (tab.url === HOME) focusOmnibox();
  else tab.view.webContents.focus();
  push();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const ids = [...tabs.keys()];
  const idx = ids.indexOf(id);
  if (tab.url !== HOME) {
    closedTabs.push(tab.url);
    if (closedTabs.length > 25) closedTabs.shift();
  }
  destroyView(tab);
  tabs.delete(id);
  if (tabs.size === 0) {
    activeId = null;
    createTab();
  } else if (id === activeId) {
    const rest = [...tabs.keys()];
    activeId = null;
    activate(rest[Math.min(idx, rest.length - 1)]);
  } else {
    push();
  }
}

function reopenTab() {
  const url = closedTabs.pop();
  if (url) createTab(url);
}

function suspendTab(tab) {
  if (!tab || tab.id === activeId || !tab.view) return false;
  destroyView(tab);
  tab.suspended = true;
  tab.loading = false;
  return true;
}

// Memory saver: destroy the renderer of tabs that have sat in the background.
function suspendIdleTabs() {
  const now = Date.now();
  let changed = false;
  for (const tab of tabs.values()) {
    if (tab.id === activeId || !tab.view) continue;
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) continue;
    if (wc.isCurrentlyAudible() || tab.loading) continue;
    if (now - tab.lastActive < SUSPEND_AFTER_MS) continue;
    changed = suspendTab(tab) || changed;
  }
  if (changed) push();
}

function cycleTab(delta) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId);
  activate(ids[(i + delta + ids.length) % ids.length]);
}

function activeWC() {
  const t = tabs.get(activeId);
  return t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
}

function go(text) {
  const url = resolveInput(text);
  const tab = tabs.get(activeId);
  if (!url || !tab) return;
  if (isExternal(url)) return openExternal(url, '');
  tab.url = url;
  if (!tab.view) ensureView(tab);
  else tab.view.webContents.loadURL(url).catch(() => {});
  tab.view.webContents.focus();
  push();
}

function reload(hard) {
  const wc = activeWC();
  if (wc) hard ? wc.reloadIgnoringCache() : wc.reload();
}

function zoom(delta) {
  const wc = activeWC();
  if (!wc) return;
  wc.setZoomLevel(delta === 0 ? 0 : Math.max(-4, Math.min(4, wc.getZoomLevel() + delta)));
}

function toggleDevTools() {
  const wc = activeWC();
  if (!wc) return;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools({ mode: 'detach' });
}

function focusOmnibox() {
  if (!chromeView || chromeView.webContents.isDestroyed()) return;
  chromeView.webContents.focus();
  chromeView.webContents.send('focus-omnibox');
}

function setHtmlFullscreen(on) {
  if (htmlFullscreen === on || !win) return;
  htmlFullscreen = on;
  win.setFullScreen(on);
  layout();
}

// Shown inside Chromium's empty error page, so the URL, history and reload stay intact.
const ERRORS = {
  '-105': ["Can't find this site", 'Check the address for typos.'],
  '-106': ["You're offline", 'Check your network connection.'],
  '-102': ['The site refused to connect', 'It may be down, or the address may be wrong.'],
  '-118': ['The site took too long to respond', 'It may be busy. Try again in a moment.'],
  '-109': ["Can't reach this site", 'The address could not be reached.'],
};
function errorPageScript(code, desc, url) {
  const [title, hint] =
    ERRORS[code] ||
    (code <= -200 && code > -300
      ? ["This site's connection isn't secure", 'Its security certificate is not valid.']
      : ["Can't open this page", 'Something went wrong while loading it.']);
  const data = JSON.stringify({ title, hint, url, desc });
  return `(() => {
    const d = ${data};
    document.documentElement.innerHTML = '<head><meta charset="utf-8"><style>' +
      'html,body{height:100%;margin:0;background:#0f1115;color:#e6e8ee;font:15px system-ui,sans-serif}' +
      'body{display:grid;place-items:center}main{max-width:520px;padding:24px}' +
      'h1{margin:0 0 10px;font-size:24px;font-weight:600}p{margin:0 0 8px;color:#8b93a7;overflow-wrap:anywhere}' +
      'code{font-size:12px;color:#5d6578}button{margin-top:16px;padding:9px 20px;border:0;border-radius:18px;' +
      'background:#6ea8ff;color:#0f1115;font:inherit;font-weight:600;cursor:pointer}' +
      '</style></head><body><main><h1></h1><p class="h"></p><p class="u"></p><code></code><br><button>Try again</button></main></body>';
    document.title = d.title;
    document.querySelector('h1').textContent = d.title;
    document.querySelector('.h').textContent = d.hint;
    document.querySelector('.u').textContent = d.url;
    document.querySelector('code').textContent = d.desc;
    document.querySelector('button').onclick = () => location.reload();
  })()`;
}

// ---------------------------------------------------------------- shortcuts / context menu
const actions = {
  newTab: () => createTab(),
  closeTab: () => closeTab(activeId),
  reopenTab,
  focusOmnibox,
  nextTab: () => cycleTab(1),
  prevTab: () => cycleTab(-1),
  back: () => activeWC()?.navigationHistory.goBack(),
  forward: () => activeWC()?.navigationHistory.goForward(),
  reload: () => reload(false),
  hardReload: () => reload(true),
  zoomIn: () => zoom(0.5),
  zoomOut: () => zoom(-0.5),
  zoomReset: () => zoom(0),
  devtools: toggleDevTools,
  usage: () => toggleUsage(),
  quit: () => app.quit(),
};
for (let i = 1; i <= 9; i++) {
  actions['tab' + i] = () => {
    const ids = [...tabs.keys()];
    activate(i === 9 ? ids[ids.length - 1] : ids[i - 1]);
  };
}

function onInput(event, input) {
  const name = matchShortcut(input, IS_MAC);
  if (!name) return;
  event.preventDefault();
  actions[name]();
}

function showContextMenu(wc, params, isPage) {
  const items = [];
  const sep = () => items.length && items[items.length - 1].type !== 'separator' && items.push({ type: 'separator' });
  const link = /^https?:/i.test(params.linkURL) ? params.linkURL : '';
  const src = params.mediaType === 'image' && /^https?:/i.test(params.srcURL) ? params.srcURL : '';
  const sel = params.selectionText.trim();

  if (link) {
    items.push({ label: 'Open Link in New Tab', click: () => createTab(link, true) });
    items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(link) });
    sep();
  }
  if (src) {
    items.push({ label: 'Open Image in New Tab', click: () => createTab(src, true) });
    items.push({ label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) });
    items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(src) });
    sep();
  }
  if (params.isEditable) {
    const f = params.editFlags;
    items.push({ label: 'Undo', role: 'undo', enabled: f.canUndo });
    items.push({ label: 'Redo', role: 'redo', enabled: f.canRedo });
    sep();
    items.push({ label: 'Cut', role: 'cut', enabled: f.canCut });
    items.push({ label: 'Copy', role: 'copy', enabled: f.canCopy });
    items.push({ label: 'Paste', role: 'paste', enabled: f.canPaste });
    items.push({ label: 'Select All', role: 'selectAll' });
    sep();
  } else if (sel) {
    items.push({ label: 'Copy', role: 'copy' });
    const short = sel.length > 30 ? sel.slice(0, 30) + '…' : sel;
    items.push({ label: `Search for “${short}”`, click: () => createTab(SEARCH + encodeURIComponent(sel)) });
    sep();
  }
  if (isPage) {
    if (!link && !src && !sel && !params.isEditable) {
      items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
      items.push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
      items.push({ label: 'Reload', click: () => wc.reload() });
      sep();
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) });
  }
  if (items.length && items[items.length - 1].type === 'separator') items.pop();
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------------------------------------------------------------- UI sync
let pushTimer = null;
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (!chromeView || chromeView.webContents.isDestroyed()) return;
    const wc = activeWC();
    const active = tabs.get(activeId);
    chromeView.webContents.send('state', {
      activeId,
      canGoBack: !!wc && wc.navigationHistory.canGoBack(),
      canGoForward: !!wc && wc.navigationHistory.canGoForward(),
      blocked: active ? active.blocked : 0,
      usageOpen: !!usageView,
      update: updateState,
      tabs: [...tabs.values()].map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url === HOME ? '' : t.url,
        favicon: t.favicon,
        loading: t.loading,
        suspended: t.suspended,
      })),
    });
  }, 30);
}

function layout() {
  if (!win || !chromeView) return;
  // The root view's size, not getContentBounds(): on Wayland the window can report a stale size.
  const { width, height } = win.contentView.getBounds();
  const top = htmlFullscreen ? 0 : CHROME_H;
  chromeView.setVisible(!htmlFullscreen);
  chromeView.setBounds({ x: 0, y: 0, width, height: CHROME_H });
  const tab = tabs.get(activeId);
  if (tab && tab.view) tab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  if (usageView) {
    const w = Math.min(USAGE_W, width - 16);
    usageView.setBounds({ x: width - w - 8, y: CHROME_H - 2, width: w, height: Math.max(120, Math.min(USAGE_H, height - CHROME_H - 8)) });
  }
}

// ---------------------------------------------------------------- usage panel
// On Linux, Electron reports RSS, which counts shared libraries once per process and
// overstates the total about 2x. PSS splits shared pages fairly, so the sum is real.
function withPss(m) {
  if (process.platform !== 'linux') return m;
  try {
    const pss = /^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${m.pid}/smaps_rollup`, 'utf8'));
    if (pss) return { ...m, memory: { ...m.memory, workingSetSize: Number(pss[1]) } };
  } catch {
    /* process just exited */
  }
  return m;
}

function collectUsage() {
  const tabPids = new Map();
  for (const t of tabs.values()) {
    if (!t.view || t.view.webContents.isDestroyed()) continue;
    const pid = t.view.webContents.getOSProcessId();
    if (!tabPids.has(pid)) tabPids.set(pid, []);
    tabPids.get(pid).push(t.id);
  }
  const uiPids = new Set();
  for (const v of [chromeView, usageView]) {
    if (v && !v.webContents.isDestroyed()) uiPids.add(v.webContents.getOSProcessId());
  }
  const s = summarizeMetrics(app.getAppMetrics().map(withPss), tabPids, uiPids);
  const list = [...tabs.values()].map((t) => {
    const u = s.tabs.get(t.id) || { mem: 0, cpu: 0 };
    return {
      id: t.id,
      title: t.title || t.url,
      url: t.url === HOME ? '' : t.url,
      active: t.id === activeId,
      suspended: !t.view,
      blocked: t.blocked,
      mem: u.mem,
      cpu: u.cpu,
    };
  });
  const awake = list.filter((t) => !t.suspended && t.url);
  const avg = awake.length ? awake.reduce((n, t) => n + t.mem, 0) / awake.length : 0;
  const asleep = list.filter((t) => t.suspended).length;
  return {
    mem: s.mem,
    cpu: s.cpu,
    groups: s.groups,
    groupCpu: s.groupCpu,
    tabs: list,
    asleep,
    savedMB: asleep * avg,
    blockedTotal,
    uptime: process.uptime(),
  };
}

let usageTimer = null;
function pollUsage() {
  clearTimeout(usageTimer);
  if (chromeView && !chromeView.webContents.isDestroyed()) {
    const u = collectUsage();
    chromeView.webContents.send('usage-brief', { mem: u.mem, cpu: u.cpu });
    if (usageView && !usageView.webContents.isDestroyed()) usageView.webContents.send('usage', u);
  }
  usageTimer = setTimeout(pollUsage, usageView ? USAGE_POLL_MS : BADGE_POLL_MS);
}

function toggleUsage(open = !usageView) {
  if (!win) return;
  if (!open) {
    if (!usageView) return;
    const v = usageView;
    usageView = null;
    usageClosedAt = Date.now();
    win.contentView.removeChildView(v);
    v.webContents.close();
    activeWC()?.focus();
    push();
    return;
  }
  // Clicking the toolbar button blurs the panel first; don't reopen it on that same click.
  if (usageView || Date.now() - usageClosedAt < 300) return;
  usageView = new WebContentsView({
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  usageView.setBackgroundColor('#171a21');
  usageView.setBorderRadius(10);
  const wc = usageView.webContents;
  wc.on('before-input-event', onInput);
  wc.on('blur', () => toggleUsage(false));
  wc.once('did-finish-load', () => {
    wc.focus();
    pollUsage();
  });
  wc.loadFile(path.join(__dirname, 'ui', 'usage.html'));
  win.contentView.addChildView(usageView);
  layout();
  push();
}

// ---------------------------------------------------------------- privacy
function originOf(u) {
  try {
    const o = new URL(u).origin;
    return o === 'null' ? '' : o; // data:, file: and about: pages have an opaque "null" origin
  } catch {
    return '';
  }
}

async function askMedia(wc, details) {
  const origin = originOf(details.requestingUrl);
  const types = (details.mediaTypes || []).slice().sort();
  const key = origin + '|' + types.join(',');
  if (mediaDecisions.has(key)) return mediaDecisions.get(key);
  const what =
    types.includes('video') && types.includes('audio')
      ? 'camera and microphone'
      : types.includes('video')
        ? 'camera'
        : types.includes('audio')
          ? 'microphone'
          : 'camera or microphone';
  const host = origin ? new URL(origin).host : 'This page';
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Block', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    message: `${host} wants to use your ${what}`,
    detail: 'Your choice is remembered until you quit Nimvane.',
  });
  const allowed = response === 1;
  mediaDecisions.set(key, allowed);
  return allowed;
}

// Schemes the browser shows itself; any other scheme belongs to an app (claude:, mailto:, ...).
const INTERNAL_SCHEMES = /^(https?|file|about|data|blob|chrome|chrome-error|devtools|javascript):/i;
function isExternal(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !INTERNAL_SCHEMES.test(url);
}

// Name of the app that handles a scheme, e.g. "Claude" for claude:. Linux only; falls back to null.
const appNames = new Map();
function appForScheme(scheme) {
  if (process.platform !== 'linux') return null;
  if (appNames.has(scheme)) return appNames.get(scheme);
  let name = null;
  try {
    const desktop = execFileSync('xdg-mime', ['query', 'default', 'x-scheme-handler/' + scheme], { encoding: 'utf8', timeout: 2000 }).trim();
    const dirs = [path.join(app.getPath('home'), '.local/share/applications'), '/usr/local/share/applications', '/usr/share/applications'];
    for (const d of dirs) {
      const f = path.join(d, desktop);
      if (desktop && fs.existsSync(f)) {
        name = (/^Name=(.+)$/m.exec(fs.readFileSync(f, 'utf8')) || [])[1] || null;
        break;
      }
    }
  } catch {
    /* no handler registered */
  }
  appNames.set(scheme, name);
  return name;
}

async function askExternal(url, requestingUrl) {
  if (!url || !win) return false;
  const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
  const origin = originOf(requestingUrl);
  const key = origin + '|' + scheme;
  if (externalAllowed.has(key)) return true;
  const appName = appForScheme(scheme);
  const host = origin ? new URL(origin).host : '';
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Cancel', appName ? `Open ${appName}` : 'Open app'],
    defaultId: 1,
    cancelId: 0,
    message: appName ? `Open ${appName}?` : `Open this ${scheme}: link in another app?`,
    detail: (host ? `${host} wants to open ` : 'Opening ') + (url.length > 120 ? url.slice(0, 120) + '…' : url),
    checkboxLabel: host ? `Always allow ${host} to open ${scheme}: links` : undefined,
  });
  const allowed = response === 1;
  if (allowed && checkboxChecked && host) externalAllowed.add(key);
  return allowed;
}

// For app links that don't come through a page's navigation (address bar, window.open).
async function openExternal(url, requestingUrl) {
  if (await askExternal(url, requestingUrl)) shell.openExternal(url).catch(() => {});
}

function setupSession(ses) {
  blocker.loadFile(path.join(__dirname, 'blocklist.txt'));
  blocker.loadFile(path.join(app.getPath('userData'), 'blocklist.txt'));

  userAgent = cleanUserAgent(ses.getUserAgent());
  app.userAgentFallback = userAgent;
  ses.setUserAgent(userAgent);

  const filter = { urls: ['http://*/*', 'https://*/*'] };

  ses.webRequest.onBeforeRequest(filter, (details, cb) => {
    if (details.resourceType === 'mainFrame') {
      const clean = details.method === 'GET' ? stripTracking(details.url) : null;
      return cb(clean ? { redirectURL: clean } : {});
    }
    if (blocker.isBlockedUrl(details.url)) {
      blockedTotal++;
      const tab = tabForWebContentsId(details.webContentsId);
      if (tab) {
        tab.blocked++;
        if (tab.id === activeId) push();
      }
      return cb({ cancel: true });
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    details.requestHeaders['DNT'] = '1';
    details.requestHeaders['Sec-GPC'] = '1';
    // Chromium sends client hints only to secure origins.
    if (uaData && details.url.startsWith('https:')) {
      const present = new Set(Object.keys(details.requestHeaders).map((k) => k.toLowerCase()));
      for (const [k, v] of Object.entries(clientHintHeaders(uaData, wantsDetailedHints(details.url)))) {
        if (!present.has(k.toLowerCase())) details.requestHeaders[k] = v;
      }
    }
    cb({ requestHeaders: details.requestHeaders });
  });

  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (ALLOWED_PERMISSIONS.has(permission)) return cb(true);
    if (permission === 'media') return askMedia(wc, details).then(cb, () => cb(false));
    // Links like claude:// or mailto: that hand off to another app. Electron opens the app if we say yes.
    if (permission === 'openExternal') return askExternal(details.externalURL, details.requestingUrl).then(cb, () => cb(false));
    cb(false);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (ALLOWED_PERMISSIONS.has(permission)) return true;
    if (permission !== 'media') return false;
    for (const [key, allowed] of mediaDecisions) if (allowed && key.startsWith(requestingOrigin + '|')) return true;
    return false;
  });
}

// ---------------------------------------------------------------- IPC
ipcMain.on('tab:new', () => createTab());
ipcMain.on('tab:close', (_e, id) => closeTab(id));
ipcMain.on('tab:activate', (_e, id) => activate(id));
ipcMain.on('tab:suspend', (_e, id) => suspendTab(tabs.get(id)) && push());
ipcMain.on('tab:suspend-all', () => {
  let changed = false;
  for (const t of tabs.values()) changed = suspendTab(t) || changed;
  if (changed) push();
  pollUsage();
});
ipcMain.on('nav:go', (_e, text) => go(text));
ipcMain.on('nav:back', () => activeWC()?.navigationHistory.goBack());
ipcMain.on('nav:forward', () => activeWC()?.navigationHistory.goForward());
ipcMain.on('nav:reload', () => {
  const wc = activeWC();
  if (wc) wc.isLoading() ? wc.stop() : wc.reload();
});
ipcMain.on('nav:focus-page', () => activeWC()?.focus());
ipcMain.on('usage:toggle', (_e, open) => toggleUsage(open));
ipcMain.on('update:install', () => updater?.install());

// ---------------------------------------------------------------- boot
// URLs passed on the command line, e.g. when Nimvane is the default browser.
// The engine reports its real identity to pages; send the same values as request headers.
function readUaData(wc) {
  return wc
    .executeJavaScript(
      `(async () => {
        const d = navigator.userAgentData;
        const h = await d.getHighEntropyValues(['architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'wow64']);
        return { brands: d.brands, mobile: d.mobile, platform: d.platform, ...h };
      })()`
    )
    .catch(() => null);
}

function launchUrls(argv) {
  const urls = [];
  for (const a of argv.slice(1)) {
    if (/^(https?|file):\/\//i.test(a)) urls.push(a);
    // Opening an .html file passes a plain path (C:\page.html on Windows)
    else if (/\.html?$/i.test(a) && fs.existsSync(a)) urls.push(pathToFileURL(path.resolve(a)).toString());
  }
  return urls;
}

function buildMenu() {
  // Shortcuts are handled in onInput. macOS still needs a menu for Cmd+C/V and the app menu.
  if (!IS_MAC) return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    for (const u of launchUrls(argv)) createTab(u);
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    setupSession(session.defaultSession);
    buildMenu();

    win = new BaseWindow({
      width: 1280,
      height: 840,
      minWidth: 480,
      minHeight: 320,
      backgroundColor: '#0f1115',
      title: 'Nimvane',
      icon: fs.existsSync(ICON) ? ICON : undefined,
    });
    chromeView = new WebContentsView({
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    chromeView.webContents.on('before-input-event', onInput);
    chromeView.webContents.on('context-menu', (_e, params) => showContextMenu(chromeView.webContents, params, false));
    win.contentView.addChildView(chromeView);
    chromeView.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
    chromeView.webContents.once('did-finish-load', async () => {
      uaData = await readUaData(chromeView.webContents);
      const urls = launchUrls(process.argv);
      if (urls.length) urls.forEach((u) => createTab(u));
      else createTab();
      pollUsage();
    });

    // The root view resizes however the window changed size (window manager maximize, tiling,
    // snapping). Window resize events alone miss some of those on Wayland.
    win.contentView.on('bounds-changed', layout);
    for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen']) win.on(ev, layout);
    win.on('leave-full-screen', () => {
      // Window left fullscreen some other way (window manager, F11): drop the page out of it too.
      if (htmlFullscreen) activeWC()?.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
      htmlFullscreen = false;
      layout();
    });
    win.on('closed', () => app.quit());
    setInterval(suspendIdleTabs, SUSPEND_CHECK_MS);
    updater = startUpdater((s) => {
      updateState = s;
      push();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
