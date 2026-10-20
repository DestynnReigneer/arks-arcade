const path = require('node:path');

// Running with plain `npm start`, read settings from .env the same way Docker
// Compose does. Already-set variables win, so Compose and the test runner are
// unaffected; tests skip it so a real password never leaks into the suite.
if (process.env.NODE_ENV !== 'test') {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env */ }
}

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const dictionary = require('./rambler/dictionary');
const wordlessHints = require('./arcade/wordless-hints');
const ramblerRoutes = require('./rambler/routes');
const ramblerSeasons = require('./rambler/seasons');
const ramblerPacks = require('./rambler/packs');
const comm = require('./arcade/comm');
const adultPin = require('./arcade/adult-pin');

const app = express();
const PORT = process.env.PORT || 3000;
// ADMIN_PASSWORD is the name in .env; ADMIN_TOKEN is the older one, still honored.
const ADMIN_TOKEN = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

const security = require('./arcade/security');
app.set('trust proxy', security.trustProxySetting());
app.disable('x-powered-by');
app.use(security.headers);
app.use(express.json({ limit: '200kb' }));
// Stats and the error log: see every server error answer on its way out.
const stats = require('./arcade/stats');
stats.watchProcess();
app.use('/api', stats.watchResponses);
app.use(express.static(path.join(__dirname, 'public')));

// Rambler lives behind its own router; everything it needs is under
// rambler/ so this file stays about the arcade as a whole.
app.use('/api/rambler', ramblerRoutes);

const WORD_RE = /^[a-zA-Z]{3,10}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const INITIALS_RE = /^[A-Z0-9]{1,3}$/;

// ---- Admin auth ----
// Lightweight shared-token gate for a solo/family admin, not a full account system.
// If ADMIN_TOKEN isn't configured, admin routes are disabled entirely (deny by default).
function requireAdmin(req, res, next) {
  if (!security.sameSecret(req.get('X-Admin-Token'), ADMIN_TOKEN)) {
    return res.status(401).json({ error: 'Admin token missing or incorrect.' });
  }
  next();
}

// ---- Rate limiting for public write endpoints ----
const leaderboardLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many score submissions. Try again in a few minutes.' }
});

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many theme requests. Try again later.' }
});

async function notifyDiscord(request, game = 'Wordless') {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🎮 **New ${game} theme request**\n**Topic:** ${request.topic}${request.requestedBy ? `\n**From:** ${request.requestedBy}` : ''}${request.note ? `\n**Note:** ${request.note}` : ''}`
      })
    });
  } catch (e) {
    console.error('Discord webhook failed:', e.message);
  }
}

// ---- Health ----
// Used by the container healthcheck. It touches the dictionary and the
// database deliberately: a process that is listening but whose word lists
// failed to load is not healthy, and reporting it as such would hide the
// single most likely deployment failure.
app.get('/healthz', (req, res) => {
  try {
    const stats = dictionary.stats;
  // Open a season if there is not one, and roll over anything already due --
  // a container that was off over a month boundary should come back current.
  ramblerSeasons.checkDue();
  const season = ramblerSeasons.status();
  // Apply admin word edits and the season's theme pack before anyone plays.
  ramblerPacks.refresh({ force: true });
  const theme = ramblerPacks.active();
    const themes = db.listThemes().length;
    if (!stats.kids || !themes) throw new Error('not ready');
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      words: { kids: stats.kids, adult: stats.adult },
      themes
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.use('/api/chess', require('./chess/routes'));
app.use('/api/spinsolve', require('./spinsolve/routes')({ requireAdmin, notify: notifyDiscord }));
app.use('/api/trivia', require('./trivia/routes')({ requireAdmin, notify: notifyDiscord }));
app.use('/api/partdeux', require('./partdeux/routes'));
app.use('/api/daredevil', require('./daredevil/routes'));
app.use('/api', require('./arcade/lobby').router);
app.use('/api/profiles', require('./arcade/profiles')({ requireAdmin, notify: notifyDiscord }));
app.use('/api/scores', require('./arcade/scores').router);
app.use('/api/stats', stats.routes({ requireAdmin }));

// ---- Comm Center (home page message board) ----
app.use('/api/comm/admin', comm.adminRouter(requireAdmin));
app.use('/api/comm', comm.router);

// The arcade's name for the hub page, from ARCADE_NAME in .env.
app.get('/api/arcade-info', (req, res) => {
  res.json({
    name: String(process.env.ARCADE_NAME || '').trim().slice(0, 30),
    adultRequiresPin: adultPin.status().set,
    games: require('./arcade/home-games').get(),
    publicUrl: require('./arcade/lobby').publicUrl()
  });
});

// Adult-only Wordless themes (and their scores) show up only when the page
// asks for them with ?adult=1 and the adult PIN, or with no PIN set at all.
const adultUnlocked = req => req.query.adult === '1' && adultPin.matches(req.get('X-Adult-Pin'));

app.post('/api/adult-check', (req, res) => {
  res.json({ ok: adultPin.matches((req.body || {}).pin) });
});

// ---- Themes (read: public, write: admin-only) ----
// Wordless difficulty levels, by answer length. Must match DIFFICULTIES in public/app.js.
const DIFFICULTIES = { easy: [3, 4], normal: [5, 6], hard: [7, 8], ludicrous: [9, 10] };

// Classic's built-in list is all five- and six-letter words, which leaves
// nothing for Easy or Ludicrous. Top it up from the most common kid-safe
// dictionary words (common-10k is in frequency order, so the first ones taken
// are the most familiar).
const CLASSIC_EXTRA_PER_LEVEL = 300;
let classicExtras = null;
function getClassicExtras() {
  if (!classicExtras) {
    const counts = {};
    classicExtras = [];
    for (const upper of dictionary.load().common) {
      const w = upper.toLowerCase();
      const level = Object.keys(DIFFICULTIES).find(k => w.length >= DIFFICULTIES[k][0] && w.length <= DIFFICULTIES[k][1]);
      if (!level || !WORD_RE.test(w)) continue;
      counts[level] = (counts[level] || 0) + 1;
      if (counts[level] <= CLASSIC_EXTRA_PER_LEVEL) classicExtras.push(w);
    }
  }
  return classicExtras;
}

// An AI-written adult theme only ever has a handful of 3-4 letter words, and
// some of those are tame, so adult Easy ended up feeling like the kids game.
// Adult themes short on Easy words get these on top, so Easy always has plenty
// of rude ones. Themes with their own short words (the built-ins) keep to them.
const ADULT_SHORT_WORDS = `
  ass butt boob tit tits dick cock cum jizz sex sexy nude nip nips porn lust
  kink lewd milf lube anal oral bang bone hump wang dong pube perv whip lick
  suck blow fuck shit damn hell piss crap twat muff nads bra wet moan kiss
  rack buns stud hunk orgy thot horn
`.split(/\s+/).filter(w => w.length >= 3 && w.length <= 4);

// Clues for a theme that was made before clues existed (or made without them).
app.post('/api/themes/:id/clues', requireAdmin, (req, res) => {
  const theme = db.getTheme(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });
  const raw = req.body && (req.body.clues || req.body);
  const clues = wordlessHints.cleanClues(raw, theme.words);
  if (!Object.keys(clues).length) {
    return res.status(400).json({ error: 'No usable clues. Expected { "word": "clue", ... } for words in this theme.' });
  }
  const updated = db.setThemeClues(theme.id, clues);
  res.json({ saved: Object.keys(clues).length, total: Object.keys(updated.clues).length, of: theme.words.length });
});

// The puzzle title and the hint ladder for one answer. The answer is already
// on the client (Wordless picks it there), so this gives nothing away.
app.get('/api/wordless/hints', (req, res) => {
  const theme = db.getTheme(String(req.query.theme || ''));
  const word = String(req.query.word || '').toLowerCase();
  if (!theme || !WORD_RE.test(word)) return res.status(400).json({ error: 'Unknown theme or word' });
  if (theme.adult && !adultUnlocked(req)) return res.status(403).json({ error: 'That PIN is not right.' });
  res.json(wordlessHints.hintsFor(theme, word, dictionary.load().common));
});

app.get('/api/themes', (req, res) => {
  if (req.query.adult === '1' && !adultUnlocked(req)) {
    return res.status(403).json({ error: 'That PIN is not right.' });
  }
  // The admin page lists every theme, so adult ones can be deleted too.
  const isAdmin = security.sameSecret(req.get('X-Admin-Token'), ADMIN_TOKEN);
  res.json(db.listThemes({ includeAdult: isAdmin || adultUnlocked(req) }).map(t =>
    t.id === 'classic' ? { ...t, words: [...new Set([...t.words, ...getClassicExtras()])] }
      : t.adult && !isAdmin && t.words.filter(w => w.length <= 4).length < 10
        ? { ...t, words: [...new Set([...t.words, ...ADULT_SHORT_WORDS])] }
        : t));
});

app.post('/api/themes', requireAdmin, (req, res) => {
  const body = req.body || {};
  const label = String(body.label || '').trim().slice(0, 40);
  const subject = String(body.subject || '').trim().slice(0, 60) || 'word';
  const emoji = String(body.emoji || '⭐').trim().slice(0, 8) || '⭐';
  const accent = HEX_COLOR_RE.test(body.accent) ? body.accent : '#7dd3fc';
  const bg = HEX_COLOR_RE.test(body.bg) ? body.bg : '#0f1115';
  const fontKey = Object.keys(db.FONT_STACKS).includes(body.fontKey) ? body.fontKey : 'sans';

  if (!label) {
    return res.status(400).json({ error: 'Theme name is required.' });
  }

  const rawWords = Array.isArray(body.words) ? body.words : [];
  const words = [...new Set(
    rawWords.map(w => String(w).trim().toLowerCase())
      .filter(w => WORD_RE.test(w) && !dictionary.isBritish(w.toUpperCase()))
  )];

  if (words.length < 5) {
    return res.status(400).json({ error: 'Need at least 5 valid words (letters only, 3-10 letters each).' });
  }

  const adult = body.adult === true;
  const clues = wordlessHints.cleanClues(body.clues, words);
  const theme = db.createTheme({ label, subject, emoji, accent, bg, fontKey, words, adult, clues });

  // Made from a kid's suggestion? Close the request in the same step -- there
  // is nothing left to decide once the theme exists.
  const requestId = Number(body.requestId);
  const request = requestId ? db.getThemeRequest(requestId) : null;
  if (request && request.status === 'pending') db.fulfillThemeRequest(requestId, theme.id);

  // The home page is the kids' front door too, so adult themes stay quiet.
  if (!adult) {
    comm.safePost({
      kind: 'theme', emoji, game: 'wordless',
      title: `New Wordless theme: ${label}`,
      body: request && request.requestedBy
        ? `${label} is ready to play, thanks to ${request.requestedBy} for the idea!`
        : `${label} is ready to play. Pick it from the Theme menu in Wordless.`
    });
  }
  res.status(201).json(theme);
});

app.delete('/api/themes/:id', requireAdmin, (req, res) => {
  const ok = db.deleteTheme(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Cannot delete this theme.' });
  res.json({ deleted: true });
});

// ---- Theme requests (kids suggest, admin fulfills) ----
app.post('/api/theme-requests', requestLimiter, async (req, res) => {
  const body = req.body || {};
  const topic = String(body.topic || '').trim().slice(0, 60);
  const note = String(body.note || '').trim().slice(0, 200);
  const requestedBy = String(body.requestedBy || '').trim().slice(0, 30);

  if (!topic) {
    return res.status(400).json({ error: 'Please enter a theme idea.' });
  }

  const request = db.createThemeRequest({ topic, note, requestedBy });
  notifyDiscord(request);
  res.status(201).json(request);
});

app.get('/api/theme-requests', requireAdmin, (req, res) => {
  res.json(db.listThemeRequests(req.query.status || 'pending'));
});

app.post('/api/theme-requests/:id/dismiss', requireAdmin, (req, res) => {
  const ok = db.dismissThemeRequest(Number(req.params.id));
  if (!ok) return res.status(400).json({ error: 'Request not found or already handled.' });
  res.json({ dismissed: true });
});

app.post('/api/theme-requests/:id/fulfill', requireAdmin, (req, res) => {
  const themeId = String((req.body || {}).themeId || '');
  if (!db.getTheme(themeId)) {
    return res.status(400).json({ error: 'Unknown theme id.' });
  }
  const ok = db.fulfillThemeRequest(Number(req.params.id), themeId);
  if (!ok) return res.status(400).json({ error: 'Request not found or already handled.' });
  res.json({ fulfilled: true });
});

// ---- Leaderboard ----
app.get('/api/leaderboard', (req, res) => {
  res.json(db.listLeaderboard({
    themeId: req.query.theme, difficulty: req.query.difficulty, limit: req.query.limit,
    includeAdult: adultUnlocked(req)
  }));
});

app.post('/api/leaderboard', leaderboardLimiter, (req, res) => {
  const body = req.body || {};
  // Playing as an arcade profile: the score is theirs, initials come from the name.
  const profile = body.profileToken ? require('./arcade/profiles').verify(body.profileToken) : null;
  const initials = profile
    ? (profile.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'P')
    : String(body.initials || '').toUpperCase().trim();
  const themeId = String(body.themeId || '');
  const won = !!body.won;
  const guesses = Math.max(0, Math.min(20, parseInt(body.guesses, 10) || 0));
  const hintsUsed = Math.max(0, Math.min(3, parseInt(body.hintsUsed, 10) || 0));
  const word = String(body.word || '').toLowerCase().slice(0, 20);
  const elapsedMs = Math.max(0, Math.min(3600000, parseInt(body.elapsedMs, 10) || 0));
  const difficulty = Object.hasOwn(DIFFICULTIES, body.difficulty) ? body.difficulty : 'normal';

  if (!INITIALS_RE.test(initials)) {
    return res.status(400).json({ error: 'Initials must be 1-3 letters or numbers.' });
  }
  const theme = db.getTheme(themeId);
  if (!theme) {
    return res.status(400).json({ error: 'Unknown theme.' });
  }

  const result = db.insertScore({ initials, themeId, won, guesses, hintsUsed, word, elapsedMs, difficulty, profile });
  if (won && result.rank === 1 && !theme.adult) {
    const level = difficulty[0].toUpperCase() + difficulty.slice(1);
    comm.safePost({
      kind: 'highscore', emoji: '🏆', game: 'wordless',
      title: `${profile ? profile.name : initials} took #1 on Wordless ${level}`,
      body: `${profile ? profile.name : initials} just set the top Wordless ${level} score: ${result.score} points in ${guesses} guess${guesses === 1 ? '' : 'es'}. Think you can beat it?`
    });
  }
  res.status(201).json(result);
});

// Last: anything a route threw ends up here, gets logged with a code, and the
// player is told something went wrong (and the code to mention).
app.use(stats.errorHandler);

app.listen(PORT, () => {
  // Build the trie now rather than on the first player's request -- it takes
  // about 200ms, which is a visible stutter if it lands mid-round.
  const stats = dictionary.stats;

  // Open a season if there is not one, and roll over anything already due --
  // a container that was switched off across a month boundary should come
  // back current rather than still running last month's board.
  ramblerSeasons.checkDue();
  const season = ramblerSeasons.status();

  // Apply the admin's word edits and the season's theme pack before anyone
  // plays, so the first board of the day already knows about them.
  ramblerPacks.refresh({ force: true });
  const theme = ramblerPacks.active();

  // Know-It-All downloads Open Trivia DB's questions in the background the
  // first time (about 8 minutes), then once a month. Set TRIVIA_ONLINE=off
  // to stay fully offline.
  require('./trivia/store').syncOpenTdb().then(s => {
    if (s.addedThisRun) console.log(`Know-It-All: downloaded ${s.addedThisRun} questions from Open Trivia DB (${s.downloaded} saved).`);
    if (s.lastError) console.warn(`Know-It-All: Open Trivia DB download stopped: ${s.lastError}`);
  });

  console.log(`Arcade running at http://localhost:${PORT}`);
  console.log(
    `Rambler dictionary: ${stats.kids.toLocaleString()} kids / ` +
    `${stats.adult.toLocaleString()} unfiltered words (${stats.buildMs}ms)`
  );
  console.log(
    `Arcade season: ${season.season.label} \u2014 ends ${season.endsAt ? season.endsAt.slice(0, 10) : 'when you say so'}` +
    ` (${season.intervalLabel})`
  );
  if (theme) {
    console.log(`Theme pack: ${theme.emoji} ${theme.label} \u2014 ${theme.wordCount} words, ${theme.audience}`);
  }
  if (!ADMIN_TOKEN) {
    console.warn('ADMIN_PASSWORD is not set — admin routes (create/delete theme, view requests) are disabled.');
  }
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('DISCORD_WEBHOOK_URL is not set — theme request notifications will not be sent.');
  }
  if (adultPin.status().set) {
    console.log('Adult PIN is set — adult content requires it.');
  }
});
