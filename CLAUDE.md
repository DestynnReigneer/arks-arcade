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
  PR; the owner reviews and merges it themselves.
- **`npm test` is the gate.** Run it before committing; CI runs the same thing
  plus a Docker build.
- **Local test server: port 3001**, not the default 3000:
  `PORT=3001 npm start` (PowerShell: `$env:PORT=3001; npm start`).
- **Releases** are a git tag; CI publishes the image to GHCR and the homelab
  pulls it (see `CONTRIBUTING.md`).
- **Keep it embeddable.** The arcade will eventually sit inside the ARKS Family
  Hub (a separate repo, `arks-family-hub`). Use relative URLs, no hard-coded
  host, and keep the home page and game lobbies easy to link to.
- **No secrets in the repo.** `.env` is gitignored; `.env.example` documents
  every setting.

## Decisions already made (don't reopen unless the owner does)

- **No server-side AI.** Themes, theme packs, trivia and Spin & Solve packs
  come from a "copy prompt, paste into any chatbot, paste the answer back"
  flow. Automatic AI generation was considered and turned down: it costs money
  and opens an abuse surface on an internet-facing server.
- **The server decides every score.** Clients never send their own score.
- **The adult word list is deliberately uncensored.** Don't soften it.
  `words/blocklist-kids.txt` is what protects the kids list.
- **Celebrations, yes; fake near-misses, no.** Confetti, coin showers and big
  win banners are welcome, but a "so close!" must always be real (the ladder
  climbs the actual leaderboard).
- **The daily board is seeded by the date alone**, and the kids and unfiltered
  dictionaries are deliberately not made equal (standings tag each row).
- **Theme-pack words must be short**: board geometry makes 7+ letter words
  essentially unreachable (numbers in the README).

## Naming traps (each one has caused a real bug)

- `playerId` means a player in a round or a room member. A profile is always
  `profileId`.
- In the Rambler client, `S.players` is the pass-and-play roster and
  `S.profiles` is the profile list. Keep them separate.
