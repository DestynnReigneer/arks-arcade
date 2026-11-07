# Working on the arcade

Notes to self, mostly.

## Running it

```bash
npm install
npm start          # http://localhost:3000
npm test           # boots a server on a free port and runs everything
```

Each run picks its own free ports, so two copies of the repo can run their
tests at the same time (set `TEST_PORT` to pin one). The checks that run inside
the test runner itself use a seeded `Math.random`, so they roll the same dice
every time; set `TEST_SEED` to a number to try a different roll.

`npm test` is the gate. CI runs exactly that, plus a Docker build whose
healthcheck has to go green.

### Browser tests

```bash
npx playwright install chromium   # once, to download the test browser
npm run test:browser
```

These open the arcade in a real Chromium, at a phone's size (390 by 844) and a
laptop's size (1280 by 800), and check what a person would see. They live in
`test/browser/`, and `playwright.config.js` starts their own server
(`test/browser/serve.js`): the arcade with sign-in through the pretend ARKS ID
from `test/fake-arksid.js`, on a throwaway database. CI runs them as a separate
job on every pull request. Playwright is a dev dependency only, so it never
ends up in the Docker image (CI checks that too).

## Layout

- `server.js` — Express app; Wordless routes live here, Rambler is mounted
  from `rambler/routes.js`
- `db.js` — every table for both games, plus the Wordless scoring formula
- `rambler/` — Rambler, self-contained; see the README for what each file does
- `sudoku/` — Sudoku's puzzle maker and its routes (runs, the clock, a profile's saved progress, the boards)
- `arcade/score-admin.js` — the admin page's Boards tab: take one score off any game's board and put it back
- `rambler/housekeeping.js` — once a minute, rolls the Rambler season over when it's due and re-applies the theme pack
- `scuffle/` — Shuffle Scuffle's letters, points, solo games, daily board and rooms
- `crisscross/` — Words with Family (called Criss Cross until November 2026, so the files kept that name): the rules (`engine.js`), the computer player (`bot.js`) and the games kept in the database (`games.js`)
- `clueless/` — Clueless Crosswords (called Clueless until November 2026), the daily crossword and free play: the grid shapes and filler (`grid.js`), the clue checks (`clues.js`), the built-in clues, the day's puzzles and clue packs (`maker.js`, `puzzles.js`) and the routes
- `tumbler/` — Tumbler Rumble's runs, the replay that works out each score, and the boards; the rules themselves are `public/tumbler-engine.js`, which the page and the server both load
- `discodrop/` — Disco Drop's runs and boards. The motion and the scoring rules are in `public/discodrop-engine.js`, which the page and the server both load, so they always agree
- `royale/` — Roll Royale's runs, the replay that works out each score, and the boards; the rules themselves are `public/royale-engine.js`, which the page and the server both load
- `moonshot/` — Moonshot's runs, swings, pauses and boards. The pitches and the scoring rules are in `public/moonshot-engine.js`, which the page and the server both load, so they always agree
- `public/cab-*.js`, `public/cab.css` and `public/vendor/three/` — the 3D cabinet games' shared engine, sound and frame,
  on three.js 0.128 copied into the arcade (nothing loads from outside). A game is one `cab-<name>.js` file plus a page;
  `CabFrame.run` in `cab-frame.js` says what a game has to provide. `window.CabTest` steps a game by hand for the
  browser tests (`step` doesn't draw, which matters because the test browser draws 3D in software, slowly)
- `words/` — the dictionaries, plain text, edit by hand
- `test/` — `unit.test.js` needs no server, `api.test.js` needs the one the
  runner starts
- `kit/` — shared code the arcade has in common with other apps (see below)

### Shared kit

A few files are kept identical across several apps from one shared kit: the
server files in `kit/` (`version.js`, `burst-limit.js`, `security.js`,
`feedback.js`), plus `public/dock.js`, `public/snapframe.js`,
`public/avatars.js` and `scripts/check-kit.js`. They're copies, so please
don't edit them in this repo. `kit/kit.json` lists each one with a SHA-256
fingerprint, and `npm test` starts by running `scripts/check-kit.js`, which
fails if any of them was changed here. The arcade's own settings for that
code (its Content Security Policy, how it reads `TRUST_PROXY`, where feedback
is stored) are in `arcade/security.js`, `arcade/feedback.js` and
`arcade/comm.js`, and those are fine to change.

## Things that will bite you

- **Boards are rectangular.** Marathon grows the grid, so anything taking a
  board also needs `{ cols, rows }`. A plain number still works and means a
  square.
- **The word-length minimum is fixed when a round is created**, not derived
  from the current board. A growing Marathon board must not start rejecting
  three-letter words halfway through.
- **Rooms must stash their board before broadcasting the start.** Clients begin
  checking words the instant that event lands; publishing first hands them a
  null board id. There is a regression test for this.
- **The server owns every verdict.** Scores are read back from the round the
  server scored, never from the request body. Keep it that way.
- **`/healthz` only looks.** The container healthcheck calls it every 30 seconds, so it must stay cheap. Anything that has to happen on a schedule goes on a timer (like `rambler/housekeeping.js`), never in `/healthz`.
- **A new game's board table is called `<game>_scores`** with `id`, `initials` and a `score` or `time_ms` column (and `day` if it has daily boards), so the admin page's Boards tab finds it without any changes. Removing a score moves its row to `removed_scores`, so the game's own queries need nothing extra.
- **`node:sqlite` needs Node 22.5+.** It was chosen over `better-sqlite3`
  specifically to keep native build tools out of the Alpine image.

## Releasing

Tag it and CI publishes to GHCR:

```bash
git tag -a v1.1.0 -m "Marathon mode, profiles, daily challenge"
git push origin v1.1.0
```

Then on the server: `docker compose pull && docker compose up -d`.

### Rolling back

Every image CI publishes is also labeled `sha-` plus the first seven
characters of the commit it was built from (for example `sha-abc1234`). The
admin page and `/healthz` say which commit is running. To go back to an
earlier build, put that label in `docker-compose.yml` in place of `latest`
(`ghcr.io/destynnreigneer/arks-arcade:sha-abc1234`), then run
`docker compose pull && docker compose up -d`. To return to the newest build,
switch it back to `latest` and run the same two commands.
