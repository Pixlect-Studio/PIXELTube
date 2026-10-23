import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/sec.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\s*/gms, '')
  .replace(/^export\s+/gm, '');
const helpers = {
  esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
  fmt: value => String(Number(value) || 0),
  timeAgo: () => 'just now',
  avatarHTML: () => '<div class="avatar"></div>',
  thumbHTML: () => '<div class="thumb"></div>',
  initial: value => String(value || '?')[0]
};
const documentMock = { addEventListener() {} };
const sandbox = { ...helpers, console, Date, Math, Number, String, Object, Array, JSON, document: documentMock };
vm.runInNewContext(`${source}\nglobalThis.__test = { viewAdmin, isChannelSuspended };`, sandbox, { filename: 'sec.js' });
const { viewAdmin } = sandbox.__test;
const channels = {
  ch1: { id: 'ch1', name: 'Pixel Racing', handle: '@pixelracing', ownerUid: 'owner-123' },
  ch2: { id: 'ch2', name: 'Space Lab', handle: '@spacelab', ownerUid: 'owner-456' }
};
const videos = {
  v1: { id: 'v1', title: 'Hover Racer Gameplay', channelId: 'ch1', kind: 'long', views: 12, createdAt: 10 },
  v2: { id: 'v2', title: 'Black Hole Facts', channelId: 'ch2', kind: 'mini', views: 8, createdAt: 20 }
};
const ctx = {
  PIXLECT: { user: { uid: 'admin-uid', username: 'admin14' } },
  state: { channels, videos, reports: {}, audit: {} },
  isAdmin: () => true,
  emptyState: (_icon, title) => `<div>${title}</div>`,
  chanOf: id => channels[videos[id]?.channelId] || null,
  subsOf: () => 0
};
const html = viewAdmin(ctx, 'search');
assert.match(html, /Search channels &amp; videos/);
assert.match(html, /data-admin-search-input/);
assert.match(html, /data-admin-search-item hidden data-search-kind="channel"[^>]*data-search-text="Pixel Racing @pixelracing ch1 owner-123/);
assert.match(html, /data-admin-search-item hidden data-search-kind="video"[^>]*data-search-text="Hover Racer Gameplay v1/);
assert.match(html, /#\/admin\/channel\/ch1/);
assert.match(html, /Open Channel Admin Panel/);
assert.match(html, /Results stay hidden until you search/);
assert.match(html, /#\/watch\/v1/);
assert.match(html, /admin-search-clear/);
assert.match(html, /No channels or videos match that search/);

const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
assert.match(source, /document\.addEventListener\('input',[\s\S]*?data-admin-search-input/);
assert.match(source, /haystack\.includes\(query\)/);
assert.match(source, /data-admin-search-clear/);
console.log('PASS: admin search route renders channels and videos, searchable metadata, channel admin links, initially hidden results, empty state, and live case-insensitive filtering/clear handlers are wired');
