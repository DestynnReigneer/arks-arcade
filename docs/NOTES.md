# Status and to-dos

Last updated 2026-10-21. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here.

## Where things stand

- `main` has everything through PR #10 (`feat/difficulty-and-polish`) plus
  `feat/stats-and-games` (Admin Stats; Snake, Brick Breaker, Block Drop, Tower
  Defense; soft background music with a 🎵 toggle, Block Drop's being the
  Korobeiniki folk tune). The music has been listened to and approved.

## Next up

1. **Repo cleanup from an architecture review**, on its own branch and PR:
   compose and `.env.example` defaults, Dockerfile build strictness and file
   ownership, admin sign-in storage, and CI triggers.
2. **Party-game polish**, on its own branch:
   - Uh-Oh: Part Deux: a cleaner, Uno-like table (clearer "your turn", draw
     pile apart from the played pile, less cluttered cards). Rename or explain
     the Water Balloon Bomb card. Occasional "womp womp" when a card hits a
     player, a truck-reversing beep for Reverse, and comedy pop-ups at every
     spice level.
   - Spin & Solve and Uh-Oh: jokes stay on screen long enough to read.
   - Dare Devil: timed dares ("do it in 10 seconds") get a 4-5 second reading
     grace, then a visible countdown.
   - An original "thinking" countdown tune (not the Jeopardy one) that games
     can use.

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
