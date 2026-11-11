'use strict';

// Shuffle Scuffle: the letters, the words hiding in them, and the points.
//
// Every round is a 6 or 7 letter word with its letters mixed up. Players race
// to find the full word (any word that uses every letter counts, so LISTEN and
// SILENT are both the full word) and score for the smaller words inside it
// too. Everything here is decided on the server: the page only ever learns the
// letters, and the words come out after the round is over.

const fs = require('node:fs');
const path = require('node:path');
const dictionary = require('../rambler/dictionary');

// The same small seeded random numbers as the Rambler daily (mulberry32 and
// FNV-1a), copied here so this file needs no database: everyone has to get
// the same letters from the same date.
function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MIN_LENGTH = 3;
// Points for a word by its length, plus a bonus for the full word. In a room,
// the first person to find the full word gets a little extra on top.
const POINTS = { 3: 10, 4: 20, 5: 35, 6: 60, 7: 90 };
const FULL_BONUS = 100;
const FIRST_BONUS = 50;
const pointsFor = (word, letterCount, { first = false } = {}) =>
  (POINTS[word.length] || 0) + (word.length === letterCount ? FULL_BONUS + (first ? FIRST_BONUS : 0) : 0);

// What players can choose. The daily set is fixed so everyone's scores mean
// the same thing.
const ROUND_CHOICES = [3, 5, 7];
const SECOND_CHOICES = [60, 75, 90];
const DEFAULT_ROUNDS = 5;
const DEFAULT_SECONDS = 75;
const DAILY = { rounds: 4, seconds: 75 };
// The test suite can ask for very short rounds so it doesn't wait a minute.
const TEST_SECONDS = process.env.NODE_ENV === 'test' && Number(process.env.SCUFFLE_TEST_SECONDS) > 0
  ? Number(process.env.SCUFFLE_TEST_SECONDS) : null;
const secondsOf = raw => {
  const n = Number(raw);
  if (SECOND_CHOICES.includes(n) || (TEST_SECONDS && n === TEST_SECONDS)) return n;
  return DEFAULT_SECONDS;
};
const roundsOf = raw => (ROUND_CHOICES.includes(Number(raw)) ? Number(raw) : DEFAULT_ROUNDS);
const profileOf = raw => (raw === 'adult' ? 'adult' : 'kids');

// ---- finding words inside a set of letters ------------------------------------------

// Walks the shared dictionary (one tree of letters, see rambler/dictionary.js)
// using each letter only as many times as it appears. Kids get only words on
// the kids list, which is where words/blocklist-kids.txt does its work.
function findWords(letters, profile) {
  const { root } = dictionary.load();
  const bit = dictionary.profileBit(profileOf(profile));
  const counts = {};
  for (const ch of String(letters).toUpperCase()) counts[ch] = (counts[ch] || 0) + 1;
  const found = new Set();
  const walk = (node, word) => {
    if (word.length >= MIN_LENGTH && ((node[dictionary.TERM] || 0) & bit)) found.add(word);
    for (const ch of Object.keys(counts)) {
      if (!counts[ch]) continue;
      const next = node[ch];
      if (!next || !((next[dictionary.PRE] || 0) & bit)) continue;
      counts[ch]--;
      walk(next, word + ch);
      counts[ch]++;
    }
  };
  walk(root, '');
  return [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

// Can this word be spelled from these letters (each used at most once)?
function fitsLetters(word, letters) {
  const counts = {};
  for (const ch of letters) counts[ch] = (counts[ch] || 0) + 1;
  for (const ch of word) {
    if (!counts[ch]) return false;
    counts[ch]--;
  }
  return true;
}

const cleanWord = raw => String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12);

// The verdict on one word. `found` is the words this player already has.
function checkWord(round, raw, found) {
  const word = cleanWord(raw);
  if (word.length < MIN_LENGTH) return { word, ok: false, reason: 'short' };
  if (!fitsLetters(word, round.letters)) return { word, ok: false, reason: 'letters' };
  if (found.has(word)) return { word, ok: false, reason: 'again' };
  if (!round.words.includes(word)) return { word, ok: false, reason: 'unknown' };
  return { word, ok: true, full: word.length === round.letters.length };
}

// ---- the hidden words ---------------------------------------------------------------

const readWords = file => fs.readFileSync(path.join(__dirname, '..', 'words', file), 'utf8')
  .split('\n').map(s => s.trim().toUpperCase()).filter(w => /^[A-Z]{6,7}$/.test(w));

// Everyday words, so the full word is one people know. The list is read in
// file order (fixed), so the date alone picks the same word anywhere. Each
// pick is checked against the kids list as it's made, so a word the admin
// blocks today can never be a kids round's full word.
let common = null;
let spicy = null;
const commonWords = () => common || (common = [...new Set(readWords('common-10k.txt'))]);
const spicyWords = () => spicy || (spicy = [...new Set(readWords('spice-adult.txt'))]);

function usable(word, profile) {
  if (!dictionary.isWord(word, profile)) return false;
  if (profile === 'kids' && !dictionary.isCommon(word)) return false;
  // Enough to do: at least 8 words to find, so nobody gets stuck on a round
  // with nothing in it.
  return findWords(word, profile).length >= 8;
}

// Mixes the letters until they don't spell a word of the same length.
function scramble(word, rng) {
  const letters = word.split('');
  for (let tries = 0; tries < 30; tries++) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    const mixed = letters.join('');
    if (mixed !== word && !dictionary.isWord(mixed, 'adult')) return mixed;
  }
  return letters.join('');
}

// One round: the full word, its letters mixed up, and every word inside them.
function makeRound(word, profile, rng) {
  const letters = scramble(word, rng);
  const words = findWords(letters, profile);
  return { word, letters, words, full: words.filter(w => w.length === letters.length) };
}

// The lengths across a game: the first half six letters, the rest seven.
const lengthFor = (i, total) => (i < Math.ceil(total / 2) ? 6 : 7);

function pickWord(rng, length, profile, used) {
  // Adult rounds now and then hide a cheeky word instead.
  if (profile === 'adult' && rng() < 0.3) {
    const spice = spicyWords().filter(w => w.length === length && !used.has(w));
    for (let tries = 0; tries < 10 && spice.length; tries++) {
      const w = spice[Math.floor(rng() * spice.length)];
      if (usable(w, 'adult')) return w;
    }
  }
  const pool = commonWords().filter(w => w.length === length);
  for (let tries = 0; tries < 200; tries++) {
    const w = pool[Math.floor(rng() * pool.length)];
    if (!used.has(w) && usable(w, 'kids')) return w;
  }
  throw new Error('Could not find a word for this round.');
}

// The rounds for a game. `seed` makes it repeatable: a daily set uses the
// date and nothing else, so the same day gives everyone the same letters.
// There are two dailies (since 2026-11-02): the family one, picked from the
// kids list with the same seed as the single daily before it, and the
// unfiltered one, with its own seed and picked the unfiltered way (now and
// then a cheeky full word).
function makeRounds({ count, profile = 'kids', seed = null, pickAs = profile }) {
  const rng = seed ? seededRng(seedFrom(seed)) : Math.random;
  const used = new Set();
  const rounds = [];
  for (let i = 0; i < count; i++) {
    const word = pickWord(rng, lengthFor(i, count), pickAs, used);
    used.add(word);
    rounds.push(makeRound(word, profile, rng));
  }
  return rounds;
}

const dailyRounds = (day, profile = 'kids') => (profile === 'adult'
  ? makeRounds({ count: DAILY.rounds, profile: 'adult', seed: `scuffle|${day}|adult`, pickAs: 'adult' })
  : makeRounds({ count: DAILY.rounds, profile: 'kids', seed: `scuffle|${day}`, pickAs: 'kids' }));

module.exports = {
  MIN_LENGTH, POINTS, FULL_BONUS, FIRST_BONUS, ROUND_CHOICES, SECOND_CHOICES, DEFAULT_ROUNDS, DEFAULT_SECONDS, DAILY,
  pointsFor, secondsOf, roundsOf, profileOf, findWords, fitsLetters, cleanWord, checkWord,
  makeRounds, dailyRounds, scramble
};
