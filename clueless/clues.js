'use strict';

// Clueless: where the clues come from, and the checks a clue has to pass.
//
// There are two kinds of clue. Family clues are written for kids and are the
// only ones the family mini uses. Adult clues are trickier and only show up
// in the bigger adults' puzzle, which also uses family clues. Clues come
// from the built-in set in starter-clues.txt, and from clue packs the admin
// makes by copying a prompt into any chatbot and pasting its answer back.
// The server never asks an AI for anything itself.

const fs = require('node:fs');
const path = require('node:path');
const dictionary = require('../rambler/dictionary');

const KINDS = {
  kids: { id: 'kids', label: 'Family' },
  grownup: { id: 'grownup', label: 'Tricky' }
};
const MIN_WORD = 3;
const MAX_WORD = 7;
const MIN_CLUE = 3;
const MAX_CLUE = 80;

// ---- the built-in clues ----------------------------------------------------------------
let starter = null;
function starterClues() {
  if (starter) return starter;
  const file = path.join(__dirname, 'starter-clues.txt');
  starter = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z]+):\s*(.+)$/.exec(line.trim());
    if (m) starter.set(m[1], m[2].trim());
  }
  return starter;
}

// ---- checking a clue -------------------------------------------------------------------
const tokens = text => String(text).toUpperCase().split(/[^A-Z]+/).filter(Boolean);

// A word on the family list: plain letters, 3 to 7 of them, American
// spelling, and not one the kids blocklist takes out.
function wordProblem(raw) {
  const word = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(word)) return 'not a single word of plain letters';
  if (word.length < MIN_WORD || word.length > MAX_WORD) return `must be ${MIN_WORD} to ${MAX_WORD} letters`;
  if (dictionary.isBritish(word)) return 'British spelling';
  if (!dictionary.isWord(word, 'kids')) {
    return dictionary.isWord(word, 'adult') ? 'not on the family word list' : 'not in the word list';
  }
  return null;
}

// The answer can't be inside its own clue, as itself or the start of a
// longer word (CAT in "cats"), and a clue word can't be the start of the
// answer either (PLAY in a clue for PLAYER).
function answerInClue(word, clue) {
  return tokens(clue).some(t => t === word || t.startsWith(word) || (t.length >= 4 && word.startsWith(t)));
}

function clueProblem(word, raw) {
  const clue = String(raw || '').replace(/\s+/g, ' ').trim();
  if (clue.length < MIN_CLUE) return 'the clue is missing or too short';
  if (clue.length > MAX_CLUE) return `the clue is longer than ${MAX_CLUE} characters`;
  if (answerInClue(word, clue)) return 'the answer is inside its own clue';
  for (const t of tokens(clue)) {
    // A word only the unfiltered list has is one the kids blocklist removed
    // (or adult slang), so no clue anyone can see may use it.
    if (t.length >= 3 && dictionary.isWord(t, 'adult') && !dictionary.isWord(t, 'kids')) return 'the clue uses a word the family list blocks';
    if (dictionary.isBritish(t)) return `the clue uses a British spelling (${t.toLowerCase()})`;
  }
  return null;
}

// ---- reading what the chatbot sent back ------------------------------------------------
// One clue per line, `WORD: clue`. Bullets, numbers and bold marks that
// chatbots like to add are ignored. A JSON object of word to clue, or a list
// of { word, clue }, works too.
function parsePaste(text) {
  const raw = String(text || '').trim();
  const pairs = [];
  if (/^[[{]/.test(raw)) {
    let data;
    try { data = JSON.parse(raw); } catch { return { pairs, error: 'That looks like JSON but it doesn\'t read as JSON. Check for a missing comma or quote, or paste the WORD: clue lines instead.' }; }
    if (Array.isArray(data)) for (const e of data) pairs.push([e && e.word, e && e.clue]);
    else if (data && typeof data === 'object') for (const [w, c] of Object.entries(data)) pairs.push([w, c]);
    return { pairs };
  }
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/\*\*/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!cleaned) continue;
    const m = /^([A-Za-z]+)\s*[:\-–—]\s*(.+)$/.exec(cleaned);
    pairs.push(m ? [m[1], m[2]] : [cleaned.split(/\s/)[0], '']);
  }
  return { pairs };
}

// Checks every pair and sorts them into the ones to keep and the ones to
// skip, with the reason for each skip.
function checkPaste(text) {
  const { pairs, error } = parsePaste(text);
  const keep = [], skipped = [];
  const seen = new Set();
  for (const [w, c] of pairs) {
    const word = String(w || '').trim().toUpperCase();
    const clue = String(c || '').replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
    const why = wordProblem(word) || clueProblem(word, clue);
    if (why) { skipped.push({ word: word || '?', reason: why }); continue; }
    if (seen.has(word)) { skipped.push({ word, reason: 'listed twice; the first one was kept' }); continue; }
    seen.add(word);
    keep.push({ word, clue });
  }
  return { keep, skipped, error };
}

// ---- the prompt's words ------------------------------------------------------------------
let common = null;
// Only everyday words that are also real dictionary entries in WordNet
// (clues-common.tsv, or the word without its plural S): that keeps out the
// names, abbreviations and slurs a list of frequent words picks up.
function commonWords() {
  if (common) return common;
  const read = file => fs.readFileSync(path.join(__dirname, '..', 'words', file), 'utf8').split('\n');
  const entries = new Set(read('clues-common.tsv').filter(l => l && !l.startsWith('#')).map(l => l.split('\t')[0].toUpperCase()));
  const real = w => entries.has(w) || (w.endsWith('S') && entries.has(w.slice(0, -1))) || (w.endsWith('ES') && entries.has(w.slice(0, -2)));
  common = [...new Set(read('common-10k.txt').map(w => w.trim().toUpperCase()))]
    .filter(w => w && !wordProblem(w) && real(w));
  return common;
}

module.exports = {
  KINDS, MIN_WORD, MAX_WORD, MAX_CLUE,
  starterClues, wordProblem, clueProblem, answerInClue, parsePaste, checkPaste, commonWords
};
