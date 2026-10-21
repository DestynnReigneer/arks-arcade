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
- **Shared family accounts ("ARKS ID")** are being designed on the Family Hub
  side: accounts in the Hub first, built to move into a shared ARKS ID that
  the arcade can use later (sign in once, same user on both). Check there
  before building passkeys here. Arcade constraints: it must keep working
  standalone (ARKS sign-in is an optional `.env` setting, built-in profiles
  stay the default), kids need PIN sign-in, guests stay accountless, and the
  Hub and arcade are on different hostnames under the same domain.

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
