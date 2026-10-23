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
const document = { addEventListener() {} };
const sandbox = { ...helpers, console, Date, Math, Number, String, Object, Array, JSON, document };
vm.runInNewContext(`${source}\nglobalThis.__test = { viewAdmin, viewModerationInbox };`, sandbox, { filename: 'sec.js' });
const { viewAdmin, viewModerationInbox } = sandbox.__test;
const now = Date.now();
const channels = {
  ch1: { id: 'ch1', name: 'PIXEL Studio', handle: '@pixelstudio', ownerUid: 'owner-1', ownerUsername: 'creator1', verified: true, publishingMode: 'REVIEW', createdAt: now - 10000,
    moderationInbox: { t1: { id: 't1', subject: 'Policy warning', reason: 'Please review policy', type: 'user-appeal', closed: false, createdAt: now - 5000, updatedAt: now - 1000, messages: { m1: { senderName: 'admin14', senderRole: 'admin', text: 'Please review policy', ts: now - 5000 } } } } }
};
const videos = {
  v1: { id: 'v1', title: 'AI Racing Video', channelId: 'ch1', kind: 'long', views: 22, likes: 5, dislikes: 0, createdAt: now - 3000, createdBy: 'owner-1', reviewStatus: 'pending', reviewSubmittedAt: now - 2500, moderationTags: ['AI', '#over10yrs'], desc: 'A test description' },
  v2: { id: 'v2', title: 'Unsafe stunt', channelId: 'ch1', kind: 'mini', views: 8, likes: 1, dislikes: 0, createdAt: now - 2000, createdBy: 'owner-1', moderationTags: ['unsafe'] }
};
const reports = {
  r1: { id: 'r1', videoId: 'v1', reporterUid: 'reporter-uid', reporterUsername: 'reporter', category: 'unsafe', note: 'Needs review', ts: now - 1500, status: 'pending' },
  r2: { id: 'r2', videoId: 'v2', reporterUid: 'reporter-uid-2', reporterUsername: 'reporter2', category: 'spam', note: 'Resolved sample', ts: now - 5000, status: 'resolved', moderationNote: 'Reviewed' }
};
const state = { channels, videos, reports, audit: { a1: { action: 'video-flagged', targetType: 'video', targetId: 'v2', admin: 'admin14', ts: now - 500 } }, subs: {}, mode: 'local' };
const ctx = {
  PIXLECT: { user: { uid: 'admin-uid', username: 'admin14' } }, state,
  isAdmin: () => true,
  emptyState: (_icon, title) => `<div>${title}</div>`,
  chanOf: id => channels[videos[id]?.channelId] || null,
  subsOf: () => 0,
  videosSorted: () => Object.values(videos),
  localDB: { channels, videos, reports, audit: state.audit }
};

const dashboard = viewAdmin(ctx, 'dashboard');
assert.match(dashboard, /Admin Dashboard/);
assert.match(dashboard, /Suspended channels/);
assert.match(dashboard, /Recent admin activity/);

const reportHtml = viewAdmin(ctx, '');
for (const token of ['Reports Center', 'data-report-filter-status', 'data-report-filter-category', 'data-report-filter-creator', 'data-report-filter-from', 'data-report-filter-to', 'reporter-uid', 'Full report details', 'admin-report-under-review', 'Manage channel', 'Resolve', 'Dismiss']) assert.ok(reportHtml.includes(token), `report center includes ${token}`);

const channelHtml = viewAdmin(ctx, 'channel', 'ch1');
for (const token of ['Channel administration', 'QVids publishing control', 'Turn QVids OFF', 'admin-channel-warn', 'admin-channel-email', 'admin-verify-channel', 'admin-qvids-toggle', 'admin-suspend', 'admin-channel-delete', 'Admin inbox / conversations', 'admin-warn-video', 'admin-flag-video']) assert.ok(channelHtml.includes(token), `channel editor includes ${token}`);

const videoHtml = viewAdmin(ctx, 'video', 'v1');
for (const token of ['Video inspection', 'AI', '#over10yrs', 'admin-video-toggle-restrict', 'admin-rename-video', 'admin-warn-video', 'admin-review-approve', 'Reports for this video']) assert.ok(videoHtml.includes(token), `video inspection includes ${token}`);

const qvidsHtml = viewAdmin(ctx, 'qvids');
for (const token of ['QVids Approval Queue', 'Approval inbox', 'Find a channel', 'admin-review-approve', 'admin-review-ignore', 'admin-review-disapprove']) assert.ok(qvidsHtml.includes(token), `QVids includes ${token}`);

const searchHtml = viewAdmin(ctx, 'search');
for (const token of ['data-admin-search-input', 'data-admin-search-kind', 'data-admin-search-status', 'data-admin-search-flagged', '#/admin/channel/ch1', '#/admin/video/v1']) assert.ok(searchHtml.includes(token), `advanced search includes ${token}`);

const videosHtml = viewAdmin(ctx, 'videos');
for (const token of ['data-admin-select-all', 'data-admin-video-select', 'admin-bulk-flag', 'admin-bulk-hide', 'admin-bulk-restore', 'admin-bulk-approve', 'admin-bulk-ignore', 'admin-bulk-disapprove', 'admin-bulk-delete', 'admin-flag-video', 'admin-rename-video']) assert.ok(videosHtml.includes(token), `bulk moderation includes ${token}`);

const inboxHtml = viewModerationInbox({ ...ctx, PIXLECT: { user: { uid: 'owner-1', username: 'creator1' } }, emptyState: ctx.emptyState });
assert.match(inboxHtml, /Messages from Admin/);
assert.match(inboxHtml, /Reply to admin/);
assert.doesNotMatch(inboxHtml, /Start a new conversation|Send new message|Appeal a moderation decision|Reopen conversation/);
assert.doesNotMatch(inboxHtml, /user-message/);
const appealsHtml = viewAdmin(ctx, 'appeals');
assert.match(appealsHtml, /Appeals/);
assert.match(appealsHtml, /Channel editor/);

const nonAdmin = viewAdmin({ ...ctx, isAdmin: () => false }, 'dashboard');
assert.match(nonAdmin, /Admins only/);
const mainSource = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
for (const action of ['admin-report-under-review', 'admin-resolve', 'admin-dismiss', 'admin-video-toggle-restrict', 'admin-bulk-hide', 'admin-bulk-restore', 'admin-bulk-approve', 'admin-bulk-ignore', 'admin-bulk-disapprove', 'inbox-reopen']) assert.ok(mainSource.includes(action), `action handler exists: ${action}`);
assert.match(mainSource, /v\.moderation\?\.hidden \|\| v\.moderation\?\.restricted/, 'public video lists filter hidden/restricted videos');
assert.match(mainSource, /Only PIXELTube Admin can start an admin inbox conversation/);
assert.match(mainSource, /You can only reply to conversations started by PIXELTube Admin/);
assert.match(source, /const matches = !!query && haystack\.includes\(query\)/, 'channel and video results remain hidden until the user searches');
assert.match(source, /Video review: \${status}/, 'review decision notification thread is generated');
console.log('PASS: V3.2.0 dashboard, reports filters/details, channel editor, video inspection, QVids, appeals, advanced search, checkbox bulk actions, inbox/reopen, restriction gates, review notifications, and admin gate simulations');
