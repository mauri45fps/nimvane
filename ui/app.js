const api = window.browserAPI;
const tabsEl = document.getElementById('tabs');
const omnibox = document.getElementById('omnibox');
const backBtn = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn = document.getElementById('reload');
const shield = document.getElementById('shield');
const usageBtn = document.getElementById('usage');
const updateBtn = document.getElementById('update');

let lastActive = null;
let activeUrl = '';
const tabEls = new Map(); // tab id -> { el, slot, slotKey, title }

// Tabs are updated in place, not rebuilt: rebuilding on every state push swallowed
// clicks (the close button's mousedown and mouseup landed on different elements).
const plus = document.createElement('button');
plus.id = 'newtab';
plus.textContent = '+';
plus.title = 'New tab (Ctrl+T)';
plus.onclick = () => api.newTab();
tabsEl.appendChild(plus);

function makeTab(id) {
  const el = document.createElement('div');
  const title = document.createElement('span');
  title.className = 'title';
  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = '×';
  x.title = 'Close tab (Ctrl+W)';
  x.onmousedown = (e) => e.stopPropagation();
  x.onclick = (e) => {
    e.stopPropagation();
    api.closeTab(id);
  };
  el.append(title, x);
  el.onmousedown = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      api.closeTab(id);
    } else if (e.button === 0) {
      api.activate(id);
    }
  };
  tabsEl.insertBefore(el, plus);
  return { el, slot: null, slotKey: '', title };
}

function setSlot(r, t) {
  const key = t.loading ? 'spin' : t.favicon ? 'img:' + t.favicon : '';
  if (key === r.slotKey) return;
  if (r.slot) r.slot.remove();
  r.slot = null;
  r.slotKey = key;
  if (t.loading) {
    r.slot = document.createElement('div');
    r.slot.className = 'spin';
  } else if (t.favicon) {
    const i = document.createElement('img');
    i.className = 'icon';
    i.src = t.favicon;
    i.onerror = () => i.remove();
    r.slot = i;
  }
  if (r.slot) r.el.insertBefore(r.slot, r.title);
}

function omniboxFocused() {
  return document.hasFocus() && document.activeElement === omnibox;
}

function render(state) {
  const seen = new Set();
  for (const t of state.tabs) {
    seen.add(t.id);
    let r = tabEls.get(t.id);
    if (!r) tabEls.set(t.id, (r = makeTab(t.id)));
    r.el.className = 'tab' + (t.id === state.activeId ? ' active' : '') + (t.suspended ? ' suspended' : '');
    r.el.title = t.suspended ? `${t.title} (asleep, click to wake)` : t.title;
    r.title.textContent = t.title || t.url || 'New tab';
    setSlot(r, t);
  }
  for (const [id, r] of tabEls) {
    if (!seen.has(id)) {
      r.el.remove();
      tabEls.delete(id);
    }
  }
  tabEls.get(state.activeId)?.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const active = state.tabs.find((t) => t.id === state.activeId);
  activeUrl = active ? active.url : '';
  if (active && (state.activeId !== lastActive || !omniboxFocused())) omnibox.value = activeUrl;
  lastActive = state.activeId;

  backBtn.disabled = !state.canGoBack;
  forwardBtn.disabled = !state.canGoForward;
  reloadBtn.textContent = active && active.loading ? '✕' : '↻';
  reloadBtn.title = active && active.loading ? 'Stop' : 'Reload (Ctrl+R)';
  shield.textContent = state.blocked;
  shield.className = state.blocked ? '' : 'zero';
  usageBtn.classList.toggle('open', state.usageOpen);

  const ready = state.update && state.update.status === 'ready';
  updateBtn.hidden = !ready;
  if (ready) updateBtn.title = `Nimvane ${state.update.version} is downloaded. Restart to install it.`;
}

omnibox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    api.navigate(omnibox.value);
  } else if (e.key === 'Escape') {
    omnibox.value = activeUrl;
    api.focusPage();
  }
});
omnibox.addEventListener('focus', () => omnibox.select());

backBtn.onclick = () => api.back();
forwardBtn.onclick = () => api.forward();
reloadBtn.onclick = () => api.reload();
usageBtn.onclick = () => api.toggleUsage();
updateBtn.onclick = () => api.installUpdate();

function fmtMem(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
}

api.onState(render);
api.onUsageBrief((u) => {
  usageBtn.textContent = fmtMem(u.mem);
  usageBtn.title = `Nimvane is using ${fmtMem(u.mem)} of memory and ${Math.round(u.cpu)}% CPU. Click for details (Shift+Esc).`;
});
api.onFocusOmnibox(() => {
  omnibox.focus();
  omnibox.select();
});
