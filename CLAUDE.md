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
