const api = window.browserAPI;
const $ = (id) => document.getElementById(id);

const GROUPS = [
  ['tabs', 'Tabs'],
  ['frames', 'Embedded frames'],
  ['browser', 'Browser core'],
  ['gpu', 'GPU'],
  ['utility', 'Network & services'],
  ['ui', 'Nimvane UI'],
];
const HEAVY_MB = 400; // a tab above this gets flagged
const HOT_CPU = 25; // background tab above this % CPU gets flagged

function fmtMem(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function short(s, n = 40) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function render(u) {
  $('mem').textContent = fmtMem(u.mem);
  $('cpu').textContent = Math.round(u.cpu) + '% CPU';

  // Breakdown bar + legend
  const groups = { ...u.groups, tabs: u.tabs.reduce((n, t) => n + t.mem, 0) };
  const bar = $('bar');
  const legend = $('legend');
  bar.textContent = '';
  legend.textContent = '';
  for (const [key, label] of GROUPS) {
    const mb = groups[key] || 0;
    if (mb < 1) continue;
    const s = el('span');
    s.style.flexGrow = mb;
    s.style.background = `var(--c-${key})`;
    s.title = `${label}: ${fmtMem(mb)}`;
    bar.appendChild(s);
    const d = el('div');
    const sw = el('i');
    sw.style.background = `var(--c-${key})`;
    d.append(sw, el('span', null, label), el('span', 'n', fmtMem(mb)));
    legend.appendChild(d);
  }

  // Tabs, heaviest first; sleeping tabs last
  const list = $('tabs');
  list.textContent = '';
  const sorted = [...u.tabs].sort((a, b) => a.suspended - b.suspended || b.mem - a.mem);
  for (const t of sorted) {
    const r = el('div', 'row' + (t.active ? ' active' : '') + (t.suspended ? ' asleep' : ''));
    r.title = t.url || t.title;
    r.append(el('span', 't', t.title || 'New tab'));
    if (t.suspended) {
      r.append(el('span', 'm', '—'), el('span', 'c', ''), el('span', 'tag', 'asleep'));
    } else {
      r.append(
        el('span', 'm' + (t.mem > HEAVY_MB ? ' heavy' : ''), fmtMem(t.mem)),
        el('span', 'c' + (t.cpu > HOT_CPU ? ' hot' : ''), Math.round(t.cpu) + '%')
      );
      if (t.active) {
        r.append(el('span', 'tag', 'current'));
      } else {
        const b = el('button', null, 'Sleep');
        b.title = 'Free this tab’s memory. It reloads when you open it.';
        b.onclick = (e) => {
          e.stopPropagation();
          api.suspend(t.id);
        };
        r.append(b);
      }
    }
    r.onclick = () => api.activate(t.id);
    list.appendChild(r);
  }

  // Tips: what's actually costing memory or CPU right now
  const tips = [];
  const awakeBg = u.tabs.filter((t) => !t.active && !t.suspended);
  for (const t of u.tabs) {
    if (!t.suspended && t.mem > HEAVY_MB)
      tips.push(['warn', `“${short(t.title)}” uses ${fmtMem(t.mem)}.${t.active ? '' : ' Sleep it if you’re not using it.'}`]);
    if (!t.suspended && !t.active && t.cpu > HOT_CPU)
      tips.push(['warn', `“${short(t.title)}” is busy in the background (${Math.round(t.cpu)}% CPU).`]);
  }
  if (awakeBg.length >= 3) {
    const mb = awakeBg.reduce((n, t) => n + t.mem, 0);
    tips.push(['', `${awakeBg.length} background tabs are awake. Sleeping them frees about ${fmtMem(mb)}.`]);
  }
  if (groups.frames > 150)
    tips.push(['', `Embedded frames (videos, ads, widgets) use ${fmtMem(groups.frames)}. A bigger blocklist trims this.`]);
  if (groups.gpu > 400) tips.push(['', `The GPU process holds ${fmtMem(groups.gpu)}, mostly from video and graphics-heavy pages.`]);
  if (!tips.length) tips.push(['', 'Looking lean. Nothing to trim right now.']);
  const ul = $('tips');
  ul.textContent = '';
  for (const [cls, text] of tips) ul.appendChild(el('li', cls, text));

  // Footer
  const mins = Math.floor(u.uptime / 60);
  const parts = [`${u.blockedTotal.toLocaleString()} requests blocked`];
  if (u.asleep) parts.unshift(`${u.asleep} asleep, ≈${fmtMem(u.savedMB)} saved`);
  parts.push(mins >= 60 ? `up ${Math.floor(mins / 60)}h ${mins % 60}m` : `up ${mins}m`);
  $('stats').textContent = parts.join(' · ');
  $('sleepAll').disabled = awakeBg.length === 0;
}

$('close').onclick = () => api.toggleUsage(false);
$('sleepAll').onclick = () => api.suspendAll();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.toggleUsage(false);
});
api.onUsage(render);
