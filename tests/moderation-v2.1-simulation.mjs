import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/sec.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\s*/ms, '')
  .replace(/export async function /g, 'async function ')
  .replace(/export function /g, 'function ');
const wrapped = `${source}\nglobalThis.__test = { setPublishingMode, reviewVideo, writeModerationAudit };`;
const documentMock = { addEventListener() {} };
const sandbox = { console, Date, Number, String, Math, Object, Array, JSON, document: documentMock };
vm.runInNewContext(wrapped, sandbox, { filename: 'sec.js' });
const api = sandbox.__test;
const notices = [];
const ctx = {
  PIXLECT: { user: { uid: 'admin-uid', username: 'admin14' } },
  state: { mode: 'local', channels: { c1: { id: 'c1', name: 'Test', ownerUid: 'owner1' } }, videos: { v1: { id: 'v1', title: 'Pending', channelId: 'c1', reviewStatus: 'pending' } }, audit: {} },
  localDB: { channels: { c1: { id: 'c1', name: 'Test', ownerUid: 'owner1' } }, videos: { v1: { id: 'v1', title: 'Pending', channelId: 'c1', reviewStatus: 'pending' } }, audit: {} },
  isAdmin: () => true, toast: m => notices.push(m), persistLocal() {}, applyData(d) { this.state.channels = d.channels; this.state.videos = d.videos; this.state.audit = d.audit || {}; },
  ref: (_db, path) => path, push: path => `${path}/push-id`, set: async () => {}, update: async () => {}, db: {}
};

assert.equal(await api.setPublishingMode(ctx, 'c1', 'REVIEW', 'Needs pre-publication review'), true);
assert.equal(ctx.state.channels.c1.publishingMode, 'REVIEW');
assert.equal(Object.values(ctx.state.audit).some(x => x.action === 'publishing-mode-changed'), true, 'mode change gets audit event');
assert.equal(await api.reviewVideo(ctx, 'v1', 'ignore'), true);
assert.equal(ctx.state.videos.v1.reviewStatus, 'ignored', 'ignore does not approve video');
assert.equal(await api.reviewVideo(ctx, 'v1', 'disapprove', ''), false, 'disapproval requires reason');
assert.equal(await api.reviewVideo(ctx, 'v1', 'disapprove', 'Policy violation'), true);
assert.equal(ctx.state.videos.v1.reviewStatus, 'disapproved');
assert.equal(ctx.state.videos.v1.reviewReason, 'Policy violation');
assert.equal(await api.reviewVideo(ctx, 'v1', 'approve'), true);
assert.equal(ctx.state.videos.v1.reviewStatus, 'approved');
assert.equal(Object.values(ctx.state.audit).some(x => x.action === 'video-approve'), true, 'review decisions get audit events');

const regular = { ...ctx, isAdmin: () => false };
assert.equal(await api.setPublishingMode(regular, 'c1', 'FREE'), false, 'non-admin cannot change publishing mode');
assert.equal(await api.reviewVideo(regular, 'v1', 'approve'), false, 'non-admin cannot approve videos');
console.log('PASS: FREE/REVIEW mode metadata, audit entries, ignore stays unapproved, disapproval reason required, approval status, non-admin rejection');
