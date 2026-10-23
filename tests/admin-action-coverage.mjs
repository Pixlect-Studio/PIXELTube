import assert from 'node:assert/strict';
import fs from 'node:fs';
const sec = fs.readFileSync(new URL('../js/sec.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const actions = [...new Set([...sec.matchAll(/data-action="([a-z][a-z0-9-]+)"/g)].map(m => m[1]))].sort();
assert.ok(actions.length >= 25, `expected broad action coverage, got ${actions.length}`);
for (const action of actions) assert.ok(main.includes(action), `rendered admin action has no handler reference: ${action}`);
for (const guard of [
  'if (!isAdmin()) { toast(\'Only PIXELTube Admin can start an admin inbox conversation\')',
  'if (!isAdmin()) { toast(\'Only PIXELTube Admin can reopen a conversation\')',
  'You can only reply to conversations started by PIXELTube Admin',
  'if (!isAdmin()) { toast(\'Admin only\')'
]) assert.ok(main.includes(guard), `missing permission guard: ${guard}`);
for (const feature of ['admin-report-under-review','admin-resolve','admin-dismiss','admin-qvids-toggle','admin-review-approve','admin-review-ignore','admin-review-disapprove','admin-channel-warn','admin-channel-email','admin-verify-channel','admin-suspend','admin-unsuspend','admin-video-toggle-restrict','admin-rename-video','admin-flag-video','admin-thread-reply','admin-thread-close','admin-thread-reopen','admin-bulk-approve','admin-bulk-ignore','admin-bulk-disapprove','admin-bulk-delete','inbox-reply']) {
  assert.ok(actions.includes(feature) || main.includes(feature), `feature action missing: ${feature}`);
}
console.log(`PASS: ${actions.length} rendered admin action names have corresponding main.js handler references; inbox permission guards and moderation workflows are present.`);
