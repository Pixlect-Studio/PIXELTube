import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/sec.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\s*/ms, '')
  .replace(/export async function /g, 'async function ')
  .replace(/export function /g, 'function ');
const wrapped = `${source}\nglobalThis.__test = { isChannelSuspended, getChannelSuspensionInfo, canCurrentUserUpload, suspendChannel, unsuspendChannel };`;
const document = { addEventListener() {} };
const sandbox = { console, Date, Number, String, Math, Object, Array, JSON, document };
vm.runInNewContext(wrapped, sandbox, { filename: 'sec.js' });
const api = sandbox.__test;
const writes = new Map();
const removals = [];
const messages = [];
const ctx = {
  PIXLECT: { user: { uid: 'admin-uid', username: 'admin14' } },
  state: {
    mode: 'firebase', activeChannelId: 'c_extra',
    channels: {
      pl_owner1: { id: 'pl_owner1', ownerUid: 'owner1', name: 'Main' },
      c_extra: { id: 'c_extra', ownerUid: 'owner1', name: 'Test1' },
      c_other: { id: 'c_other', ownerUid: 'owner1', name: 'Other' }
    }, users: {}
  },
  isAdmin: () => true,
  toast: m => messages.push(m),
  db: {},
  ref: (_db, path) => path,
  push: path => `${path}/audit_${Date.now()}`,
  set: async (path, value) => writes.set(path, structuredClone(value)),
  remove: async path => { removals.push(path); writes.delete(path); }
};

assert.equal(await api.suspendChannel(ctx, 'c_extra', 'Fake content', 3), true, 'admin can suspend channel');
assert.ok(writes.has('pixeltube/channels/c_extra/moderation'), 'suspension saved to channel path');
assert.equal([...writes.keys()].some(k => k.includes('/users/')), false, 'owner account record is untouched');
assert.equal(api.isChannelSuspended(ctx, 'c_extra'), true, 'channel becomes suspended');
// Simulate owner session on the suspended channel: uploading must be blocked.
const ownerCtx = { ...ctx, PIXLECT: { user: { uid: 'owner1', username: 'owner' } }, isAdmin: () => false };
assert.equal(api.canCurrentUserUpload(ownerCtx).reason, 'suspended', 'suspended active channel blocks upload');
ownerCtx.state.activeChannelId = 'c_other';
assert.equal(api.canCurrentUserUpload(ownerCtx), null, 'another channel stays usable');
ownerCtx.state.activeChannelId = 'pl_owner1';
assert.equal(api.canCurrentUserUpload(ownerCtx), null, 'main channel remains usable when only extra channel suspended');

const expiry = ctx.state.channels.c_extra.moderation.expiresAt;
assert.equal(api.isChannelSuspended(ctx, 'c_extra', expiry + 1), false, 'expired suspension stops applying');
assert.equal(await api.unsuspendChannel(ctx, 'c_extra'), true, 'admin can reinstate channel');
assert.ok(removals.includes('pixeltube/channels/c_extra/moderation'), 'reinstatement removes only channel moderation record');
assert.equal(api.isChannelSuspended(ctx, 'c_extra'), false, 'reinstated channel is active');

const nonAdminCtx = { ...ctx, isAdmin: () => false };
assert.equal(await api.suspendChannel(nonAdminCtx, 'c_other', 'test', 1), false, 'non-admin cannot suspend');
assert.ok(messages.some(m => m === 'Admin only'), 'non-admin receives denial feedback');

const badDuration = await api.suspendChannel(ctx, 'c_other', 'test', 0);
assert.equal(badDuration, false, 'invalid duration rejected');
console.log('PASS: channel-only write path, owner isolation, active-channel upload gate, expiry, reinstatement, admin gate, invalid duration');
