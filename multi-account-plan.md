# Multi-account implementation plan

Companion to `multi-account-requirements.md`. End-state schema, phased rollout, migration steps.

## End-state schema

**New models:**
- `Site` — `id, name, address?, lat?, lng?, visibility (PRIVATE|PUBLIC), ownerId, deletedAt?, createdAt, updatedAt`
- `Membership` — `id, siteId, userId, role (OWNER|ADMIN|USER|VIEWER), createdAt`, unique `(siteId, userId)`
- `Invitation` — `id, siteId, role, email?, phone?, token (unique), invitedById, expiresAt, acceptedAt?, acceptedByUserId?`
- `OAuthAccount` — `id, userId, provider (APPLE|GOOGLE), providerAccountId, createdAt`, unique `(provider, providerAccountId)`
- `Notification` — `id, userId, kind, data (json), readAt?, createdAt`
- `Plan` enum on User: `FREE` (only value for now)

**User changes:** add `email (unique)`, `name`, `plan`. Keep `username/passwordHash/mustChangePass` during transition; deprecate `username` after backfill.

**Tenant boundary:** add `siteId` to `Plant`, `Photo`, `Action`, `LocationShape`, `Tag`. Existing `createdById` stays as audit trail.

**Uniqueness shifts (Phase 4):**
- `Plant.qrCode`: drop global unique → `@@unique([siteId, qrCode])`
- `Tag`: drop `@@unique([kind, name])` → `@@unique([siteId, kind, name])`
- `LocationShape.qrCode`: same pattern → `@@unique([siteId, qrCode])`

---

## Phase 1 — Schema additive + backfill (non-breaking)

1. Prisma migration adds new tables + nullable `siteId` columns + new User columns.
2. Data backfill script (`apps/api/scripts/backfill-sites.ts`):
   - For each existing User: create one `Site` (name `"{username}'s Garden"`, `PRIVATE`), `Membership(OWNER)`.
   - Set `siteId` on every Plant/Photo/Action/LocationShape/Tag from the createdBy's site. Tags currently global — in single-tenant today they trivially attach to the one site; if more than one user exists, duplicate per-site.
   - Seeded `admin` user: set `email = "admin@local"` and force email change on next login.
3. Deploy. Old code keeps working — columns are nullable, old uniqueness still holds.

## Phase 2 — Auth upgrade (email-as-ID + OAuth)

1. Login matches by `email` (fallback to `username` until backfill confirmed on prod).
2. `POST /auth/signup { email, password, name }` — minimal friction, no verification.
3. Sign in with Apple: `expo-apple-authentication` on mobile; `POST /auth/oauth/apple { identityToken }` verifies, finds/creates User + OAuthAccount.
4. Sign in with Google: `expo-auth-session` on mobile, OAuth code flow on web.
5. Legacy users on next login → "Set your email" screen if `email = admin@local` or null.
6. Sessions table unchanged.

**Apple Store note:** offering Google sign-in requires also offering Apple sign-in. Ship them together.

## Phase 3 — Site + membership + permissions API

1. Routes:
   - `POST /sites` (limit: free plan = 1 *owned*)
   - `GET /sites` (memberships of current user)
   - `GET /sites/:id` — public sites visible without auth
   - `PATCH /sites/:id` (Owner/Admin; visibility flip is Owner-only)
   - `DELETE /sites/:id` (Owner — soft-delete, sets `deletedAt`)
   - `POST /sites/:id/restore` (Owner, within 30d of `deletedAt`)
   - `POST /sites/:id/transfer { toUserId }` (Owner only)
   - `GET /sites/:id/members`, `PATCH /sites/:id/members/:userId`, `DELETE /sites/:id/members/:userId`
   - `GET /sites/public/search?q=&near=lat,lng` — nearby uses Haversine on `Site.lat/lng`
2. Site geocoding: Nominatim free tier on create/update; cache lat/lng on Site row.
3. Permission middleware: `requireRole(siteId, [...allowedRoles])`. For public sites + missing auth, route handler opts in via `allowAnonViewer: true`.
4. Plan limits: helper `getOwnerPlanLimits(site)` reads `site.owner.plan`. Hardcoded `FREE = { ownedSites: 1, plantsPerSite: 50 }`.

## Phase 4 — Wire data routes to site context (breaking)

Coordinate with clients.

1. Every existing route (`/plants`, `/photos`, `/actions`, `/tags`, `/location-shapes`, `/codes`) requires `siteId`. Middleware loads membership, attaches `req.site` and `req.role`.
2. Switch uniqueness constraints:
   - Drop `Plant.qrCode` unique → `@@unique([siteId, qrCode])`
   - Drop `Tag @@unique([kind, name])` → `@@unique([siteId, kind, name])`
   - `LocationShape.qrCode` same pattern
3. `siteId` NOT NULL on all tenanted tables (safe — Phase 1 backfilled).
4. Strip `Action` rows and `Plant.notes` / `Action.notes` in serializers when `req.role` is `VIEWER` or anonymous.
5. Plant-create enforces plant-count limit against owner's plan.

## Phase 5 — Mobile UX

1. **Site Selector** screen — list of memberships + "Create site" + "Find public sites".
2. Replace MapScreen nav button → Site Selector. Map becomes a Browse tile.
3. `AuthContext` extends with `currentSiteId` persisted to `AsyncStorage`.
4. Browse / Scan / Reports tabs disabled until `currentSiteId` set.
5. Settings → Site section: rename, visibility (with confirmation modal on flip), members list with role changes, pending invitations, leave/delete-with-retention.
6. Sign-up / Sign-in screens (email+password, Apple, Google).
7. Profile-completion screen for legacy users.

## Phase 6 — Web public unauth views

1. Public routes in `apps/web`: `/s/:siteId`, `/s/:siteId/plants/:plantId`, `/s/:siteId/map`, `/s/:siteId/browse/...` — no auth required.
2. Middleware skips auth for these; API calls go anonymously and rely on Phase 4 anon-viewer logic.
3. Photo endpoint: when serving for a public site, sign URL even for anon callers. Keep short TTL (24h) so Public→Private flips take effect within a day.
4. Hide Action timeline, `Plant.notes`, `Action.notes` for Viewer/Anon.
5. Auth pages: login, signup, OAuth callbacks.

## Phase 7 — Invitations end-to-end

1. `POST /sites/:id/invitations { role, email?, phone?, expiresAt? }` (Owner/Admin). Generates token; `expiresAt` defaults to 48h.
2. Stub `notifications/email.ts` + `notifications/sms.ts` — log + persist `Notification` row for any registered user matching the address.
3. `GET /invitations/:token` returns site preview (name, role offered). No auth required.
4. `POST /invitations/:token/accept` — requires authenticated user; creates membership, marks `acceptedAt + acceptedByUserId`, posts inviter notification.
5. Mobile: in-app notification badge + accept/decline UI.
6. Push: stub dispatcher (no APNs/FCM creds yet) — `Notification` rows still created.

## Phase 8 — Limits, retention, polish

1. Free-plan enforcement at create-site and create-plant endpoints with clear error codes.
2. Daily cron (later — manual script for now): hard-delete sites where `deletedAt < now - 30d`, cascading.
3. Visibility-flip confirmation copy: "Anyone on the internet will be able to view this site's plants and photos. Treatment notes will stay hidden."
4. Plan-downgrade grace: `planDowngradedAt` on User; reads work, writes block once over cap; UI prompts to upgrade or trim.
5. Owner transfer flow: invite-style — target must accept; original owner stays until accepted.

---

## Deferred (explicit non-goals for this round)

- Push notification provider (APNs/FCM creds, expo-notifications wiring).
- Email/SMS delivery (Postmark/Twilio).
- Hard-delete cron scheduler.
- Email/phone verification path.
