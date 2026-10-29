# Status and to-dos

Last updated 2026-10-24. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here. When the
maintainer says "I'm back", start from "Last session" below, then show the
to-do list as checkboxes (the rule is in the maintainer's global CLAUDE.md
and `arks-internal/conventions/sessions.md`): do the checked items in the
order they were clicked, and keep the rest pinned here.

## The ARKS look (2026-10-29)

The maintainer approved a preview and chose: the whole arcade on the Vice background,
panels and text (`public/look.css`), and one top bar on every page
(`public/topbar.css`, built on game pages by `public/topbar.js`), the same as their
other apps. Game accents, the 8-bit characters, slogans, INSERT COIN and the gold for
coins and wins stay. Wordless keeps its own look but gets the bar. The bar on game
pages is pinned (`position: fixed`) with a spacer under it, and it's a `<div>`, not a
`<header>`, because some games style every `<header>`. Adult mode's pink frame and
ADULTS ONLY tab are now the signal for grown-up mode (`docs/DESIGN.md`).

## The sticky top bar (2026-10-27)

The home page's top bar now stays at the top of the screen. Once you scroll it shrinks
to one thin row: the rotating slogan and INSERT COIN fade away, and the title gets
smaller. While anyone is hosting a game, a LIVE pill with the number of games fades into
the bar as the lobby scrolls away, and tapping it jumps back to the lobby. The footer
logo fades in as you reach the bottom, and nothing shows a scroll bar.

- `public/dock.js` does the shrinking and fading. It's a copy of a file shared with other
  apps, so keep the copies in step and keep this one free of anything specific to them.
- The title lockup is a little smaller (46 pixels tall instead of 60), and the two side
  columns share the leftover room, so the title stays centered on a phone too.
- The game pages keep their own headers for now.

## Last session (2026-10-24)

**Done and merged** (each its own PR, CI green, image published):

- #24 gentler adult level wording, and Rambler's adult PIN screen fixed (it
  looks like the other games' and checks the PIN on entry).
- #25 Rambler rooms ask for initials once, not on every room update.
- #26 Node security updates arrive on their own (exact `node:22.23.4-alpine`,
  weekly Dependabot, monthly rebuild).
- #28 Play again sits at the top right of every end screen.
- #29 Rambler's board stays up after the round; tap a word to see its path.
  #32 lines up the found and missed columns.
- #30 a profile locks after 5 wrong PINs and a device after 20; admin can
  unlock both. Only wrong PINs count.
- #31 turn games on and off from admin, with the "Pardon our dust" sign.
- #33 and #35 Rambler and Wordless no longer scroll sideways on phones.
- #34 package description, and Wordless keeps its own look (decided).
- #36 each profile chooses its name or initials on the high-score boards,
  past scores included; profiles aren't asked for initials anymore.
- #37 the feedback bug: a tiny red bug on every page opens a feedback card
  with a marked-up screenshot, merged into the Comm Center inbox.
- Cleaned up GitHub: the last merged branch is deleted.

**In progress:**

- **The feedback bug in the Hub and ARKS ID:** the maintainer said go; their
  sessions build it from `arks-internal/conventions/feedback.md`.

## To-do list (checkbox list; pinned items wait here)

Since 2026-10-24 the one to-do list for every ARKS product lives in the
maintainer's private roadmap (`arks-internal/ROADMAP.md`), worked from one
session for all the repos. This copy is the Arcade's part of it; tick items
off in both places. One rule from the roadmap shapes the Arcade's next big
item: when it signs in through ARKS ID (`ARKS_ID_URL` set), ARKS ID owns
everything about a person, and the Arcade's own profile PINs, locks,
board-name setting and adult PIN are only for copies running without it.

- **Play-test on the server:** pull the new image on the server and try
  everything from #15 to #37. Fix what turns up.
- **Start a new game:** Sudoku, a crossword, a word scramble, or a
  cabinet-style game (the list is in the private feedback list).
- **Achievements step 1:** waits for the maintainer's markup of the private
  plan. Then build step 1 (age groups, the feats engine, Rambler milestones
  moved over).
- **Node 26:** after 2026-10-28, move to an exact Node 26 version. The
  `body-parser` warning was patched with `npm audit fix` instead of Express 5
  (2026-10-25), so Dependabot #3 closed as replaced; Express 5 can come later
  as its own change.
- **Get Claude in Chrome connected,** so pages can be checked in a real
  browser. Until then, headless Chrome screenshots work.

## Parked until closer to finished

- **Passkey sign-in for admin** (fingerprint, face or phone instead of typing
  the password). The `.env` password stays as the recovery; no email
  recovery, by design. Passkeys are tied to the site's name, so one made on
  `localhost` won't work on the server's name: register a new one there.
  They need `localhost` or HTTPS. Plan: `@simplewebauthn/server` (rather than
  hand-rolling the crypto), a credentials table, register/sign-in endpoints
  that issue the same session cookie, and a "Manage passkeys" list in admin.
- **Shared family accounts ("ARKS ID")**: planned and approved. The
  contract is in the private `arks-id` repo (`docs/SPEC.md`); see CLAUDE.md
  for how to use it. The arcade integrates last (after ARKS ID, the Hub's
  sign-in and passkeys). **Built against ARKS ID contract: v8** (2026-10-28): silent
  sign-in (at most once an hour, `/auth/signin?silent=1`, so someone signed in to ARKS ID
  elsewhere is signed in here with no tap). Before that, v7 (2026-10-26):
  sign-in, `/device` for guest play, `boardName`, the clip inbox, avatars from
  the account (`avatar.art`, or the icon as `arks:<icon>:<color>`), and
  handing a guest's name and avatar to sign-up (`/api/prefill`).
  `public/avatars.js` is the original of the shared avatar collection; the
  other apps keep exact copies, so copy it over after changing it.
  The Hub already signs in through ARKS ID (arks-family-hub PR #26, contract
  v3). When the arcade does, its `server/arksid.js` and `test/harness.js` (a
  pretend ARKS ID for tests) are worth copying. Two lessons from it: profile
  photos are fetched by the server, so the browser only talks to the app, and
  there's no Switch button, because Sign out is how people switch.

## Deployment

**Being deployed** (2026-10-21, pulling `:latest`). The host, port and proxy
name are tracked in the private `arks-family-hub` repo, not here, because
this repo is public. Two things to know:

- The server's port 3000 is taken, so its `.env` sets `HOST_PORT`.
- The family dashboard shows an arcade tile with a live status chip read
  from `/healthz`. Keep that endpoint working and cheap.

## Good to know

- **Still in beta.** Local scores and profiles don't matter yet, so wiping or
  renaming the local database is fine.
- **Dropped ideas**, so they don't come back by accident: Short Fuse (replaced by
  Uh-Oh: Part Deux and Dare Devil), the Kaleidoscope doodle pad (too young for
  the audience), and making the repo private.
- More games will be added over time.

## Smaller to-dos

- `DISCORD_WEBHOOK_URL` is unset locally, so theme/profile requests don't
  notify. That's expected in dev.
