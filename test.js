const assert = require('assert');
const { resolveInput, stripTracking, matchShortcut, summarizeMetrics, isGoogleSignIn, firefoxUserAgent } = require('./util');
const { Blocker } = require('./blocker');

assert.strictEqual(resolveInput('example.com'), 'https://example.com');
assert.strictEqual(resolveInput('https://a.b/c'), 'https://a.b/c');
assert.strictEqual(resolveInput('localhost:3000'), 'http://localhost:3000');
assert.strictEqual(resolveInput('192.168.1.1:8080/x'), 'http://192.168.1.1:8080/x');
assert.strictEqual(resolveInput('hello world'), 'https://duckduckgo.com/?q=hello%20world');
assert.strictEqual(resolveInput('javascript:alert(1)'), null);
assert.strictEqual(resolveInput('   '), null);

assert.strictEqual(stripTracking('https://x.com/?a=1&utm_source=z&fbclid=q'), 'https://x.com/?a=1');
assert.strictEqual(stripTracking('https://x.com/?a=1'), null);

const b = new Blocker();
b.loadText('# c\n0.0.0.0 ads.example.com\ntracker.net\nlocalhost\n');
assert.ok(b.isBlockedUrl('https://ads.example.com/x.js'));
assert.ok(b.isBlockedUrl('https://cdn.sub.tracker.net/p.gif'));
assert.ok(!b.isBlockedUrl('https://example.com/'));
assert.ok(!b.isBlockedUrl('https://nottracker.net/'));

const k = (key, mods = {}) => ({ type: 'keyDown', key, control: false, meta: false, shift: false, alt: false, ...mods });
assert.strictEqual(matchShortcut(k('t', { control: true }), false), 'newTab');
assert.strictEqual(matchShortcut(k('T', { control: true, shift: true }), false), 'reopenTab');
assert.strictEqual(matchShortcut(k('=', { control: true }), false), 'zoomIn');
assert.strictEqual(matchShortcut(k('+', { control: true, shift: true }), false), 'zoomIn');
assert.strictEqual(matchShortcut(k('R', { control: true, shift: true }), false), 'hardReload');
assert.strictEqual(matchShortcut(k('Tab', { control: true, shift: true }), false), 'prevTab');
assert.strictEqual(matchShortcut(k('ArrowLeft', { alt: true }), false), 'back');
assert.strictEqual(matchShortcut(k('Escape', { shift: true }), false), 'usage');
assert.strictEqual(matchShortcut(k('3', { control: true }), false), 'tab3');
assert.strictEqual(matchShortcut(k('t', { meta: true }), true), 'newTab');
assert.strictEqual(matchShortcut(k('t', { meta: true }), false), null);
assert.strictEqual(matchShortcut(k('t'), false), null);
assert.strictEqual(matchShortcut(k('c', { control: true }), false), null);
assert.strictEqual(matchShortcut({ ...k('t', { control: true }), type: 'keyUp' }, false), null);

const metrics = [
  { pid: 1, type: 'Browser', cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 102400 } },
  { pid: 2, type: 'GPU', cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 51200 } },
  { pid: 3, type: 'Tab', cpu: { percentCPUUsage: 10 }, memory: { workingSetSize: 204800 } },
  { pid: 4, type: 'Tab', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 20480 } },
  { pid: 5, type: 'Tab', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 30720 } },
];
const sum = summarizeMetrics(metrics, new Map([[3, [7, 8]]]), new Set([4]));
assert.strictEqual(Math.round(sum.mem), 400);
assert.strictEqual(sum.cpu, 13);
assert.deepStrictEqual(sum.tabs.get(7), { mem: 100, cpu: 5 });
assert.strictEqual(sum.groups.browser, 100);
assert.strictEqual(sum.groups.gpu, 50);
assert.strictEqual(sum.groups.ui, 20);
assert.strictEqual(sum.groups.frames, 30);

assert.ok(isGoogleSignIn('https://accounts.google.com/v3/signin/identifier?x=1'));
assert.ok(isGoogleSignIn('https://accounts.youtube.com/accounts/SetSID'));
assert.ok(!isGoogleSignIn('https://www.google.com/search?q=accounts.google.com'));
assert.ok(!isGoogleSignIn('https://accounts.google.com.evil.example/'));
assert.strictEqual(firefoxUserAgent('linux', Date.UTC(2024, 10, 26)), 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0');
assert.match(firefoxUserAgent('win32'), /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64; rv:\d+\.0\) Gecko\/20100101 Firefox\/\d+\.0$/);

console.log('all tests passed');
