'use strict';

// Words with Family games, kept in the database because a game can last days.
//
// Two kinds:
//   - online: each player on their own phone, signed in with a profile. The
//     one who starts it invites other profiles, and can leave seats open for
//     a share link. Turns can wait as long as they like.
//   - local: one device passed around (pass-and-play), optionally with the
//     computer as a player. Anyone can start one, guests included. The device
//     gets a key, and only that key can open the game.
//
// The whole game (board, bag, every rack) is one JSON blob in `state`, and
// it never leaves the server as is: view() builds what one player may see.
// Every move goes through engine.js, so the server checks it and scores it.

const crypto = require('node:crypto');
const db = require('../db');
const E = require('./engine');
const bot = require('./bot');

db.db.exec(`
  CREATE TABLE IF NOT EXISTS crisscross_games (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,                 -- online | local
    status TEXT NOT NULL,               -- waiting | playing | over
    dictionary TEXT NOT NULL DEFAULT 'kids',
    host_profile TEXT,
    seats INTEGER NOT NULL,
    join_code TEXT UNIQUE,
    key_hash TEXT,
    turn_profile TEXT,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS crisscross_games_turn ON crisscross_games (turn_profile, status);
  CREATE TABLE IF NOT EXISTS crisscross_seats (
    game_id TEXT NOT NULL,
    seat INTEGER NOT NULL,
    profile_id TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, seat)
  );
  CREATE INDEX IF NOT EXISTS crisscross_seats_profile ON crisscross_seats (profile_id);
`);

const DAY = 24 * 60 * 60 * 1000;
const KEEP_LOCAL = 30 * DAY;        // a pass-and-play game nobody touched for a month is forgotten
const KEEP_WAITING = 14 * DAY;      // so is an online game that never got its players
const MAX_OPEN_PER_PROFILE = 30;    // unfinished online games one profile can be in
const MAX_LOCAL = 5000;
const fail = E.fail;
const profiles = () => require('../arcade/profiles');
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const cleanName = raw => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16);

function sweep(now = Date.now()) {
  const old = db.db.prepare(`SELECT id FROM crisscross_games WHERE (kind = 'local' AND updated_at < ?)
    OR (status = 'waiting' AND updated_at < ?)`).all(now - KEEP_LOCAL, now - KEEP_WAITING);
  for (const { id } of old) remove(id);
}
const sweeper = setInterval(sweep, 60 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();
function remove(id) {
  db.db.prepare('DELETE FROM crisscross_seats WHERE game_id = ?').run(id);
  db.db.prepare('DELETE FROM crisscross_games WHERE id = ?').run(id);
}

// ---- who's who ------------------------------------------------------------------------------

const profileRow = id => db.db.prepare("SELECT id, name, avatar FROM arcade_profiles WHERE id = ? AND status = 'approved'").get(String(id || ''));

// With ARKS ID on, each profile belongs to an account with a role. Grown-ups
// (admin and adult) can play on the unfiltered list. Without ARKS ID there
// are no roles, and the adult PIN is what's checked instead.
const GROWN_UP = ['admin', 'adult'];
function grownUp(profileId) {
  try {
    const r = db.db.prepare(`SELECT a.role FROM arcade_profiles p JOIN arcade_id_accounts a ON a.user_id = p.arksid_user
      WHERE p.id = ? AND p.status = 'approved'`).get(String(profileId || ''));
    return !!r && GROWN_UP.includes(r.role);
  } catch { return false; }   // no accounts table: ARKS ID has never been on
}

// ---- reading and saving ----------------------------------------------------------------------

function load(id) {
  const row = db.db.prepare('SELECT * FROM crisscross_games WHERE id = ?').get(String(id || ''));
  if (!row) throw fail('That game isn\'t here anymore. It may have finished a long time ago.', 404);
  return { row, state: JSON.parse(row.state) };
}

// actor: the profile whose move this was. When it's given and the turn moves on
// to someone else in an online game, that person is told (see "Telling people").
function save(row, state, now = Date.now(), actor) {
  const status = state.waiting ? 'waiting' : state.over ? 'over' : 'playing';
  const p = !state.waiting && !state.over ? state.players[state.turn] : null;
  const before = row.turn_profile || null, turn = p && p.profileId ? p.profileId : null;
  db.db.prepare('UPDATE crisscross_games SET status = ?, turn_profile = ?, state = ?, updated_at = ?, join_code = ? WHERE id = ?')
    .run(status, turn, JSON.stringify(state), now, status === 'waiting' ? row.join_code : null, row.id);
  row.status = status;
  row.updated_at = now;
  row.turn_profile = turn;
  if (actor !== undefined && row.kind === 'online' && turn && turn !== before && turn !== actor) yourTurn(row, state, turn, actor);
}

// ---- telling people ----------------------------------------------------------------------------------
// A notification on the phone when it becomes your turn in an online game, or when
// someone starts a game with you (arcade/push.js, only with the sign-in service on).
// Games against the computer and pass-and-play games never send any.

let notifier = null;
function setNotifier(fn) { notifier = fn; }
const nameOf = (state, profileId) => (state.players.find(p => p.profileId === profileId) || {}).name || 'Someone';
function tell(row, profileId, body) {
  if (!notifier) return;
  try {
    notifier(profileId, { title: 'Words with Family', body, url: `/crisscross.html?game=${row.id}`, tag: `ww-${row.id}` });
  } catch { /* a notification never stops a game */ }
}
function yourTurn(row, state, to, actor) {
  const who = actor ? nameOf(state, actor) : null;
  const last = state.moves && state.moves[state.moves.length - 1];
  let what;
  if (!who || !last) what = 'The game has started.';
  else if (last.kind === 'play') {
    // The unfiltered list's words stay off the lock screen.
    const word = row.dictionary !== 'adult' && last.words && last.words[0] ? String(last.words[0].word).toUpperCase() : 'a word';
    what = `${who} played ${word} for ${last.score} point${last.score === 1 ? '' : 's'}.`;
  } else if (last.kind === 'swap') what = `${who} swapped some tiles.`;
  else if (last.kind === 'pass') what = `${who} passed.`;
  else if (last.kind === 'resign') what = `${who} left the game.`;
  else what = `${who} took a turn.`;
  tell(row, to, `${what} It's your turn!`);
}

// Which seat the person asking has. Online games know you by your profile;
// local games by the device's key, and then it's whoever's turn it is.
function seatFor(row, state, { profile, key }) {
  if (row.kind === 'local') {
    if (!key || !row.key_hash || hash(key) !== row.key_hash) throw fail('This game belongs to another device.', 403);
    return { seat: null, local: true };
  }
  if (!profile) throw fail('Pick your profile to see your games.', 401);
  const seat = state.players.findIndex(p => p.profileId === profile.id);
  if (seat < 0) throw fail('You aren\'t playing in this game.', 403);
  return { seat, local: false };
}

// ---- starting a game -----------------------------------------------------------------------------

function newId() { return crypto.randomBytes(12).toString('hex'); }

function createOnline({ host, invite, openSeats, dictionary, adultOk }, now = Date.now()) {
  const dict = E.dictOf(dictionary);
  const ids = [...new Set((Array.isArray(invite) ? invite : []).map(String))].filter(id => id !== host.id);
  const open = Math.max(0, Math.min(3, Number(openSeats) || 0));
  const seats = 1 + ids.length + open;
  if (seats < 2) throw fail('Invite at least one person, or leave a seat open for a share link.');
  if (seats > E.MAX_PLAYERS) throw fail('A game has room for 4 players at most.');
  const busy = db.db.prepare(`SELECT COUNT(*) AS n FROM crisscross_seats s JOIN crisscross_games g ON g.id = s.game_id
    WHERE s.profile_id = ? AND g.status != 'over'`).get(host.id).n;
  if (busy >= MAX_OPEN_PER_PROFILE) throw fail(`You're in ${busy} unfinished games already. Finish or leave some first.`, 429);
  const people = ids.map(id => {
    const r = profileRow(id);
    if (!r) throw fail('One of the people you picked doesn\'t have a profile here anymore.');
    return r;
  });
  if (dict === 'adult' && adultOk) {
    const kid = people.find(p => !adultOk(p.id));
    if (kid) throw fail(`${kid.name} can't be invited to a game on the unfiltered list. Everyone in it has to be a grown-up.`, 403);
  }
  const players = [{ name: host.name, profileId: host.id }, ...people.map(p => ({ name: p.name, profileId: p.id }))];
  const id = newId();
  const code = open ? crypto.randomBytes(9).toString('base64url') : null;
  const state = open ? { waiting: true, seats, dictionary: dict, players } : E.newGame({ players, dictionary: dict });
  db.db.prepare(`INSERT INTO crisscross_games (id, kind, status, dictionary, host_profile, seats, join_code, state, created_at, updated_at)
    VALUES (?, 'online', 'waiting', ?, ?, ?, ?, '{}', ?, ?)`).run(id, dict, host.id, seats, code, now, now);
  players.forEach((p, seat) => db.db.prepare('INSERT INTO crisscross_seats (game_id, seat, profile_id) VALUES (?, ?, ?)').run(id, seat, p.profileId));
  const row = load(id).row;
  save(row, state, now);
  for (const p of people) {
    const yours = !state.waiting && state.players[state.turn].profileId === p.id;
    tell(row, p.id, `${host.name} started a game with you. ` + (state.waiting ? 'It begins once everyone has joined.'
      : yours ? 'It\'s your turn first!' : `${state.players[state.turn].name} goes first.`));
  }
  return id;
}

function createLocal({ players, dictionary }, now = Date.now()) {
  const list = (Array.isArray(players) ? players : []).slice(0, E.MAX_PLAYERS + 1);
  if (list.length < 2 || list.length > E.MAX_PLAYERS) throw fail('A game needs 2 to 4 players.');
  const seen = new Set();
  const clean = list.map((p, k) => {
    const isBot = !!(p && p.bot);
    let name = isBot ? 'Computer' : cleanName(p && p.name) || `Player ${k + 1}`;
    while (seen.has(name.toLowerCase())) name = `${name.slice(0, 13)} ${k + 1}`;
    seen.add(name.toLowerCase());
    return isBot ? { name, bot: true } : { name };
  });
  if (clean.every(p => p.bot)) throw fail('At least one person has to play.');
  if (db.db.prepare("SELECT COUNT(*) AS n FROM crisscross_games WHERE kind = 'local'").get().n >= MAX_LOCAL) sweep(now);
  const id = newId();
  const key = crypto.randomBytes(16).toString('hex');
  const state = E.newGame({ players: clean, dictionary });
  db.db.prepare(`INSERT INTO crisscross_games (id, kind, status, dictionary, seats, key_hash, state, created_at, updated_at)
    VALUES (?, 'local', 'playing', ?, ?, ?, '{}', ?, ?)`).run(id, state.dictionary, clean.length, hash(key), now, now);
  const row = load(id).row;
  runBots(state, now);
  save(row, state, now);
  return { id, key };
}

// The computer takes its turns straight away.
function runBots(state, now = Date.now()) {
  let guard = 0;
  while (!state.over && !state.waiting && state.players[state.turn].bot && guard++ < 8) bot.move(state, state.turn, now);
}

// ---- the share link ----------------------------------------------------------------------------------

function byCode(code) {
  const row = db.db.prepare("SELECT * FROM crisscross_games WHERE join_code = ? AND status = 'waiting'").get(String(code || ''));
  if (!row) throw fail('That invite has been used up, or the game has already started.', 404);
  return { row, state: JSON.parse(row.state) };
}

function invitePreview(code) {
  const { state } = byCode(code);
  return { players: state.players.map(p => p.name), seats: state.seats, dictionary: state.dictionary };
}

function join(code, profile, now = Date.now()) {
  const { row, state } = byCode(code);
  if (state.players.some(p => p.profileId === profile.id)) return row.id;
  if (state.players.length >= state.seats) throw fail('That game is full.', 409);
  const seat = state.players.length;
  state.players.push({ name: profile.name, profileId: profile.id });
  db.db.prepare('INSERT INTO crisscross_seats (game_id, seat, profile_id) VALUES (?, ?, ?)').run(row.id, seat, profile.id);
  if (state.players.length >= state.seats) return begin(row, state, now, profile.id);
  save(row, state, now);
  return row.id;
}

// actor: who made it start (the last to join, or the host pressing Start).
function begin(row, state, now = Date.now(), actor = null) {
  const game = E.newGame({ players: state.players, dictionary: state.dictionary });
  db.db.prepare('UPDATE crisscross_games SET seats = ? WHERE id = ?').run(game.players.length, row.id);
  save(row, game, now, actor);
  return row.id;
}

// The host starts with whoever has joined so far (two at least).
function startNow(id, who, now = Date.now()) {
  const { row, state } = load(id);
  seatFor(row, state, who);
  if (!state.waiting) throw fail('This game has already started.', 409);
  if (row.host_profile !== who.profile.id) throw fail('Only the person who set up the game can start it.', 403);
  if (state.players.length < 2) throw fail('Wait until at least one more person has joined.', 409);
  return begin(row, state, now, who.profile.id);
}

// ---- taking turns ------------------------------------------------------------------------------------

function act(id, who, fn, now = Date.now()) {
  const { row, state } = load(id);
  const { seat, local } = seatFor(row, state, who);
  if (state.waiting) {
    if (fn.leave) return leaveWaiting(row, state, seat, now);
    throw fail('The game starts once everyone has joined.', 409);
  }
  const acting = local ? state.turn : seat;
  if (local && state.players[acting].bot) throw fail('It\'s the computer\'s turn.', 409);
  const result = fn(state, acting, now);
  if (local) {
    // Only the computer left: nobody to watch it play itself.
    if (!state.over && state.players.every((p, s) => p.bot || state.resigned[s])) E.finish(state, 'resigned');
    runBots(state, now);
  }
  save(row, state, now, who.profile ? who.profile.id : null);
  return { result, view: view(row, state, who) };
}

// Leaving before the game starts: the host's leaving calls it off.
function leaveWaiting(row, state, seat, now) {
  if (seat === 0) { remove(row.id); return { result: { canceled: true }, view: null }; }
  state.players.splice(seat, 1);
  db.db.prepare('DELETE FROM crisscross_seats WHERE game_id = ?').run(row.id);
  state.players.forEach((p, s) => db.db.prepare('INSERT INTO crisscross_seats (game_id, seat, profile_id) VALUES (?, ?, ?)').run(row.id, s, p.profileId));
  save(row, state, now);
  return { result: { left: true }, view: null };
}

const moves = {
  play: placements => (state, seat, now) => E.play(state, seat, placements, now),
  swap: tiles => (state, seat, now) => E.swap(state, seat, tiles, now),
  pass: () => (state, seat, now) => E.pass(state, seat, now),
  resign: () => Object.assign((state, seat, now) => E.resign(state, seat, now), { leave: true })
};

// Checks a play and works out its points without making it.
function preview(id, who, placements) {
  const { row, state } = load(id);
  const { seat, local } = seatFor(row, state, who);
  if (state.waiting || state.over) throw fail('There\'s nothing to play right now.', 409);
  const acting = local ? state.turn : seat;
  const r = E.evaluate(state, placements, { rack: state.racks[acting] });
  return { words: r.words, score: r.score, allTiles: r.allTiles, yourTurn: state.turn === acting };
}

// A finished game can be cleared from your list.
function hide(id, who) {
  const { row, state } = load(id);
  const { seat } = seatFor(row, state, who);
  if (row.status !== 'over') throw fail('Only finished games can be cleared from your list.', 409);
  db.db.prepare('UPDATE crisscross_seats SET hidden = 1 WHERE game_id = ? AND seat = ?').run(row.id, seat);
  return { hidden: true };
}

// ---- what one player may see ----------------------------------------------------------------------------

function view(row, state, who) {
  const local = row.kind === 'local';
  const you = local ? null : state.players.findIndex(p => p.profileId === (who.profile && who.profile.id));
  const live = profiles => (profiles.profileId ? profileRow(profiles.profileId) : null);
  const people = state.players.map((p, s) => {
    const now = live(p);
    const out = { name: now ? now.name : p.name, avatar: now ? now.avatar : null, bot: !!p.bot, you: s === you };
    if (!state.waiting) {
      Object.assign(out, { score: state.scores[s], tiles: state.racks[s].length, resigned: state.resigned[s] });
      // Racks are only shown to their owner, and to everyone once the game is over.
      if (state.over) out.rack = state.racks[s].slice();
    }
    return out;
  });
  const base = {
    id: row.id, kind: row.kind, status: row.status, dictionary: state.dictionary, players: people,
    you: local ? null : you, host: !local && who.profile && row.host_profile === who.profile.id,
    updatedAt: row.updated_at, createdAt: row.created_at
  };
  if (state.waiting) {
    return { ...base, seats: state.seats, joinCode: base.host ? row.join_code : null };
  }
  // In a local game the rack shown is whoever's turn it is (the phone gets
  // passed to them), unless it's the computer's.
  const rackSeat = local ? (state.players[state.turn].bot ? null : state.turn) : you;
  const lastPlay = [...state.moves].reverse().find(m => m.kind === 'play');
  return {
    ...base,
    board: state.board,
    last: lastPlay ? lastPlay.tiles : [],
    turn: state.turn,
    yourTurn: !state.over && (local ? !state.players[state.turn].bot : state.turn === you),
    rack: rackSeat === null || rackSeat < 0 || state.over ? null : state.racks[rackSeat].slice(),
    rackSeat: rackSeat !== null && rackSeat >= 0 ? rackSeat : null,
    bag: state.bag.length,
    canSwap: state.bag.length >= E.SWAP_MIN,
    scoreless: state.scoreless,
    moves: state.moves.map(m => ({ seat: m.seat, kind: m.kind, words: m.words, score: m.score, count: m.count, allTiles: m.allTiles, tiles: m.tiles, at: m.at })),
    over: state.over
  };
}

function open(id, who) {
  const { row, state } = load(id);
  seatFor(row, state, who);
  return view(row, state, who);
}

// The games a profile is in, newest first, for the game list and the "your
// turn" counts on the home page.
function mine(profile) {
  const rows = db.db.prepare(`SELECT g.* FROM crisscross_games g JOIN crisscross_seats s ON s.game_id = g.id
    WHERE s.profile_id = ? AND s.hidden = 0 ORDER BY (g.status = 'over'), g.updated_at DESC LIMIT 60`).all(profile.id);
  const games = rows.map(row => {
    const state = JSON.parse(row.state);
    const v = view(row, state, { profile });
    const last = state.moves && state.moves.length ? state.moves[state.moves.length - 1] : null;
    return {
      id: row.id, status: row.status, dictionary: v.dictionary, players: v.players, you: v.you,
      yourTurn: !!v.yourTurn, turn: v.turn === undefined ? null : v.turn, seats: v.seats || null, host: v.host,
      lastMove: last ? { seat: last.seat, kind: last.kind, score: last.score, words: (last.words || []).map(w => w.word), at: last.at } : null,
      over: v.over || null, updatedAt: row.updated_at
    };
  });
  return { yourTurn: games.filter(g => g.yourTurn).length, games };
}

// Just the count, cheap enough for the home page.
function turnCount(profileId) {
  return db.db.prepare("SELECT COUNT(*) AS n FROM crisscross_games WHERE turn_profile = ? AND status = 'playing'").get(String(profileId)).n;
}

module.exports = {
  createOnline, createLocal, join, invitePreview, startNow, act, moves, preview, hide, open, mine, turnCount,
  grownUp, profileRow, load, sweep, setNotifier
};
