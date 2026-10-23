# PIXELTube Moderation Security Status — V3.2.0 Beta

## Client-side behavior verified in this build

- Admin route returns an Admins-only state for a non-admin test context.
- Normal-user Admin Messages show admin-originated threads for the user's own channels, provide reply controls for open threads, and omit the new-conversation and user-side reopen controls.
- Event handlers reject attempts by non-admin users to create an admin conversation or reopen a conversation; replies must belong to the signed-in owner's channel and an admin-originated thread.
- Channel search is search-first and results open the Channel Admin Panel, not the public channel.
- The Channel Admin Panel shows a prominent QVids publishing control and per-video inspection/moderation actions.
- QVids queue, report filters/details, video inspector, appeals/audit screens, and bulk moderation controls were rendered in automated tests.

## Security gaps still open

- Admin checks rely on browser-side username/UID allowlists. A browser UI gate is not authorization.
- No Firebase Realtime Database rules or trusted moderation API were implemented or deployed in this package.
- Moderation, report, inbox, and audit writes depend on the existing database permissions. Client-written audit records can be forged if permissions are too broad.
- Pending and restricted videos may still be reachable through direct database/media/CDN URLs if the current backend/storage permissions allow it.
- The inbox is in-app messaging, not external email.

## Production gate

Implement and test trusted admin authorization, Firebase rules, protected audit writes, report privacy, and pending-media access controls against the actual project before relying on these features with real users. The local tests do not replace those backend tests.
