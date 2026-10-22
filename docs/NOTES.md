# Status and to-dos

Last updated 2026-10-21. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here.

## Where things stand

- `main` has everything through PR #12:
  - #11: Admin Stats; Snake, Brick Breaker, Block Drop, Tower Defense; soft
    background music with a 🎵 toggle (Block Drop plays the Korobeiniki folk
    tune). The music has been listened to and approved.
  - #12: admin sign-in by httpOnly session cookie (sign in again once after
    updating), strict `npm ci` in the image, the app can only write to
    `/app/data`, TZ defaults to America/Los_Angeles, CI runs on PRs only.
- **`feat/party-polish`** is pushed, **waiting for the owner to play it**
  before its PR:
  - Uh-Oh: Part Deux: mobile-app table (players across the top, piles apart,
    glowing "YOUR TURN" hand area), cards with one big symbol, new card names
    that fit what each card does, truck beep on Reverse, an occasional
    "womp womp", and server-picked jokes at the table's spice level.
  - Jokes everywhere stay up by reading time (`ArcadeKit.readMs`, `ArcadeKit.joke`).
  - Dare Devil: timed cards get a 5-second reading grace, then a countdown
    with `Blip.think()` (our own tune) and a buzzer.

## Next up

1. **The owner plays `feat/party-polish`**, then fix what they find and open
   the PR (merge when CI is green).
2. **Get Claude in Chrome connected** so pages can be checked in a real
   browser: everything on the machine is set up (extension installed, native
   host registered for the native `claude.exe`); it needs a full Chrome
   restart and the extension signed in to the same account.
3. Ask which other games should use the countdown tune (Know-It-All's answer
   clock, Spin & Solve's turn clock).

## Parked until closer to finished

- **Passkey sign-in for admin** (fingerprint, face or phone instead of typing
  the password). The `.env` password stays as the recovery; no email
  recovery, by design. Passkeys are tied to the site's name, so one made on
  `localhost` won't work on the homelab's name: register a new one there.
  They need `localhost` or HTTPS. Plan: `@simplewebauthn/server` (rather than
  hand-rolling the crypto), a credentials table, register/sign-in endpoints
  that issue the same session cookie, and a "Manage passkeys" list in admin.
- **Shared family accounts ("ARKS ID")**: decided 2026-10-21 with the Family
  Hub session. The full spec lives in the private `arks-family-hub` repo
  (`docs/ARKS-ID.md`) until the private `arks-id` repo exists. Build order:
  arks-id → Hub → passkeys → **arcade last**, so nothing to build here yet.
  What the arcade will need:
  - **Optional.** Only on when `ARKS_ID_URL` (plus an app secret) is set in
    `.env`. Built-in profiles stay the default, party guests stay
    accountless, and the arcade's own `.env` admin password stays its recovery.
  - **Sign-in handoff, no shared cookie.** The arcade redirects to ARKS ID's
    sign-in page with a return path. ARKS ID sends the person back to the
    arcade's registered `/auth/callback?code=…` (single-use, 60 s). The
    arcade's server swaps the code via `POST /api/token` (code + app secret)
    for `{ user, sessionId, expiresAt }`, sets its own host-only cookie, and
    re-checks `GET /api/session/:id` every few minutes so sign-outs, PIN
    resets and role changes reach it. Signing out here signs out everywhere.
  - **User shape:** `{ id, name, avatar: { icon, color, image }, role, device }`.
    Link arcade profiles to `id` (stable, never reused), never to `name`.
    Always draw the icon + color; use `image` (a small square ARKS ID
    serves, or `null`) only when it's set and loads. Its `?v=` changes with
    the picture, so it's safe to cache.
  - **Roles:** admin / adult / teen / kid. Adult (18+) games: admin and adult
    only. Teen: teen and kids games. Kid: kids games only. Arcade admin:
    ARKS admin only.
  - **Devices:** Personal (15 days since last use) and Shared (avatar picker
    plus PIN on every switch, a Switch button, signs out after 10 min idle).
    Copy both as-is.
  - **PINs:** 6 digits, checked the moment the 6th digit goes in (no Enter
    key; keypad 0–9, CLR, ⌫). The owner wants the arcade's own PIN pads to
    work the same way. **Open question for the owner:** the arcade's adult
    PIN is 4–8 digits today; auto-checking needs a fixed length (6?).

## Deployment

**Not deployed to the homelab yet.** The target host, port and proxy name are
tracked in the private `arks-family-hub` repo (`docs/SPEC.md` and
`docs/SERVICES.md`), not here, because this repo is public. Two things known
from there:

- The arcade's homelab port **can't be 3000**: another service already uses it
  on that host. Map a different host port in the compose file.
- The Family Hub will show an ARKS Arcade tile with a live status chip read
  from `/healthz`. Keep that endpoint working and cheap.

## Good to know

- **Still in beta.** Local scores and profiles don't matter yet, so wiping or
  renaming the local database is fine.
- **Dropped ideas**, so they don't come back by accident: Short Fuse (replaced by
  Uh-Oh: Part Deux and Dare Devil), the Kaleidoscope doodle pad (the kids are
  too old for it), and making the repo private.
- More games will be added over time.

## Smaller to-dos

- Dependabot has three open PRs (#2 Docker node-26-alpine, #3 npm, #4 GitHub
  Actions). Review them.
- The local branch `feat/difficulty-and-polish` is merged (PR #10) and can be
  deleted.
- The `package.json` description still says "an arcade of word games: Wordless
  and Rambler". Bring it in line with the README.
- Wordless isn't on the ARKS color spec yet (see `docs/DESIGN.md`).
- `DISCORD_WEBHOOK_URL` is unset locally, so theme/profile requests don't
  notify. That's expected in dev.
