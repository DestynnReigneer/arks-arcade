# ARKS Arcade

A self-hosted family and party arcade: one Node.js + Express + SQLite
container, many games. Public repo: DestynnReigneer/arks-arcade.

Where things are documented (read these rather than guessing):

- `README.md`: every game, its rules and API, the word lists
- `CONTRIBUTING.md`: running, tests, code layout, things that bite, releasing
- `docs/SETUP.md`: deployment (Docker Compose, Nginx Proxy Manager, Tailscale, `.env`)
- `docs/DESIGN.md`: the ARKS color spec and which palette each page uses
- `docs/NOTES.md`: current status and open to-dos. Keep it up to date.

@docs/NOTES.md

## How we work

- **American English everywhere**: UI text, comments, docs, commits, identifiers.
  British spellings are filtered only from word lists and spelling games
  (`words/british.txt`). Never reword real titles, names or quotes (trivia keeps
  "Fifty Shades of Grey").
- **Branch, then PR to `main`.** Never commit to `main` directly. Claude opens the
  PR, waits for CI, and once every check is green merges it and deletes the
  branch (`gh pr merge <n> --merge --delete-branch`), then tells the maintainer. If a
  check fails, fix it or say so; never merge red.
- **`npm test` is the gate.** Run it before committing; CI runs the same thing
  plus a Docker build.
- **Local test server: port 3001**, not the default 3000:
  `PORT=3001 npm start` (PowerShell: `$env:PORT=3001; npm start`).
- **Releases** are a git tag; CI publishes the image to GHCR and the server
  pulls it (see `CONTRIBUTING.md`).
- **Keep it embeddable.** The arcade will also be linked from a family
  dashboard (a separate private project). Use relative URLs, no hard-coded
  host, and keep the home page and game lobbies easy to link to.
- **No secrets in the repo.** `.env` is gitignored; `.env.example` documents
  every setting.

## Text people read

Everything players and readers see (game screens, docs, PRs, commits) should
sound like a person explaining it to a friend: full sentences, everyday words,
and no term the page hasn't explained. The full rules and examples are in the
private `arks-internal` repo, `conventions/writing.md`.

## ARKS ID (shared family sign-in)

- The contract lives **only** in the private `arks-id` repo, `docs/SPEC.md`
  (local clone: `../arks-id`). It's versioned. Don't copy it into this repo.
- Before any ARKS ID work: `git -C ../arks-id pull`, then read the SPEC.
- Contract changes go through a PR in `arks-id` that bumps the version, and
  get messaged to the other sessions. Never change it on the arcade's side only.
- `docs/NOTES.md` records which contract version the arcade is built against.

## Decisions already made (don't reopen unless the maintainer does)

- **No server-side AI.** Themes, theme packs, trivia and Spin & Solve packs
  come from a "copy prompt, paste into any chatbot, paste the answer back"
  flow. Automatic AI generation was considered and turned down: it costs money
  and opens an abuse surface on an internet-facing server.
- **The server decides every score.** Clients never send their own score.
- **The adult word list is deliberately uncensored.** Don't soften it.
  `words/blocklist-kids.txt` is what protects the kids list.
- **Celebrations, yes; fake near-misses, no.** The look we want is
  modern Las Vegas slot-game energy: confetti, coin showers, big win banners.
  But a "so close!" must always be real (the ladder climbs the actual
  leaderboard).
- **Built for family and parties.** Adult games and levels are wanted (with a
  raunchiness scale), and they're listed openly on the Join a game board so
  guests can get in easily. Kids are kept out by the adult PIN and a per-lobby
  password the host makes up, not by hiding things. When in doubt, make joining
  easier for guests, not harder.
- **Every game has a How to play section** that can be reopened mid-game. New
  games need one too.
- **The repo stays public.** Making it private was considered and turned down.
  So the defaults are generic (`ARCADE_NAME` blank), and the maintainer's own setup
  lives in their `.env`.
- **The daily board is seeded by the date alone**, and the kids and unfiltered
  dictionaries are deliberately not made equal (standings tag each row).
- **Theme-pack words must be short**: board geometry makes 7+ letter words
  essentially unreachable (numbers in the README).

## Naming traps (each one has caused a real bug)

- `playerId` means a player in a round or a room member. A profile is always
  `profileId`.
- In the Rambler client, `S.players` is the pass-and-play roster and
  `S.profiles` is the profile list. Keep them separate.
