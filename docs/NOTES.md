# Status and to-dos

Last updated 2026-10-21. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here.

## Where things stand

- `main` has everything through PR #10 (`feat/difficulty-and-polish`):
  arcade-wide profiles, the setup guide, the rename to ARKS Arcade, data in
  `data/arcade.db`.
- **`feat/stats-and-games`** is pushed and has **no PR yet**. It adds:
  - Admin Stats
  - Four new games: Snake, Brick Breaker, Block Drop, Tower Defense
  - Polish: Snake on 24x24 with smooth gliding; Brick Breaker metal walls;
    Block Drop tap-down = one row, hold about 0.35s = drop all the way; Tower
    Defense timed waves (30s first, 15s breaks, early-call bonus), six maps,
    1×–3× speed stepper; new art for all four
  - Soft background music for those four games (`public/blip.js`), with a 🎵
    toggle in the top bar
  - The New Profile button reads "Create profile" (was "Ask for it")

## Next up

1. **Test the music** on `feat/stats-and-games`. The games have been played,
   but the audio hasn't been heard yet. Check: the 🎵 toggle (and that it's
   remembered), the volume against sound effects, whether any loop gets
   annoying, and that music stops on pause, game over and leaving the game.
2. **Open the PR** `feat/stats-and-games` → `main` once the audio is OK. The
   owner merges it.

## Deployment

**Not deployed to the homelab yet.** The target host, port and proxy name are
tracked in the private `arks-family-hub` repo (`docs/SPEC.md` and
`docs/SERVICES.md`), not here, because this repo is public. Two things known
from there:

- The arcade's homelab port **can't be 3000**: another service already uses it
  on that host. Map a different host port in the compose file.
- The Family Hub will show an ARKS Arcade tile with a live status chip read
  from `/healthz`. Keep that endpoint working and cheap.

## Smaller to-dos

- Dependabot has three open branches (Docker node-26-alpine, GitHub Actions,
  npm). Review them after the PR above.
- The local branch `feat/difficulty-and-polish` is merged (PR #10) and can be
  deleted.
- The `package.json` description still says "an arcade of word games: Wordless
  and Rambler". Bring it in line with the README.
- Wordless isn't on the ARKS color spec yet (see `docs/DESIGN.md`).
- `DISCORD_WEBHOOK_URL` is unset locally, so theme/profile requests don't
  notify. That's expected in dev.
