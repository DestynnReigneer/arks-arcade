# Status and to-dos

Last updated 2026-10-23. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here. When the
maintainer says "I'm back", start from "Last session" below.

## Last session (2026-10-21 to 10-23)

**Done and merged** (each its own PR, CI green):

- #17 notes, #18 neutral wording in public docs and the MIT license, #19 the
  container hands `./data` to `PUID:PGID` on start, #20 changing or removing a
  profile PIN asks for the current one, #21 CLAUDE.md writing rule, #22 the
  home page sorts games by most played (per profile, then everyone).
- #23 the new home page top and bottom, from the header the maintainer chose
  as the design language for every app: slogan on top; profile on the left;
  logo lockup (picture, wide logo, "ARCADE" as a gradient outline) or the
  plain title in the middle; ? help and ADMIN on the right; a clickable
  INSERT COIN under the title (coin sound, third coin gets an announcer);
  a Cheat codes box under Join a game (/secret lists the commands); clickable
  pixel characters on the walls; the square logo spinning in the footer.
  Plus the owner's optional `brand/` and `media/` folders, with clips that
  play as secret commands, random surprises, or sent from Admin → Arcade.
  How-to: `docs/CUSTOM-MEDIA.md`.

On 2026-10-24, the adult levels cleanup (feedback items 3 to 6): gentler level
descriptions, "Sex Facts" renamed "Between the Sheets", and Rambler's adult
PIN screen now looks like the other games' and checks the PIN on entry, so a
wrong one can be retried. Every adult PIN check allows 20 tries per 10
minutes, the same as profile PINs.

Earlier work (#11 to #16: new games, admin sign-in, party polish, PIN pads)
is in the git history and the README.

**In progress:**

- **Achievements.** The design plan is a private doc the maintainer is
  marking up (link in the maintainer's own notes). Nothing is built yet. When
  they're done, revise the plan from their edits, then build step 1.
- **Shared clips for the other apps** (Hub and later): planned in the private
  `arks-internal` repo (`conventions/shared-media.md`), not built.

## Next up

1. **Play-test on the server:** #15 party polish, #16 PIN pads, and #23 the
   new top, footer, cheat codes and clips. Fix what turns up.
2. **Achievements:** wait for the maintainer's markup of the plan, then build
   step 1 (age groups, the feats engine, Rambler milestones moved over).
3. **Get Claude in Chrome connected** so pages can be checked in a real
   browser. Everything is installed; it needs a full Chrome restart and the
   extension signed in to the same account. Until then, headless Chrome
   screenshots work for checking layouts.
4. Ask which other games should use the countdown tune (Know-It-All's answer
   clock, Spin & Solve's turn clock).

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

- Dependabot has three open PRs (#2 Docker node-26-alpine, #3 npm, #4 GitHub
  Actions). Review them. Since 2026-10-24 the Dockerfile names an exact Node
  version (22.23.4), Dependabot checks it weekly and skips new major
  versions, and the image rebuilds on the 1st of each month, so #2 is
  handled by the Node 26 move instead.
- Wordless isn't on the ARKS color spec yet (see `docs/DESIGN.md`).
- `DISCORD_WEBHOOK_URL` is unset locally, so theme/profile requests don't
  notify. That's expected in dev.
