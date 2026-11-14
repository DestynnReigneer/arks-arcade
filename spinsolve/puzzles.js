'use strict';

// Spin & Solve's puzzle levels, the built-in banks for each, and the checks a
// pasted-in pack has to pass. The Kids bank lives in kids-puzzles.js
// (on the server only, so the page can't read the answers); the adult banks
// live only here and are served behind an ARKS ID adult pass.

const fs = require('fs');
const path = require('path');
const dictionary = require('../rambler/dictionary');
const KIDS = require('./kids-puzzles');

// Same scale as the party card games.
const LEVELS = {
  kids: { id: 'kids', label: 'Kids', emoji: '🧒', adult: false, blurb: 'Family-friendly puzzles for everyone.' },
  cheeky: { id: 'cheeky', label: 'Cheeky', emoji: '🌶️', adult: true, blurb: 'Innuendo and date-night giggles.' },
  spicy: { id: 'spicy', label: 'Spicy', emoji: '🌶️🌶️', adult: true, blurb: 'Crude, boozy, and lots of swearing.' },
  filthy: { id: 'filthy', label: 'Filthy', emoji: '🌶️🌶️🌶️', adult: true, blurb: 'No holds barred. Adults who know each other well.' }
};
// Only a level's own name counts: "constructor" and the like are on every object.
const levelOf = id => (typeof id === 'string' && Object.hasOwn(LEVELS, id) ? id : 'kids');

const bank = groups => Object.entries(groups).flatMap(([category, answers]) => answers.map(answer => ({ category, answer })));

const ADULT = {
  cheeky: bank({
    'Phrase': [
      'THAT\'S WHAT SHE SAID', 'NETFLIX AND CHILL', 'GET A ROOM', 'FRIENDS WITH BENEFITS', 'HANKY PANKY',
      'BIG SPOON LITTLE SPOON', 'SWIPE RIGHT', 'SLIDING INTO YOUR DMS', 'PILLOW TALK', 'BOW CHICKA WOW WOW',
      'LOVE IS IN THE AIR', 'TALK DIRTY TO ME', 'IS IT HOT IN HERE?', 'NOT TONIGHT DEAR'
    ],
    'What Are You Doing?': [
      'SKINNY DIPPING', 'FLIRTING WITH THE BARTENDER', 'PLAYING FOOTSIE', 'MAKING OUT IN THE CAR',
      'STEAMING UP THE WINDOWS', 'SPOONING', 'STEALING THE COVERS', 'SNEAKING OUT AT MIDNIGHT', 'DOING THE WALK OF SHAME'
    ],
    'Thing': [
      'MISTLETOE', 'SATIN SHEETS', 'HEART-SHAPED HOT TUB', 'LOVE SEAT', 'FUZZY HANDCUFFS', 'PUSH-UP BRA',
      'BOXER BRIEFS', 'WATERBED', 'MASSAGE OIL', 'SILK ROBE'
    ],
    'Food & Drink': [
      'SEX ON THE BEACH', 'SCREWDRIVER', 'BUTTERY NIPPLE', 'HOT BUNS', 'WHIPPED CREAM',
      'CHOCOLATE COVERED STRAWBERRIES', 'OYSTERS ON THE HALF SHELL', 'A BIG SAUSAGE PIZZA'
    ],
    'Place': ['THE BACK SEAT', 'HONEYMOON SUITE', 'LOVERS\' LANE', 'NUDE BEACH', 'LAS VEGAS WEDDING CHAPEL'],
    'Event': ['BACHELORETTE PARTY', 'BLIND DATE', 'SPEED DATING', 'HONEYMOON', 'DATE NIGHT']
  }),
  spicy: bank({
    'Phrase': [
      'HOLY SHIT', 'WHAT THE HELL', 'SON OF A BITCH', 'KISS MY ASS', 'HALF-ASSED', 'BITE ME', 'SHIT HAPPENS',
      'GET YOUR FREAK ON', 'SHAKE YOUR MONEY MAKER', 'MILE HIGH CLUB', 'SEVEN MINUTES IN HEAVEN',
      'GETTING LUCKY', 'NO PANTS PARTY', 'DIRTY THIRTY', 'HELL YEAH', 'BADASS MOTHER'
    ],
    'What Are You Doing?': [
      'DRUNK TEXTING YOUR EX', 'TAKING TEQUILA SHOTS', 'TWERKING ON THE DANCE FLOOR', 'STREAKING ACROSS THE FIELD',
      'SEXTING', 'MOONING THE NEIGHBORS', 'MAKING WHOOPEE', 'DOING A KEG STAND', 'GIVING A LAP DANCE', 'BUTT DIALING'
    ],
    'Thing': [
      'EDIBLE UNDERWEAR', 'BEER GOGGLES', 'STRIPPER POLE', 'NIPPLE TASSELS', 'THONG BIKINI', 'BOOTY SHORTS',
      'A HANGOVER FROM HELL', 'WHOOPEE CUSHION'
    ],
    'Fun & Games': ['STRIP POKER', 'BODY SHOTS', 'TRUTH OR DARE', 'SPIN THE BOTTLE', 'NEVER HAVE I EVER', 'BEER PONG'],
    'Event': ['BOOTY CALL', 'BACHELOR PARTY IN VEGAS', 'OFFICE CHRISTMAS PARTY', 'WALK OF SHAME']
  }),
  filthy: bank({
    'Phrase': [
      'FUCK AROUND AND FIND OUT', 'ABSOLUTE CLUSTERFUCK', 'MOTHERFUCKER', 'WHAT THE FUCK', 'FUCK BUDDY',
      'SHIT-FACED', 'BLUE BALLS', 'MORNING WOOD', 'HAPPY ENDING', 'SPANK BANK', 'WET DREAM', 'DIRTY TALK',
      'WHAT\'S THE SAFE WORD?', 'GRAB A HANDFUL', 'BALLS DEEP'
    ],
    'Position': ['SIXTY-NINE', 'DOGGY STYLE', 'REVERSE COWGIRL', 'MISSIONARY POSITION', 'SPOONING NAKED'],
    'Thing': [
      'VIBRATOR', 'BUTT PLUG', 'NIPPLE CLAMPS', 'BALL GAG', 'STRAP-ON', 'DICK PIC', 'BOOB JOB',
      'SEX TOY DRAWER', 'PORN STASH', 'GLOW IN THE DARK CONDOM'
    ],
    'What Are You Doing?': [
      'FAKING AN ORGASM', 'HAVING A QUICKIE IN THE CLOSET', 'SENDING NUDES', 'SKINNY DIPPING DRUNK',
      'TALKING DIRTY', 'HAVING MAKEUP SEX', 'SHOWER SEX', 'MORNING SEX'
    ],
    'Event': ['THREESOME', 'SWINGERS PARTY', 'NAKED TWISTER', 'TITTY TWISTER']
  })
};

// ---- checking puzzles ----------------------------------------------------------

const COLS = 12;
const MAX_ROWS = 4;
const ANSWER_RE = /^[A-Z][A-Z '&?!-]*$/;

// How many board rows an answer needs at 12 tiles a row.
function rowsNeeded(answer) {
  let rows = 0, line = 0;
  for (const word of answer.split(' ')) {
    if (word.length > COLS) return Infinity;
    if (!line) { rows++; line = word.length; } else if (line + 1 + word.length <= COLS) line += 1 + word.length;
    else { rows++; line = word.length; }
  }
  return rows;
}

// Returns a clean { category, answer } or a reason it can't be used.
function checkPuzzle(raw) {
  const answer = String((raw && raw.answer) || '').toUpperCase().replace(/[’‘]/g, '\'').replace(/\s+/g, ' ').trim();
  const category = String((raw && raw.category) || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!answer || !ANSWER_RE.test(answer)) return { error: 'only letters, spaces and \' - & ? !' };
  if (answer.replace(/[^A-Z]/g, '').length < 3) return { error: 'too short' };
  if (answer.split(' ').some(w => w.replace(/[^A-Z]/g, '').length > COLS || w.length > COLS)) return { error: 'a word is longer than 12 letters' };
  if (rowsNeeded(answer) > MAX_ROWS) return { error: 'too long for the board' };
  const british = answer.split(/[ -]/).map(w => w.replace(/[^A-Z]/g, '')).find(w => w && dictionary.isBritish(w));
  if (british) return { error: `British spelling (${british})` };
  return { puzzle: { category: category || 'Phrase', answer } };
}

// Checks a whole pasted list: keeps the good ones, explains the rest.
function checkAll(list) {
  const puzzles = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const { puzzle, error } = checkPuzzle(raw);
    if (error) { skipped.push({ answer: String((raw && raw.answer) || '').slice(0, 60), reason: error }); continue; }
    if (seen.has(puzzle.answer)) continue;
    seen.add(puzzle.answer);
    puzzles.push(puzzle);
  }
  return { puzzles, skipped };
}

// ---- the built-in banks ----------------------------------------------------------

// Most of the built-in puzzles are plain text, so they're easy to read and add
// to: every .txt file in bank/<level>/ holds one answer to a line, under
// "# Category" headings. They join the lists above, and an answer that's
// already there is skipped. Each line goes through the same check a pasted
// pack does, so one that can't go on the board is left out (and counted)
// instead of becoming a puzzle.
function parseBank(text) {
  const puzzles = [];
  let skipped = 0;
  let category = 'Phrase';
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) { category = t.slice(1).trim().slice(0, 24) || 'Phrase'; continue; }
    const { puzzle } = checkPuzzle({ category, answer: t });
    if (puzzle) puzzles.push(puzzle); else skipped++;
  }
  return { puzzles, skipped };
}
function fromBank(level) {
  const dir = path.join(__dirname, 'bank', level);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort(); } catch { return []; }
  const out = [];
  let left = 0;
  for (const file of files) {
    // A file that can't be read is left out. It never keeps the arcade from starting.
    let text = '';
    try { text = fs.readFileSync(path.join(dir, file), 'utf8'); } catch (e) {
      console.warn(`Spin & Solve: bank/${level}/${file} couldn't be read (${e.code || e.message}), so its puzzles are left out.`);
      continue;
    }
    const { puzzles, skipped } = parseBank(text);
    out.push(...puzzles);
    left += skipped;
  }
  if (left) console.warn(`Spin & Solve: ${left} line${left === 1 ? '' : 's'} in bank/${level}/ can't go on the board and ${left === 1 ? 'was' : 'were'} left out. npm test says which.`);
  return out;
}
function withBank(level, list) {
  const seen = new Set(list.map(q => q.answer));
  const more = fromBank(level).filter(q => !seen.has(q.answer) && !!seen.add(q.answer));
  return [...list, ...more];
}

const BUILTIN = Object.fromEntries(Object.entries({ kids: KIDS, ...ADULT }).map(([level, list]) => [level, withBank(level, list)]));

module.exports = { LEVELS, levelOf, BUILTIN, checkPuzzle, checkAll, rowsNeeded, parseBank };
