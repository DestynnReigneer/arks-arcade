# Status and to-dos

Last updated 2026-11-01. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here. When the
maintainer says "I'm back", start from "Last session" below, then show the
to-do list as checkboxes (the rule is in the maintainer's global CLAUDE.md
and `arks-internal/conventions/sessions.md`): do the checked items in the
order they were clicked, and keep the rest pinned here.

## Status reports to ARKS ID (2026-11-01, contract v12)

- **With ARKS ID on, the arcade reports how it's doing every five minutes** (the first
  one a few seconds after it starts): the version, commit, build date and Node version,
  how long it has been running, the size of its database, and the free and total disk
  space where its data lives. It goes to `POST /api/app/status` through the shared kit's
  new `kit/status-report.js` and the client's `appReport()`. ARKS ID shows it on the
  status page of its admin console, and marks the arcade "not reporting" after 15 quiet
  minutes.
- The arcade's admin page still opens with its own password, so it doesn't send the
  "console opened" events the Hub sends. Nothing changes in `.env` or the compose file.
- Tests: the ARKS ID suite waits for the first report and checks its numbers;
  `test/fake-arksid.js` takes reports and events (`fake.reports`, `fake.events`).

## Clueless, the daily crossword (2026-11-01)

The "small daily crossword" from the to-do list. Its id is `clueless` (page `public/clueless.*`,
admin side `public/admin-clueless.js`, server `clueless/`, accent periwinkle `#9d8cff`, emoji 📰).
The name rhymes with Wordless, the arcade's first game, and is what you are before you read the
clues.

- **Two crosswords a day**, seeded with `clueless|<date>|<level>`: the **Family mini** (`mini`,
  5 by 5, family clues only, words up to 5 letters) and **Grown-ups** (`big`, 7 by 7, family and
  grown-up clues, grown-up ones picked first). 7 by 7 rather than 9 by 9 because it fits a phone
  with big squares and fills reliably from a modest clue list. No unfiltered crossword: there are
  no adult clue packs, and adding them would need their own gated level.
- **Grids** (`clueless/grid.js`, no database): six hand-picked shapes per size (every word 3+
  letters, every square checked both ways, symmetric, in one piece; picked by trying every
  symmetric shape against the built-in clues and keeping the ones that fill most often), filled
  by backtracking with the most-constrained spot first, words in a date-seeded order, no repeats,
  a try budget per shape. `maker.js` adds the clues (seeded pick when a word has several).
  `puzzles.js` builds from every clued word, falls back to the built-in clues alone, and saves
  the result in `clueless_puzzles`, so a day's puzzle never changes once made (packs added or
  deleted mid-day only affect tomorrow). The built-in clues filled every shape on 1,100
  consecutive days in testing, in at most about half a second.
- **Clues:** `clueless/starter-clues.txt` has about 1,000 hand-written family clues (3 to 7
  letters, weighted toward crossword-friendly letters, because the first few hundred common words
  couldn't fill a 7 by 7). Clue packs come from the admin's Clueless tab: copy the prompt (a batch
  of words from `common-10k.txt` without a clue of that kind yet), paste the chatbot's `WORD: clue`
  lines (JSON works too). `clueless/clues.js` checks each one: on the family list, 3-7 letters,
  not British, clue 3-80 characters, the answer (or a word starting with it, or a 4+ letter word
  it starts with) not in the clue, and no clue word that only the unfiltered list has (that's the
  kids blocklist and the adult supplement). The same rules apply to grown-up clues, since that
  crossword isn't behind the adult PIN. Tables `clueless_packs` and `clueless_clues`.
- **Scoring** (`clueless/routes.js`, tables `clueless_runs` and `clueless_scores`), built like
  Sudoku's: the start time on the server, a 32-hex run id, pause and resume, the page never gets
  letters until the finish (Reveal returns only the asked-for squares, logs them in
  `revealed`, and they come back on reload). Check costs 5/10/20 seconds (square/word/puzzle),
  Reveal 15 seconds a letter, counted once per square. Finish checks the grid and refuses
  anything under 0.3 seconds per square typed (`CLUELESS_MIN_MS_PER_SQUARE` for the test suites
  only). First finish per player per day per crossword counts (`UNIQUE (day, level, who)`); one
  run per profile per day. `GET /test/answer/:id` exists only under `NODE_ENV=test`, for the
  browser test.
- **The page:** clue bar above the grid (tap to switch direction, arrows step through clues),
  Check and Reveal menus, Pencil, a direction switch, a QWERTY keyboard on phones (narrow screens
  or touch), the real keyboard everywhere, and Across and Down lists under it. At 390 by 844 the
  clue bar, the grid and the keyboard all fit on screen (the browser test checks). Progress is
  kept on the device by run id. Leaving the page or opening How to play pauses it.
- Wired into the home card, the QR picker, the admin game switches and stats, feedback, the dust
  sign, Comm Center posts (fastest-ever time per crossword), its own music in `public/blip.js`,
  the Dockerfile, the Playwright page list and a browser test that solves the mini through the
  page.
- Not done: no removing a single time from a board (no game has that yet), no adult crossword,
  and no "reveal the whole puzzle" (a finish after that wouldn't mean much).

## Criss Cross (2026-11-01)

The crossword tile game from the to-do list ("a crossword"), built for playing on everyone's
own phone over days. Its id is `crisscross` (page `public/crisscross.*`, server `crisscross/`,
accent coral `#ff7a59`, emoji 🔡). Our own name, board, bonus pattern and tile bag.

- **Rules** (`crisscross/engine.js`, no database): an 11 by 11 board (fits a phone) with our
  own symmetric bonus pattern (3W corners, 2W diagonals and the star, 2L and 3L scattered), a
  66-tile bag (two blanks; values 1 to 10, balanced for our lists), racks of 7, +40 for all
  seven, swap needs 7 in the bag, six scoreless turns end the game, the usual leftover-tile
  adjustments at the end. Two-letter words come straight from `enable1.txt` (the dictionary
  tree only holds 3+), with British spellings and the kids blocklist applied the same way.
- **Games** (`crisscross/games.js`, tables `crisscross_games` and `crisscross_seats`): the whole
  game is one JSON blob that never leaves the server; `view()` builds what one player may see
  (their own rack, the bag as a count). `turn_profile` makes "your turn" counts cheap. Online
  games are profiles only (`X-Profile-Token`); pass-and-play games get a device key
  (`X-Game-Key`, stored hashed) and are open to guests. Waiting games and untouched local games
  are swept after 14 and 30 days.
- **Adult rules:** an unfiltered game needs the adult PIN or pass on every request, from every
  player; with ARKS ID on, invitees must be grown-ups' accounts and so must whoever asks.
- **The computer** (`crisscross/bot.js`): greedy, best score along every row and column via the
  dictionary tree, no blanks, main word 3+ letters. A whole bot-vs-bot game takes well under a
  second.
- **"Your turn"**: the home card gets a badge (`GET /api/crisscross/turns`, every minute), and
  the game's list shows whose turn, the last move and when. An open game polls every 8 seconds.
  No push nudges: ARKS ID's contract (v12) has no short-message channel (the clip inbox is for
  media clips), so none were added.
- Wired into the home card, the QR picker, admin switches and stats, feedback, the dust sign,
  its own music in `public/blip.js`, the Dockerfile, the Playwright page list and a browser
  test that places a first word. The stats `visit` limit is 2000 under `NODE_ENV=test`, because
  the browser suite now opens more pages from one address than the old 120 allowed.
- Not done: no Comm Center post for a big score, no chat (on purpose), no time limit on a turn,
  and the computer can't sit in an online game.

## Shuffle Scuffle (2026-11-01)

The word scramble from the to-do list, built as a timed race: everyone gets the same 6 or 7
mixed-up letters, races to find the word they spell (the full word), and scores for every
smaller word inside it too. Several rounds a game. Its id is `scuffle` (page
`public/scuffle.*`, server `scuffle/`, accent lime `#b6ff3b`, emoji 🔀).

- **Letters** (`scuffle/game.js`): the full word comes from `words/common-10k.txt` (6 and 7
  letters, read in file order), and must be on the kids list and have at least 8 words
  inside it. Unfiltered rounds hide a word from `words/spice-adult.txt` about 3 times in 10.
  Words inside the letters are found by walking Rambler's dictionary tree with letter
  counts, so the kids list (and `blocklist-kids.txt`) decides what kids can score. Any word
  using every letter counts as the full word. `game.js` has its own copy of the mulberry32 and
  FNV seed code so it can be loaded without opening the database (the browser test loads it).
- **Daily:** 4 rounds of 75 seconds (6, 6, 7, 7 letters), seeded with `scuffle|<date>` and
  always picked from the kids list, so the letters are the same whichever list is chosen; the
  list only changes which smaller words count, and board rows carry `dictionary`. Saved in
  `scuffle_scores` (`UNIQUE (day, who)`); a profile gets one daily per day
  (`scuffle_daily_plays`; reopening carries on while the game is still in memory).
- **Scoring** is all on the server: solo games live in memory (`scuffle/solo.js`, 3 hours),
  rooms in `scuffle/rooms.js`. Each round's clock starts on the server; words are checked
  there (letters, list, not already found) with 1.5 seconds of grace after the clock, and
  the round's words are only sent once it ends. Points: 10/20/35/60/90 by length, +100 for
  the full word, +50 for the first in a room. `SCUFFLE_TEST_SECONDS` allows 2-second rounds
  for the test suite only.
- **Rooms:** the same four-letter codes and Join a game board as the others, up to 12
  phones, host picks rounds, seconds and list. Latecomers can join mid-game. "I'm done" ends
  the round early once everyone connected is done. The unfiltered list needs the adult PIN
  or pass to host, and a lobby password to join.
- Wired into the home card, the QR picker, admin switches and stats, feedback, Comm Center
  posts (a new best daily score ever), its own music in `public/blip.js`, and the
  Playwright page list plus a browser test that finds a word.
- Not done: no "share a phone" (local) mode, since a race on one phone doesn't work well;
  free play has no board (the letters differ every game); the host can't change settings
  from the lobby screen yet (the API has `/rooms/:code/settings`).

## Sudoku (2026-11-01)

The maintainer picked Sudoku as the next game: the classic 9x9, a daily puzzle everyone
shares, Family, Easy, Medium and Hard, pencil marks, fastest-time boards, and phones first.

- **Puzzles** come from `sudoku/generator.js`, our own code: a seeded full grid (the same
  mulberry32 as the Rambler daily, seeded with `sudoku|<date>|<level>|<try>`), then
  numbers taken away in mirrored pairs while there's still one answer. Grading tries the
  puzzle like a person would: tier 1 is naked singles, tier 2 adds hidden singles, tier 3
  adds pointing/claiming and naked and hidden pairs, tier 4 is "tier 3 gets stuck". Family
  must be tier 1 with at least 46 numbers, Easy tier 2 with at least 36, Medium exactly tier
  3 (at least 27), Hard tier 4. A try that doesn't fit is thrown away and the next try is
  made, still from the date, so everyone gets the same puzzle. A day's four take a few
  milliseconds; `sudoku/routes.js` keeps them in memory.
- **Scoring** (`sudoku/routes.js`, tables `sudoku_runs` and `sudoku_scores`): Start records
  the start time on the server and returns a 32-hex run id and the puzzle (never the
  answer). Pause and resume are recorded there too. Finish checks the full grid against the
  answer and works out the time; anything the browser sends as a time is ignored. A finish
  faster than 0.4 seconds per square left to fill is refused (`SUDOKU_MIN_MS_PER_SQUARE`
  shortens that for the test suite only). Hints add 30 seconds, Check 15, and each wrong
  number caught by "Show my mistakes as I go" 10. Only the first saved finish per player per
  day per level counts (`UNIQUE (day, level, who)`, who being the profile or the guest's
  initials), and a profile gets one run per day per level, so reopening carries the clock on.
- **The page** (`public/sudoku.html`, `.js`, `.css`): a cover with Start (so the clock
  doesn't start while someone reads How to play), the board, Undo, Erase, Notes, Hint and
  Check, and a row of nine number buttons. Leaving the page pauses the run. Progress lives in
  this device's storage, keyed by run id. Opening How to play mid-puzzle pauses it.
- Wired into the home page card, the QR picker, the admin game switches ("Pardon our
  dust"), stats, feedback, Comm Center posts (a new fastest-ever time per level) and the
  Playwright page list. It has its own calm music in `public/blip.js`.
- Not done yet: the admin can't remove a single Sudoku time from a board (no game's
  arcade-wide board has that yet either).

## Feedback goes to ARKS ID's one inbox (2026-11-01, contract v10)

- **With ARKS ID on (`ARKS_ID_URL` set), new feedback isn't kept in the Comm Center.**
  The card and `POST /api/comm/feedback` work as before (same checks and limits), then
  `arcade/comm.js` passes the note on to ARKS ID (`POST /api/app/feedback`) through the
  shared kit's `kit/feedback-relay.js`. Kinds map issue to broken and feature to idea;
  the game and the device ride along as the arcade's own facts (`extra`). The sender is
  the signed-in ARKS ID account (from the cookie, never the browser), or the name a guest
  typed. ARKS ID pings Discord, so the arcade doesn't.
- **ARKS ID away:** the note waits in `feedback_outbox` and goes again every minute; the
  sender is told it arrived either way. **ARKS ID older than v10** (it answers 404): the
  note is kept in the Comm Center as before.
- **My feedback** (`POST /api/comm/mine...`) asks ARKS ID with the person's ARKS ID
  session, so the admin's replies show up here. ARKS ID's stages map back to the arcade's
  statuses: New is `new`, Seen is `pending`, Pending is `in-progress`, Fixed is
  `completed`, and Won't fix is `canceled` (ARKS ID added Won't fix for this).
- **The admin page** says feedback lives in ARKS ID's admin console, with a link that
  opens it in a new tab, and how many notes are waiting to go. The Comm Center's older
  notes stay as a read-only archive: status, replies and delete are refused (409), but
  the note to self still saves. Nothing was moved or deleted.
- **Without ARKS ID** (public self-hosted copies), the Comm Center inbox works exactly as
  before.
- Tests: the ARKS ID suite (`test/arksid.test.js`), against `test/fake-arksid.js`, which
  gained the inbox. The "pictures folder full" checks there run with the pretend ARKS ID
  acting like one without the inbox, so they still cover the Comm Center's own storage.

## The shared kit (2026-11-01)

- Shared code now comes from one kit kept in the private repo (`../arks-internal/kit`).
  `kit/version.js` and `kit/burst-limit.js` replace `arcade/version.js` and
  `arcade/burst-limit.js`; `kit/security.js` and `kit/feedback.js` hold the shared
  parts, and `arcade/security.js` and `arcade/feedback.js` keep what's the arcade's
  own (its CSP, its looser `TRUST_PROXY` reading, picture storage, the 413 for a big
  picture). `public/dock.js`, `public/snapframe.js` and `public/avatars.js` are kit
  copies at the same paths as before.
- `kit/kit.json` records the kit's commit and a fingerprint for each file, and
  `npm test` runs `scripts/check-kit.js` first, so CI fails if a kit file is edited
  here. Change them in the kit, run its sync, and open a PR here. The Dockerfile copies
  `kit/` into the image.
- Messages that changed while the copies were made to agree: the profile's wait says
  "in a short time" instead of "in a few minutes", the no-profile wait ends "this one
  has sent them all", and the picture-too-big message uses the shared words.

## Which version is running (2026-11-01)

- `kit/version.js` (part of the shared kit) reads the version (package.json), the commit (`GIT_SHA`), the
  build date (`BUILD_DATE`) and Node's version once at startup. `/healthz` returns them
  alongside what it already said, and the admin page shows one quiet line at the bottom
  from `GET /api/admin/version` (admin only), the commit linking to GitHub. Players never
  see it. Feedback's "which build" uses the same module, so its commit is now 7
  characters instead of 12.
- CI also labels every image `sha-<commit>` and passes the build date in. Rolling back
  is in `CONTRIBUTING.md`.
- Worth a look later: `/healthz` still runs the Rambler season check and a forced theme
  pack refresh on every call (lines that slipped in there back in #6 and #7). It
  works, but it isn't as cheap as it could be for a dashboard that polls it.

## Review fixes and browser tests (2026-11-01)

- **#65** Who's playing? keeps keyboard focus inside its card, marks the rest of the
  page `inert` while it's open, and gives focus back when it closes. With ARKS ID on,
  every game page asks too (`ArcadeProfile.askIfNobody()`, called from `topbar.js`;
  the home page calls it from `hub.js`).
- **#65** Feedback limits shared with the other apps: pictures at most 1.5 MB (the card
  shrinks screenshots to fit), 500 MB of pictures in all (past it, notes arrive without
  their picture and the admin gets one note in the Comm Center, flag
  `feedback_pictures_full_flagged` in settings), and 5 notes an hour from one device
  for people without a profile. Profiles keep 30 in 3 minutes; the admin has no limit.
- **#65** ARKS ID photos and team pictures: the server fetches them from ARKS ID and
  serves them at `/api/arksid/photo/<profile>` (only to people signed in with ARKS ID
  and the admin). A profile's avatar is then `photo:<profile>:<version>:<icon>`, drawn
  by `public/avatar-photo.js` (kept out of the shared `avatars.js`), and the icon
  shows whenever the picture can't load. The address checks are in
  `arcade/arksid-photo.js`.
- **Browser tests** (`npm run test:browser`, Playwright, a dev dependency only): every
  page loads cleanly at phone and laptop size, Who's playing? can't be skipped, and a
  guest can't open adult levels. CI runs them as their own job. See `CONTRIBUTING.md`.

## Feedback tracked like GitHub issues (2026-11-01)

The maintainer chose this for all their apps. In the arcade:

- **Statuses** keep their stored names but read New, Seen, Pending, Fixed and Won't fix
  (`new`, `pending`, `in-progress`, `completed`, `canceled`). Opening an item's replies
  in admin marks a new one Seen. Fixed and Won't fix move to the sender's Archive; a
  reply from the sender after that puts it back as Seen.
- **Replies** both ways (`comm_feedback_replies`). The admin's "note to self" stays
  private, as before.
- **Each side's own copy:** `admin_hidden` and `sender_hidden`. Admin's Delete is
  "Delete for me"; it's gone for good once both deleted it, or when it came from someone
  with no profile.
- **My feedback** in the Who's playing? card, for a profile: Open and Archive lists,
  the thread, a reply box, Edit (until it's done) and Delete my copy. Its calls are
  `POST /api/comm/mine[/:id[/reply|/edit|/delete]]` with the profile's token in the
  body, never in the address.

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

- `public/dock.js` does the shrinking and fading. It comes from the shared kit, so change
  it there, not here.
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
- **Start a new game:** a crossword or a cabinet-style game (the list is in the
  private feedback list). Sudoku, Shuffle Scuffle (the word scramble), Criss Cross (the
  crossword tile game) and Clueless (the daily crossword) were built on 2026-11-01.
- **Achievements step 1:** waits for the maintainer's markup of the private
  plan. Then build step 1 (age groups, the feats engine, Rambler milestones
  moved over).
- **Node 26:** after 2026-10-28, move to an exact Node 26 version. The
  `body-parser` warning was patched with `npm audit fix` instead of Express 5
  (2026-10-25), so Dependabot #3 closed as replaced; Express 5 can come later
  as its own change.
- ~~**Get Claude in Chrome connected**~~: done. It was used on 2026-11-01 to check
  the review fixes, and the Playwright browser tests now run in CI as well.

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
  sign-in and passkeys). **Built against ARKS ID contract: v12** (2026-11-01): status
  reports for ARKS ID's admin console (see the top of this file). Before that, v10
  (2026-11-01): feedback goes to ARKS ID's one inbox. Before that, v8 (2026-10-28): silent
  sign-in (at most once an hour, `/auth/signin?silent=1`, so someone signed in to ARKS ID
  elsewhere is signed in here with no tap). Before that, v7 (2026-10-26):
  sign-in, `/device` for guest play, `boardName`, the clip inbox, avatars from
  the account (`avatar.art`, or the icon as `arks:<icon>:<color>`), and
  handing a guest's name and avatar to sign-up (`/api/prefill`).
  `public/avatars.js` comes from the shared kit, like the other apps' copies, so
  change it there and sync it over.
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
