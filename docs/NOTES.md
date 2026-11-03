# Status and to-dos

Last updated 2026-11-02. Update this file whenever a piece of work lands or
a plan changes, so the next session can pick up from here. When the
maintainer says "I'm back", start from "Last session" below, then show the
to-do list as checkboxes (the rule is in the maintainer's global CLAUDE.md
and `arks-internal/conventions/sessions.md`): do the checked items in the
order they were clicked, and keep the rest pinned here.

## Back goes one screen back (2026-11-02)

The maintainer asked for a Back that backs out of a screen: inside a game, Back used to
leave for the arcade instead of going back to that game's menu.

- **`ArcadeBack` in `public/topbar.js`** (every game page loads it). A game calls
  `ArcadeBack.setup({ atMenu, back, busy, pause, question })` at the end of its script:
  `atMenu()` says it's on its first screen (its menu or setup), `back()` goes one screen
  back, `busy()` says leaving would end a game in progress, `pause()` (optional) holds the
  game while the question is up. The comment at the top of the module has the details.
- **How it works:** while a game isn't on its menu there's one extra entry in the
  browser's history for the page (`history.pushState`). The phone's or browser's Back
  uses it up (`popstate`) and the game goes one screen back; if it's still not on its
  menu, the entry goes back in. When a game returns to its menu by itself (its own "Back
  to setup" button), the entry is taken away again (`history.back()`), so one Back from
  the menu always leaves for the arcade. A reload in the middle of a game steps off the
  leftover entry. The screen is checked after every change on the page (a
  MutationObserver) and every 400ms. Criss Cross's `setUrl` keeps the history entry's
  state when it changes the address.
- **The top bar's back arrow** does the same while a game isn't on its menu (it reads
  "Back" there, "Arcade" on the menu); on the menu it's still the plain link home.
- **Leaving a game in progress asks first** on the page: on a TV, `ArcadeTV.confirm()`
  (Keep playing / Leave); elsewhere a card in the top bar's colors (`.ab-confirm`), never
  the browser's own confirm box. A second Back while it's up answers "Keep playing".
- **The TV:** the TV app turns the remote's Back into the browser's Back
  (`web.goBack()`), so it follows the same rule. A `GoBack` or `BrowserBack` key, and
  Escape on a TV when the game didn't use it (Snake and Block Drop pause on Escape), go
  back too.
- **Game by game:** the classics and the cabinet games go back to their start (Snake,
  Block Drop, Brick Breaker, Tower Defense, Dino Dash, Disco Drop, Moonshot, Roll Royale,
  Tumbler Rumble); Sudoku and Clueless pause the puzzle (progress is kept, so nothing is
  asked) and Back from there leaves; Chess, Know-It-All, Dare Devil, Uh-Oh: Part Deux,
  Spin & Solve, Shuffle Scuffle and Rambler go back to their setup (leaving a room on the
  way); Criss Cross goes back to your games (games are kept, nothing is asked). Wordless
  has no menu screen, so Back there still goes to the arcade. Disco Drop, Roll Royale and
  Tumbler Rumble don't show a run's results if Back took them to the start while the
  server was still counting.
- **Tests:** `test/browser/back.spec.js` (Snake asks first, then the menu, then the arcade;
  Chess, Criss Cross and Know-It-All step back through their screens; a reload mid-game)
  and two TV tests at the end of `test/browser/tv-games.spec.js` (the remote's Back in
  Snake with the TV's card, and Escape in Chess).

## "Your games" on the home page move slowly (2026-11-02)

The maintainer found that a game played once jumped up the home page's list, and the
games they actually play a lot got pushed around. The order is now damped
(`arcade/game-order.js`, used by `gameOrder` in `arcade/stats.js`):

- **A play** is a visit to a game with at least 20 seconds on screen. Only the first
  three plays of a game on one day count, so one long evening doesn't outweigh weeks of
  steady play. Each play loses half its weight every 14 days, and plays older than 120
  days aren't read at all.
- **A game only moves up past the one right above it** when its score is more than 1.25
  times that game's plus 1.5. One play is worth at most 1, so a single play never moves
  a game on its own, and a game played a few times can't leapfrog one played many
  times. Games that are close keep the order they already had.
- **The list starts from what the page showed last time.** `public/hub.js` keeps the
  order it got in the browser's storage (one per profile, plus one for guests) and
  sends it back as `previous` with `POST /api/stats/game-order`; the server only checks
  it's a list of games it knows. Without one, the start is the admin's order, moved by
  everyone's plays. With a profile, its own plays decide; without one, everyone's do.
- **Tests:** the rule is in `test/unit.test.js` ("the home page's game order moves
  slowly"): one play doesn't jump past a game played 10 times, steady daily play passes
  it on the tenth day, and the per-day cap and half-life. `test/api.test.js`
  checks the endpoint end to end.

## Tumbler Rumble goes endless, and Spin & Solve follows the show (2026-11-02)

Fixes from the maintainer playing both games, with the sound off.

- **Tumbler Rumble is one endless run** (`public/tumbler-engine.js`). There are no more locks that
  open and start over: every pop turns the light around and lights the next pin at once, the run
  goes on until the first miss or slip, and the score is the number of pins popped. Difficulty
  comes in waves of 10 (`difficulty(pops)`, 0 to 1): 7 pins harder, 3 easing off, each wave starting
  and peaking 0.08 harder than the last (peak `0.16 + 0.08 x wave`, start 0.2 below the peak). It
  sets both the speed (130 to 320 degrees a second) and the pin's half-width (16 to 9 degrees); a
  bullseye is the middle third. From about pin 110 the waves swing between 0.8 and 1. The server's
  replay is the same engine, so `/finish` returns `score` (pins), `wave`, `bullseyes` and
  `bestStreak`; `tumbler_runs.level` and `tumbler_scores.level` hold the wave and `pins` the pops.
- **Old scores are kept but off the boards:** both tables gained `rules` (1 for the old points
  scores, 2 now). The boards and ranks only read rules 2, and a run started before the change can't
  be finished or saved. The admin page's Boards tab still lists every row (it doesn't know about
  `rules`), so the old scores show there and can be removed by hand if wanted.
- **A real 3, 2, 1 countdown** (`LEAD_MS` 3000, `COUNT_MS` 1000) on the lock and on the POP!
  button, which says Start before a run, is dimmed and disabled through the countdown, and lights
  up at Go. A press during the countdown does nothing.
- **Sound off:** every Tumbler sound has a visual: the lock glows on a pop, a bullseye, Go and a new
  wave, turns red on a miss, wave news ("WAVE 3", "EASING OFF") shows across the top of the lock,
  and the HUD has a Pace box (Harder or Easier).
- **Spin & Solve's clock follows the show:** it no longer runs while a player decides what to do,
  so nothing ticks before the first spin. It runs only when an answer is owed: after the wheel
  stops (call a letter), when buying a vowel, and when solving; backing out of the vowel or solve
  box stops it. The rest of the turn flow already matched the show (a wrong letter, a wrong answer,
  Bankrupt and Lose a Turn pass the turn; a vowel costs $250 and earns nothing; only the solver
  banks, at least $1,000).
- **Spin & Solve sounds, our own** (new in `public/blip.js`: `ding`, `buzzer`, `tick`, `sting`,
  `fanfare`, all synthesized): a bell-like ding per letter, a low two-tone buzzer for a miss, a wrong
  answer or time running out, a noise click per peg, a falling Bankrupt sting and a brassy solved
  fanfare. None of the show's recordings or music are used. Each has a visual too: the board flashes
  red with a big ✕ over the wheel for the buzzer, and Time's up and Solved show over the wheel.
- **Tests:** `test/tumbler.test.js` rewritten for the endless rules and the waves,
  `test/browser/tumbler.spec.js` checks the dimmed countdown and three pops, the TV test checks the
  pop count, and the new `test/browser/spinsolve.spec.js` checks the clock waits for the first spin.
- **Left for later:** Spin & Solve's score is still sent by the page (the older shared board,
  `/api/scores/spinsolve`), so it isn't decided by the server the way the newer games' are. Making
  it server-decided needs the game to run on the server, which is the same work as the TV rooms
  noted under "The puzzles and Spin & Solve on the TV".

## The cabinet games and the classics on the TV, with controllers (2026-11-02, contract v14)

Tumbler Rumble, Disco Drop, Roll Royale, Moonshot, Snake, Dino Dash, Block Drop, Brick Breaker, Tower
Defense, Sudoku and Chess (against the computer, or two players sharing the remote) play on the TV with only
the remote, or with a game controller. Nothing changed on the server: the replay games still send only
their inputs, and the server still decides every score.

- **`public/tv-play.js` and `tv-play.css`** (new, loaded by these eleven pages after tv-core.js and tv.js in
  their head). `TvPlay.setup({ stage, steering, active, begin, ready, start, enter, buttons, navButtons,
  dirs, hint })` is called at the end of each game's script. On a TV (`html.tv`, which adds `html.tv-play`)
  the `stage` is moved into a fixed `.tv-stage` on the right of the screen, drawn at the TV's own size
  (`zoom: 0.666667` undoes tv.css's 1.5x, so canvases are sharp), and the rest of the page is a 470px
  column on the left (phone width, drawn 1.5x). The TV bar moves under the left column. The phone's thumb
  pads and keyboard notes hide; a TV line says what the remote and a controller do; `begin` adds a big Play
  button (shown while `ready()`).
- **Who has the remote.** While `steering()` is true the game gets the arrows and OK and nothing wears the
  highlight; otherwise `data-tv-nav` is on and tv.js moves the highlight, and tv-play stops the arrows and OK
  from also reaching the game (so a menu press can't start or steer it). A dialog (How to play, the scores)
  always takes the highlight. `enter` turns OK into the game's own key while steering (Space in Snake, Block
  Drop, Brick Breaker and Dino Dash). The state is checked every 100ms, on every key press, and right after
  anything on the page changes (a MutationObserver); that last one closed real races where a press landed
  in the moment between a screen changing and the timer noticing. On a new screen with nothing highlighted
  the highlight goes straight to `start()` or, by default, the first initial, the Play button, then Play
  again.
- **The games keep the remote until their game-over panel is up** (Snake, Block Drop and Brick Breaker show
  it half a second after the crash), so pressing OK as a game ends can't reach the top bar's Arcade link.
- **Initials like an arcade cabinet** (tv-play.js, any `.initials input.ini` on these pages): up and down
  change the letter (A to Z, then 0 to 9), left and right move between the three (right from the last goes
  to Save), OK saves. `inputmode="none"` keeps Android's keyboard away; typing on a real keyboard still works.
- **On a TV the score goes under the initials, not the TV's account** (the TV is signed in as itself, not as
  whoever has the remote). The cabinet games and Sudoku start and save as a guest there (`token()` is null on
  a TV), GameShell, Dino Dash and Chess pass `profileToken: null`, and `ArcadeKit.wireInitials(boxes, onEnter,
  { guest })` keeps the boxes showing. `ArcadeKit.saveScore` honors a `profileToken` in the entry; without one
  it works as before, so the other games are unchanged.
- **Game by game.** The cabinet games keep their own controller code for A and Start and add X, R1 and the
  right trigger (Roll Royale: X and R1 held; its own code already had the trigger). Tower Defense: the map
  takes the highlight like a button, the arrows move a turquoise cursor around it (off the edge, the highlight
  leaves the map), OK picks the square the same as a tap (`pickSquare`), and picking grass sends the highlight
  to the towers; a controller's X calls the wave, Y upgrades, L1 and R1 change the speed, Start pauses.
  Sudoku: the arrows move around the board as on a keyboard, OK opens a number picker beside the board (the
  numbers with how many are left, Erase, Notes, Undo, Hint, Check), and the pad and tools under the board
  hide. Chess: the squares are buttons, so the highlight moves square by square; a redraw keeps it on the same
  square, the board hides with the game section, and Host and Join (two phones) are hidden on a TV.
- **Controllers everywhere** (not only on a TV): tv-play.js reads the Gamepad API every frame and sends the
  game the keys it already knows (`buttons`, plus the D-pad and left stick as arrows with `dirs`). In the TV
  app A arrives as Enter and the D-pad as arrow keys, so those are skipped there. If the TV app ever turns the
  left stick into arrow keys too, tv-play notices real arrow keys arriving as the stick moves and stops
  sending its own.
- **Activity** (`ArcadeTV.played()`): when a game starts, then every 20 seconds while `active()` (the game is
  really being played, not paused or in a menu); tv.js passes it on at most once a minute.
- **Tests:** `test/browser/tv-games.spec.js`, one test per game at 1920x1080 with the TV app's user agent:
  the game fills the right side inside the safe area with no sideways scroll, it's started and played with
  only the arrow keys and Enter, a pretend controller (`navigator.getGamepads` replaced in the page) presses
  the other buttons, and Tumbler Rumble, Disco Drop, Roll Royale, Dino Dash and Block Drop save initials
  picked with the arrows. One TV is set up per worker and its sign-in reused (the arcade allows 30 new TV
  codes in 10 minutes), as the pretend ARKS ID's fourth TV account, `playroom` ("Playroom TV"). The pretend
  controller holds each change until the page has drawn two frames.
- **A flaky test fixed:** `test/browser/discodrop.spec.js` dropped the first ball by waiting for the jackpot
  moment and then pressing, but a press takes a while to reach the page (Playwright's tap checks the stage
  first; on a busy machine the ball let go 120 to 560 ms late, after the cup had passed). It now stops the
  page's clock (`page.clock`) a little early, waits until the arcade's own clock is past the moment, moves
  the page's clock to exactly that moment and drops while time stands still.
- **Left for later:** Moonshot's, Snake's, Brick Breaker's, Sudoku's and Chess's own save flows aren't
  driven to the end in the TV tests (they share the same initials code as the five that are). Per-controller
  seats (two controllers as two players) and Rambler with the remote are still open. The other helper's word
  games skip initials on a TV; they could use the same letter picker by loading tv-play.js.

## The puzzles and Spin & Solve on the TV (2026-11-02, contract v14)

The second half of the TV work for the word, board and party games (the first half is the next section).
These are all played with the remote alone; nothing changed on the server.

- **Wordless** (`public/app.js`): the arrows move along the keyboard on the screen and OK presses a key.
  The page's own key handler leaves Enter and the arrows to the highlight when it's on a button.
- **Clueless:** the arrows move the highlight around the grid, OK picks a square (OK again switches across
  and down), and the keyboard on the screen (shown on a TV, not only on phones) types into the picked
  square. Arrowing back up from the keyboard lands on the picked square, so passing over other squares on
  the way down doesn't change which one you type in. Start has `data-tv-start`, and the highlight starts on
  the first square to fill.
- **Criss Cross:** against the computer or the remote passed around. OK on a tile picks it up and sends the
  highlight to the board (next to the last tile put down, or the middle square). The highlight starts on
  your first tile. The board sits on the left with the tiles and buttons beside it. The games on everyone's
  own phone, which need a person's profile, are hidden on a TV; so is Zoom.
- **Spin & Solve:** the remote passed between one to four players. Solving types on a keyboard on the
  screen (the text box is read-only on a TV so Android's own keyboard doesn't pop up). The wheel sits on the
  left of the players and buttons, and the page keeps the puzzle in sight under the top bar.
- **All four:** How to play doesn't open by itself, confirm boxes use `ArcadeTV.confirm()`, adult themes and
  levels unlock with `ArcadeTV.adultPass()` and Back to family puts family mode back at once, a new word,
  puzzle, move or spin calls `ArcadeTV.played()`, and a solo score made on the TV without a profile doesn't
  ask for initials (there's no keyboard) and says to play on your own phone to get on the board.
- **Tests:** `test/browser/tv-puzzles.spec.js` at 1920x1080 with the TV app's user agent, using only the
  arrow keys and Enter: each page fits, a Wordless guess, moving and typing in Clueless, a first word
  against the computer in Criss Cross, and a spin, a letter and typing an answer in Spin & Solve. It sets up
  the pretend ARKS ID's third TV account (`kitchen`), so all the TV browser test files can run at once.
- **Left for later:** Spin & Solve and Criss Cross on everyone's own phone with the TV as the screen (both
  need new server-side rooms: Spin & Solve runs in the browser today, and Criss Cross's games on everyone's
  phone are per-profile games that can last days). Rambler with the remote (tracing words needs a finger).
  Per-controller seats.

## The party and word games on the TV (2026-11-01, contract v14)

Following Know-It-All's pattern, so read its section below first. Built against ARKS ID contract v14
(nothing new in the contract).

- **Which ways each game supports:** Uh-Oh: Part Deux: everyone on their own phone, and one phone passed
  around (no remote-only way, because the TV would show everyone's hand). Dare Devil: all three (phones,
  one phone passed around, the remote on the TV, which is the old one-phone game run on the TV). Shuffle
  Scuffle: everyone on their own phone, plus the daily letters and free play with the remote alone (the
  arrows move along the tiles). Rambler: everyone on their own phone only (tracing words needs a finger).
- **Screen hosts** in `arcade/party-tables.js` (Part Deux, Dare Devil), `scuffle/rooms.js` and
  `rambler/rooms.js`: `screen: true` makes the room with the TV as host and not a player, the same as
  Know-It-All. It can't start with nobody there, can't send words or moves, and its leaving ends the room.
  Snapshots say `screen` and `isScreen`.
- **Seats in the card games** (`party-tables.js`): `POST /rooms/:code/seats` and `/seats/remove` (lobby
  only, not the screen), `as` on `/act` (must be one of the phone's own players), and `mine` and `as` in
  the room's state. A phone holding several players gets only the hand of whoever's turn it is, and only on
  their turn, so passing the phone can't leak another hand; the page shows the old pass-the-phone cover
  first. A phone leaving takes its seats with it.
- **Kids' phones** (`arcade/adult-join.js`, wired up in `server.js` with ARKS ID on): joining a grown-ups
  room in all four games refuses a phone signed in as a kid, a teen or a TV, the same rule as Know-It-All's.
- **Pages:** each opts in with `<html data-tv-nav>` and loads tv-core.js and tv.js itself. On a TV the
  phone-only modes are hidden (`no-tv`), the TV ways show (`tv-only`), How to play doesn't open by itself,
  adult levels unlock with `ArcadeTV.adultPass()`, the TV makes up the lobby password, Back to family ends an
  adult game, and each move or round calls `ArcadeTV.played()`. `body.tv-screen` styles the screen view in
  each game's own CSS (not tv.css, so the two TV helpers didn't touch the same lines).
- **tv.js additions** (small and backward-compatible): the highlight stays in the same spot when a page
  draws its buttons again (a hand, a row of tiles) instead of jumping back to the start; `ArcadeTV.confirm()`
  is a yes-or-no card the remote can answer (the TV app's web view can't show `confirm()`); and
  `ArcadeTV.adultPass()` does adults' night and fetches the pass in one call.
- **Tests:** `test/tv-party.test.js` (the screen and seats in each room API), `test/tv-party-arksid.test.js`
  (adult rooms only during adults' night, kids' phones turned away in all four), and
  `test/browser/tv-party.spec.js` at 1920x1080 with the TV app's user agent (each page fits with the TV
  ways showing, and the TV hosts each game while a phone joins in its own browser and plays). The pretend
  ARKS ID gained a second TV account (`den`, "Den TV") so browser test files can each set up their own TV
  at the same time (setting a TV up again signs its old sign-in out); `/test/tv/approve` takes `as`.

## Know-It-All on the TV (2026-11-01, contract v14)

- **The TV layout** (`public/tv-core.js`, `public/tv.js`, `public/tv.css`): on when the user agent has
  `ARKS-TV/` (the TV app) or the address has `?tv=1` (remembered for the visit, `?tv=0` turns it off).
  `html.tv` draws the page at 1.5x inside the overscan safe area and hides hover-only things (the
  feedback bug, the Admin link). Pages that opt in with `<html data-tv-nav>` (the home page and
  Know-It-All) get the focus helper: the arrows move a turquoise ring to the nearest button in that
  direction (`TvCore.pick`, left and right stay in the row, the bars pinned to the top and bottom come
  after the page's own buttons), Enter presses it (and cycles a menu, ticks a checkbox), dialogs keep the
  ring inside them, and when the screen changes the ring jumps to `[data-tv-start]` or the first button
  outside the bars. Other game pages get tv.js through topbar.js for the sign-in and the adults' night
  sign, but not the arrow navigation (they use the arrows themselves).
- **Setting the TV up** (`arcade/tv.js`, ARKS ID only): `POST /api/tv/pair` asks ARKS ID for a code,
  keeps the pollToken in the server's memory (tied to the page by the `arcade_tvpair` cookie) and hands
  the page the code and a QR code picture. `GET /api/tv/pair` is polled by the page every 2 seconds; the
  server asks ARKS ID only every `interval` (and slows down when told to). On approved it trades the code
  at `/api/token` like a callback and sets the usual `arcade_me` cookie. `profile.js` skips the silent
  sign-in, the device check and the "Who's playing?" picker on a TV.
- **Adults' night:** TV accounts (`kind: "tv"`, a new `kind` column on `arcade_id_accounts`) have the
  kid role. arksid.js keeps each TV's `adultMode` in memory from the latest session check, and the adult
  pass works for a TV only while it's set (checked on every use, so Back to family stops it at once).
  `POST /api/tv/unlock` (code + QR), `GET /api/tv/state?waiting=1` (checks ARKS ID at most every 1.5 s
  while the code shows, otherwise every 20 s), `POST /api/tv/lock` (Back to family, local first), and
  `POST /api/tv/activity` (sent to ARKS ID at most once every 55 s; Know-It-All calls it on each new
  question). Losing touch with ARKS ID means family. The bar along the bottom shows the TV's name and
  Adults' night, or "Adults' night until 11:40 PM · unlocked by Kim" and Back to family.
- **Know-It-All's rooms** gained a screen host (`screen: true`, not a player), `style: 'together' | 'turns'`,
  seats (more players on one device; a seat has no token of its own), a `ready` phase before each turn,
  and `seat` on answers. In turns mode each player gets `count` questions (at most 100 in all) and only
  the player whose turn it is gets scored. The TV leaving ends the room; a device leaving takes its seats.
  An adult room now also turns away a phone signed in to ARKS ID as a kid, a teen or a TV (password or not).
  The TV makes up the lobby password for an adult room and shows it in its lobby.
- **Tests:** `test/tv.test.js` (detection, `TvCore.pick`, the three ways through the room API),
  `test/tv-arksid.test.js` (pairing, family by default, unlock, Back to family, activity, kid phone
  turned away), and `test/browser/tv.spec.js` at 1920x1080 with the TV app's user agent (home screen with
  only the arrows, Know-It-All to the end with the keyboard, a phone joining in a second browser,
  adults' night and Back to family). The pretend ARKS ID has the TV routes, plus `/test/tv`,
  `/test/tv/approve` and `/test/tv/unlock` for the browser tests. **Profile requests:** the 6-an-hour
  limit is 60 only under `NODE_ENV=test` (never in production), so new suites can make profiles.
- **Left for later:** the other games' TV layouts and arrow navigation, controller play for the cabinet
  games, and per-controller seats (each controller its own player answering together). The layouts and
  controller play have since landed (the sections above); per-controller seats are still open.

## Sudoku follows you, one score off a board, a cheap /healthz, and env_file (2026-11-01)

- **Sudoku progress follows a profile across devices.** `sudoku_runs` gained `progress`
  (JSON: the 81-digit grid, 81 pencil-mark bit masks, and the square marks `wrong`/`hinted`)
  and `progress_at`. The page sends it to `POST /api/sudoku/run/:id/progress` 1.5 seconds
  after the last tap and, with `keepalive`, when the page is hidden or closed. Only the
  profile that owns the run can save it (its `profileToken`); a guest's run is refused (409)
  and keeps device-only progress as before. `/start`, `GET /run/:id` and `/resume` hand the
  progress back (`syncs` says whether the run keeps it). On this device the copy is marked
  `unsent` until the arcade has it, and an unsent device copy wins over the arcade's copy
  next time (so changes made with no signal aren't lost); otherwise the arcade's copy wins.
  Progress is never read by the finish or the clock: the finish still checks the grid it's
  sent. Tests in `test/sudoku.test.js`.
- **The admin can take one score off a board, and put it back** (`arcade/score-admin.js`,
  the admin page's new 🏆 Boards tab, `public/admin-boards.js`, routes under
  `/api/admin/scores`). Remove takes two taps (the first turns the button into "Tap again to
  remove" for four seconds). The row is moved, whole, into `removed_scores` with
  `removed_at` and `removed_by` (the ARKS ID name if the admin is signed in there, otherwise
  "the admin page" or "an admin script"), so every game's boards, ranks and "fastest ever"
  leave it out without any game's own queries changing. Put back copies it into its table
  again with the same id (refused with a clear message if the same player has since put
  another score in that day's slot). Covered: Sudoku, Clueless, Tumbler Rumble, Disco Drop,
  Roll Royale, Shuffle Scuffle, Wordless (by difficulty) and the older games' shared
  `arcade_scores` (each game by its own boards). **Any other `<game>_scores` table** with
  `id`, `initials` and `score` or `time_ms` is found by itself (named from `NAMES` in
  `arcade/switches.js`, split by `level` if it has one, by day if it has `day`). Moonshot,
  the batting-cage game that landed the same evening, is picked up that way with no code of
  its own (the boards test checks it). Rambler is left out: it has its own Remove and
  Clear on the Rambler tab, and its seasons turn the boards into badges. Tests in
  `test/boards.test.js` and `test/browser/boards.spec.js`.
- **`/healthz` only looks now.** The Rambler season check and the forced theme-pack
  refresh moved to `rambler/housekeeping.js`, a once-a-minute timer started after the
  server opens its port (it replaced the 10-minute timer that was in `rambler/seasons.js`).
  Seasons end at a local midnight; every Rambler board read and score post still checks
  first, and startup still checks and refreshes, so nothing changed for players except a
  quiet arcade now rolls over within a minute instead of within 30 seconds. The pack refresh
  is no longer forced: it rebuilds the dictionary only when the word edits or the season's
  theme changed (admin edits still force it). `HOUSEKEEPING_MS` slows the timer for the test
  suite only. Tests in `test/housekeeping.test.js`.
- **`env_file: .env`** in both compose files, keeping the `environment:` list and its
  defaults. Every setting in `.env` now reaches the arcade, so a new setting only needs a
  line in `.env`. `docs/SETUP.md` says so. On the server: copy the new
  `docker-compose.prod.yml` over `docker-compose.yml`, then
  `docker compose pull && docker compose up -d`. Nothing changes in `.env`.

## Roll Royale (2026-11-01)

A cabinet-style ball-rolling game like the skee-ball machines with a power meter, with our own
name, rules and look. Its id is `royale` (page `public/royale.*`, rules `public/royale-engine.js`,
server `royale/routes.js`, accent neon mint `#2effb4`, emoji 🎳). The name is ours: you roll
the ball, and "royale" is the casino-floor glamour the arcade's look goes for.

- **Rules** (`public/royale-engine.js`, loaded by both the page and the server, only adding,
  multiplying and rounding down so every device gets the same answer): 9 balls, the first ready
  1.5 seconds in and each next one 2.2 seconds after the last was let go. The aim is a triangle
  wave from -1 to 1 that starts at a seeded point (mulberry32) for each ball and takes 2.6, 2.1 or
  1.7 seconds there and back; pressing locks it. Power is a triangle wave on the hold time (1
  second up, 1 second down); the ball travels 0.6 + 0.75 x power lane units, and sideways aim x
  0.22 x that distance. Rings around (0, 1) have radii 0.035, 0.075, 0.115, 0.155 and 0.2 for 50
  down to 10; the jackpot cup is at y 1.24, radius 0.032, worth 100, and on balls 7 to 9 it slides
  0.12 either way (seeded, 2.6-second trip) and is worth 200. The cup is checked at landing time,
  0.95 seconds after letting go. Most a run can score: 1,200.
- **Scoring the server can trust** (`royale/routes.js`, tables `royale_runs` and `royale_scores`):
  `/start` keeps the start time and a random 32-bit seed; `/finish` takes only the 9
  `[press, release]` pairs (whole ms since the run started) and replays them. Refused: not exactly
  9 pairs, a press before the ball was ready, a hold under 80 ms or over 4 seconds, or a release
  later than the server's clock says the run lasted (1.5 s slack; `ROYALE_SLACK_MS` for the test
  suite only). Pausing (How to play, leaving the page) stops the page's game clock and drops a ball
  that was being held. `testHook` in the `/start` answer, only under `NODE_ENV=test`, turns on
  `window.RoyaleTest` (when to press and how long to hold) for the browser test.
- **The page:** a canvas lane seen from behind (rows of lights, the gold lip, the tilted board with
  its neon rings, the cup, the swaying arrow with the ball's real path dashed across the board, a
  power meter with the 50 band in pink and the cup band in gold, and the 9 balls' points along the
  top). Press and hold on the lane or the HOLD · ROLL button, Space or Enter held, or the Gamepad
  API (A or the right trigger held, Start pauses or starts again). Jackpots get a banner and a coin
  burst. After a run, the line under the score is the real gap to the next score up on today's board.
- Wired into the home card, the QR picker, the admin game switches, stats, feedback, the dust sign,
  `NAMES` in `arcade/switches.js`, Comm Center posts, its own music in `public/blip.js`, the
  Dockerfile, the Playwright page list and a browser test that rolls a ball into the middle.
- Not done: a swipe whose speed sets the power. The server can only check times, so touch uses the
  same press, hold and let go as the keyboard (a flick up the lane as you let go still works). No
  per-person "best only" view of the boards, and as with the other timing games, a bot that reads
  the seed could play perfectly; the server only makes sure the times could have happened.

## Tumbler Rumble (2026-11-01)

Since 2026-11-02 a run is endless and scored in pins popped (see the section at the top); the
rules below are how it was first built.

A cabinet-style timing game like the ticket-redemption lock games at arcades, with our own name,
rules and look. Its id is `tumbler` (page `public/tumbler.*`, rules
`public/tumbler-engine.js`, server `tumbler/routes.js`, accent electric blue `#3d8bff`, emoji 🔓).
The name is ours: a lock's tumblers are the pins you pop, and "rumble" is the arcade noise.

- **Rules** (`public/tumbler-engine.js`, loaded by both the page and the server): a 2.2-second
  "ready" before the first lock, pins 75 to 300 degrees ahead of the marker (seeded mulberry32),
  12 degrees either side of the pin's middle counts and 4 is a bullseye, 3 pins on lock 1 and one
  more per lock (at most 20), speed 140 degrees a second plus 14 per lock (at most 400), a
  1.8-second break after each lock with the marker back at the top. A tap off the pin or the marker
  passing the pin's far edge ends the run. Points: 10 x lock per pin, the same again x the bullseye
  streak (capped at 5) for a bullseye, 50 x lock for opening it.
- **Scoring the server can trust** (`tumbler/routes.js`, tables `tumbler_runs` and `tumbler_scores`):
  `/start` keeps the start time and a random 32-bit seed; `/finish` takes only the tap times
  (whole ms since the run started) and replays them. Refused: taps under 60 ms apart (the page
  counts a double tap once), out of order, over 4,000, during the ready or a break, after the run
  ended, or later than the server's clock says the run lasted (1.5 s slack; `TUMBLER_SLACK_MS` for
  the test suite only). Pausing (How to play, leaving the page) stops the page's game clock, so it
  never runs ahead of the server's. Every saved run counts on the boards (today and all time). A
  new best ever posts to the Comm Center. `testHook` in the `/start` answer, only under
  `NODE_ENV=test`, turns on `window.TumblerTest` for the browser test.
- **The page:** a canvas lock (shackle that lifts when a lock opens, a ring of 48 lights with a
  trail behind the marker, the gold pin with its bullseye stripe), the POP! button, Space and
  Enter, and the Gamepad API (A pops, Start pauses or starts again). After a run, the line under
  the score is the real gap to the next score up on today's board.
- Wired into the home card, the QR picker, the admin game switches, stats, feedback, the dust sign,
  `NAMES` in `arcade/switches.js`, Comm Center posts, its own music in `public/blip.js`, the
  Dockerfile, the Playwright page list and a browser test that pops the first lock.
- Not done: no per-person "best only" view of the boards (every saved run is listed), and a bot
  that reads the seed could still play perfectly. The server only makes sure the taps could have
  happened, which is the same trust the other timing games have.

## Moonshot, the batting cage (2026-11-01)

A cabinet-style timing game in the spirit of the arcade batting-cage cabinets, with our own
name, rules and look (no real teams, leagues or logos). Its id is `moonshot` (page
`public/moonshot.*`, rules `public/moonshot-engine.js`, server `moonshot/routes.js`, accent
ice blue `#7cf5ff`, emoji ⚾). "Moonshot" is baseball slang for a towering home run, and a
perfect swing here really does fly to the moon.

- **Rules** (`public/moonshot-engine.js`, loaded by both the page and the server): 12 pitches,
  levels of 4 (points x1, x2, x3). The seed alone sets every pitch: its kind (fastball, changeup,
  curveball that bows out and back; the first pitch is always a fastball), its windup (600-1400
  ms, shorter at higher levels), and its travel time (fastball 1250/1020/840 ms by level,
  changeup 1700/1450/1250, curve 1500/1280/1100, each ±60). The schedule doesn't depend on the
  swings: 1.8 s ready, then windup, flight, 220 ms where a late swing still counts, 1.6 s
  between pitches. A run takes about 50 seconds. Timing bands either side of perfect: 25 ms home
  run (100), 50 triple (60), 80 double (40), 120 single (25), 160 grounder (5), 210 foul (2),
  else a strike. Home runs in a row add 50 for each one before (up to 200), then the level
  multiplies. Most a run can score: 6,700.
- **Scoring the server can trust** (`moonshot/routes.js`, tables `moonshot_runs` and
  `moonshot_scores`): `/start` keeps the start time and a random 32-bit seed. The page posts each
  swing's time as it happens; the server checks it's a whole number, no later than its own
  clock allows (300 ms grace; `MOONSHOT_SLACK_MS` widens it for the test suite only), no more
  than 10 seconds old, not while paused, and inside a pitch's swing window with one swing per
  pitch, then replays the run. Save takes only initials or a profile; the score is the server's
  replay. **Pausing** (How to play, the boards, leaving the page, P/Esc, a controller's Start)
  stops the page's clock and calls `/pause` and `/resume`, so the server leaves paused time
  off the run's clock and the 10-second check still works. A run expires after 30 minutes.
- **Honest celebrations:** the HOME RUN! banner, coins and moon fireworks fire on the server's
  answer, and "So close!" only when the server measured the swing within 15 ms of the home-run
  window (it says the real gap). After a save, the line under the score is the real gap to the
  next score up on today's board.
- **The page:** a canvas cage (stadium lights, a moon, a chasing-light outfield wall, a pitching
  machine whose light ring fills during the windup, the glowing ring over the plate, a neon
  bat), the SWING button (acts on the press), Space and Enter, and the Gamepad API (A swings,
  Start pauses). `window.MoonshotClock` exposes the run's clock so the browser test can aim, and
  `GET /api/moonshot/test/homer/:id` gives the perfect swing time only under `NODE_ENV=test`.
- Wired into the home card, the QR picker, admin switches and stats, `NAMES` in
  `arcade/switches.js`, the banner, feedback, the dust sign, Comm Center posts (a new best run
  ever), its own ballpark-organ music in `public/blip.js`, the Dockerfile, the Playwright page
  list and a browser test that hits a home run on the first pitch and saves the run.
- Not done: no left/right aiming (the timing alone decides the hit; early goes left and late
  goes right), no party mode with turns, and a bot that reads the seed could still swing
  perfectly (the same trust the other timing games have).

## Disco Drop, the drop cabinet (2026-11-01)

The "cabinet-style game" from the to-do list, in the spirit of the arcade cabinets where a
prize hangs over moving holes and you press a button to drop it. Its id is `discodrop` (page
`public/discodrop.*`, server `discodrop/`, accent neon pink `#ff5cf0`, emoji 🪩). Our own name
and look: a disco ball over a row of neon cups, with chasing bulbs and spotlights. The name
was picked because the thing you drop is a disco ball and the cabinet is a little dance floor,
and it's nobody's trademark.

- **The motion** (`public/discodrop-engine.js`, loaded by the page and required by the server):
  a stage 1000 units wide, a looping belt of 12 cups (10, 25, 50, 100, two BUST cups and one
  80-unit jackpot worth 500), whole-number math only, mulberry32 seeded random numbers. The
  seed decides each ball's belt speed and direction, the arm's speed (still for balls 1-3), the
  cup order (reshuffled after balls 2, 5 and 7), and where the belt starts. The motion of ball
  k starts where ball k-1 landed, so `replay(seed, times)` works out every landing from the
  drop times alone. Balls 8-10 score double; the most a run can score is 6,500.
- **Scoring** (`discodrop/routes.js`, tables `discodrop_runs` and `discodrop_scores`): the
  server makes the seed and records the start. The page posts each drop's time (ms since the
  run arrived) as it happens; the server checks it's a whole number, no later than its own
  clock allows (300 ms grace), no more than 10 seconds old, and at least 1 second after the
  last drop (the 0.65-second fall plus the 0.35-second reload), replays the run and keeps the
  times. Save takes only initials or a profile; the score is the server's replay. Every saved
  run counts (it's an arcade game, not a daily puzzle). A run expires after 30 minutes.
- **Honest celebrations:** the jackpot banner and coins fire on the server's answer, and "So
  close!" only when the server measured the ball within 18 units of the jackpot cup.
- **The page:** the whole stage is the tap area, plus a big DROP button; Space and Enter; a
  controller's A button (Gamepad API, polled each frame, acts on the press). The stage shrinks
  to fit short screens so the button stays in view. `window.DiscoDropClock` exposes the run's
  clock (it reveals nothing the page doesn't already have) so the browser test can aim.
  `GET /api/discodrop/test/jackpot/:id` gives jackpot drop windows only under `NODE_ENV=test`.
- Wired into the home card, the QR picker, admin switches and stats, `NAMES` in
  `arcade/switches.js`, the banner, feedback, the dust sign, Comm Center posts (a new best
  run ever), its own disco music in `public/blip.js`, the Dockerfile, the Playwright page list
  and a browser test that drops the first ball into the jackpot and saves the run.
- Not done: no multiplayer or party mode yet (taking turns on one cabinet would be a good
  next step), no pause (the cups keep moving, but nothing drops until you tap), and no
  removing a single score from a board (no game has that yet).

## Game switches and the banner from ARKS ID (2026-11-01, contract v13)

- **With ARKS ID on, its admin console can turn games on and off** for everyone, for a
  role or for one person (`arcade/switches.js`, through the shared kit's new
  `kit/switches.js` and the client's `appCall()`). The arcade sends its list of games
  (`game.<id>`, named from `NAMES` in that file) a few seconds after it starts, whenever
  the list changes (checked every minute), and right after the admin page's game list is
  saved. Each game's default there is the arcade's own setting: on, unless it's turned off
  on the admin page.
- **Who decides:** for a game someone set in ARKS ID's console, ARKS ID's answer; for every
  other game, the admin page's own switch, so it keeps working as before. A game that's off
  shows the "Pardon our dust" sign, on its tile and its page, the same as before.
  `/api/arcade-info` works the closed list out for whoever is asking (answers kept a
  minute). Without ARKS ID nothing changes. The admin page's game list says, under the
  buttons, that ARKS ID's console can switch games too (`arksId` on `/home-games`).
- **The banner:** `GET /api/banner` hands the message typed in ARKS ID's console to every
  page, and the kit's new `public/banner.js` shows it across the top (Hide puts it away on
  that device until tomorrow). Without ARKS ID it's always `{ banner: null }`. Every page
  in `public/` loads `banner.js`; a new game page needs the same line.
- When adding a game, also add its name to `NAMES` in `arcade/switches.js`, or the
  console shows its id.
- Nothing changes in `.env` or the compose file. Tests: the ARKS ID suite (switching
  games there and on the admin page, one person turned back on, the banner), `api.test.js`
  (no banner without ARKS ID), and `test/browser/switches.spec.js` (the banner shows and
  hides; a switched-off game shows the sign). The pretend ARKS ID has `/test/switches` for the
  browser tests, on the port after the arcade's. The banner browser test answers
  `/api/banner` for its own page only, so a banner never shifts another test's page.

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
- Not done: no adult crossword,
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
- Since the later 2026-11-01 change at the top of this file, a profile's squares and pencil
  marks follow it to another device, and the admin can take a single time off a board.

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
- ~~`/healthz` still runs the Rambler season check and a forced theme pack refresh on
  every call~~: moved to a once-a-minute timer (see the top of this file).

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
- **Start a new game:** the next one from the private feedback list. Sudoku, Shuffle
  Scuffle (the word scramble), Criss Cross (the crossword tile game), Clueless (the daily
  crossword), Tumbler Rumble (the lock cabinet), Disco Drop (the drop cabinet) and Moonshot
  (the batting cage) were built on 2026-11-01.
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
  sign-in and passkeys). **Built against ARKS ID contract v14** (2026-11-01): TVs (the pairing
  code sign-in, adults' night, see the top of this file). Before that, v13 (2026-11-01): game
  switches and the banner from ARKS ID's admin console (see the top of this file). Before
  that, v12 (2026-11-01): status reports for ARKS ID's admin console. Before that, v10
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
