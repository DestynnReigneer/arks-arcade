# Status and to-dos

Last updated 2026-10-24. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here. When the
maintainer says "I'm back", start from "Last session" below, then show the
to-do list as checkboxes (the rule is in the maintainer's global CLAUDE.md
and `arks-internal/conventions/sessions.md`): do the checked items in the
order they were clicked, and keep the rest pinned here.

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

- **Feedback extras (asked for every app, 2026-10-24):** an admin picture
  viewer (full screen, zoom, fit, actual size, drag, open in a new tab);
  diagnostics the bug collects from page load (page and view, device and
  browser, how long the page was open, version plus git commit, the last 10
  errors and failed server calls; the server adds who, when and the user
  agent); and one copy-paste block per feedback with Copy for chat and a
  Search the web button per error. Spec: `arks-internal/conventions/feedback.md`,
  "Seeing the picture, and the diagnostics". The Hub built it first
  (arks-family-hub PR #27): copy `public/feedback.js` (the collector wraps
  `fetch` and listens for `error` and `unhandledrejection` from page load),
  `public/feedback.css`, `server/feedback.js` (`cleanDetails`, Discord with
  `allowed_mentions: { parse: [] }`, the version from `GIT_SHA`), and
  `chatBlock()`, `pageFeedback()` and `openViewer()` from `private/admin.js`.
  Search the web cleans the error first (web addresses, IPs with ports,
  `arksnet` names, emails, `u_`/`s_` ids, long hex ids and 5+ digit numbers
  become placeholders) and shows it in an editable box with Cancel and Search
  before anything goes to Google: copy `cleanForSearch()` and `openSearch()`
  too (arks-family-hub PR #28, arks-internal PR #21).
  CI: `ARG GIT_SHA=dev` plus `ENV GIT_SHA` in the Dockerfile, and
  `build-args: GIT_SHA=${{ github.sha }}` in `docker-publish.yml`.
- **Play-test on the server:** pull the new image on the server and try
  everything from #15 to #37. Fix what turns up.
- **Start a new game:** Sudoku, a crossword, a word scramble, or a
  cabinet-style game (the list is in the private feedback list).
- **Countdown tune in more games:** should Know-It-All's answer clock and
  Spin & Solve's turn clock use it?
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
  sign-in and passkeys). **Built against ARKS ID contract: none yet.**
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
