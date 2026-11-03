// Pure helpers (no Electron imports) so they can be unit-tested with plain Node.

const SEARCH = 'https://duckduckgo.com/?q=';

// Turn whatever was typed in the address bar into a URL.
function resolveInput(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (/^javascript:/i.test(t)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?([/?#]|$)/i.test(t)) return 'http://' + t;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(t)) return 'http://' + t;
  if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(t)) return 'https://' + t;
  return SEARCH + encodeURIComponent(t);
}

const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_eid|igshid|yclid|_hsenc|_hsmi)$/i;

// Returns a cleaned URL if tracking params were removed, otherwise null.
function stripTracking(u) {
  try {
    const url = new URL(u);
    let changed = false;
    for (const k of [...url.searchParams.keys()]) {
      if (TRACKING.test(k)) {
        url.searchParams.delete(k);
        changed = true;
      }
    }
    return changed ? url.toString() : null;
  } catch {
    return null;
  }
}

// Map a keyDown (Electron's before-input-event `input`) to an action name.
// Handled here instead of menu accelerators, which don't fire reliably on Linux
// with a hidden menu bar and never match Ctrl+= for zoom in.
function matchShortcut(input, isMac) {
  if (input.type !== 'keyDown') return null;
  const key = (input.key || '').toLowerCase();
  const mod = isMac ? input.meta : input.control;
  const { shift, alt } = input;

  if (key === 'f12' || (mod && shift && key === 'i')) return 'devtools';
  if (key === 'f5') return input.control || shift ? 'hardReload' : 'reload';
  if (key === 'f6' || (alt && !mod && key === 'd')) return 'focusOmnibox';
  if (shift && !mod && !alt && key === 'escape') return 'usage';
  if (alt && !mod && key === 'arrowleft') return 'back';
  if (alt && !mod && key === 'arrowright') return 'forward';
  if (input.control && key === 'tab') return shift ? 'prevTab' : 'nextTab';
  if (input.control && key === 'pagedown') return 'nextTab';
  if (input.control && key === 'pageup') return 'prevTab';
  if (!mod || alt) return null;
  if (/^[1-9]$/.test(key) && !shift) return 'tab' + key;
  switch (key) {
    case 't': return shift ? 'reopenTab' : 'newTab';
    case 'w': return 'closeTab';
    case 'l': return 'focusOmnibox';
    case 'r': return shift ? 'hardReload' : 'reload';
    case '=': case '+': return 'zoomIn';
    case '-': case '_': return 'zoomOut';
    case '0': return 'zoomReset';
    case 'q': return 'quit';
  }
  return null;
}

// Group raw app.getAppMetrics() output for the usage panel.
// tabPids: Map(pid -> [tabId, ...]); uiPids: Set of pids for the browser's own UI.
// Memory is reported in MB, CPU in percent of one core.
function summarizeMetrics(metrics, tabPids, uiPids) {
  const tabs = new Map(); // tabId -> { mem, cpu }
  const groups = { browser: 0, gpu: 0, ui: 0, frames: 0, utility: 0 };
  const groupCpu = { browser: 0, gpu: 0, ui: 0, frames: 0, utility: 0 };
  let mem = 0;
  let cpu = 0;
  for (const m of metrics) {
    const mb = (m.memory && m.memory.workingSetSize ? m.memory.workingSetSize : 0) / 1024;
    const c = (m.cpu && m.cpu.percentCPUUsage) || 0;
    mem += mb;
    cpu += c;
    const owners = tabPids.get(m.pid);
    if (owners && owners.length) {
      // Tabs sharing a renderer process split its cost evenly.
      for (const id of owners) tabs.set(id, { mem: mb / owners.length, cpu: c / owners.length });
      continue;
    }
    let g = 'utility';
    if (uiPids.has(m.pid)) g = 'ui';
    else if (m.type === 'Browser') g = 'browser';
    else if (m.type === 'GPU') g = 'gpu';
    else if (m.type === 'Tab') g = 'frames'; // out-of-process iframes and workers
    groups[g] += mb;
    groupCpu[g] += c;
  }
  return { mem, cpu, tabs, groups, groupCpu };
}

// Google refuses sign-in from Chromium-based "embedded" browsers like Electron apps.
// On its sign-in pages only, Nimvane presents itself as Firefox, which Google accepts.
function isGoogleSignIn(u) {
  try {
    return /^accounts\.(google|youtube)\.com$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

// A current-looking Firefox user agent. Firefox ships every 4 weeks and 115 came out on
// 2023-07-04; staying one release behind the estimate keeps it a version that really exists.
function firefoxUserAgent(platform = process.platform, now = Date.now()) {
  const v = 115 + Math.floor((now - Date.UTC(2023, 6, 4)) / (28 * 864e5)) - 1;
  const os =
    platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
}

module.exports = { resolveInput, stripTracking, matchShortcut, summarizeMetrics, isGoogleSignIn, firefoxUserAgent, SEARCH };
