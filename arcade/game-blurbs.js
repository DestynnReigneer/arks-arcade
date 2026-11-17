'use strict';

// The line under each game's name on the home page's cards. The admin page's Game settings
// tab can change any of them. The lines the games come with are read from the home page
// itself (public/index.html), so a new game shows up in the admin list on its own, and the
// home page still has its lines if nothing was ever changed.

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { GAMES } = require('./home-games');

const KEY = 'game_blurbs';
const MAX = 140;

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// { id: { label, line } } from the cards in public/index.html, read once.
let originals = null;
function readOriginals() {
  if (originals) return originals;
  originals = Object.create(null);
  let html = '';
  try { html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'); } catch { /* no page, no lines */ }
  const card = /<a class="game ([a-z]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(card)) {
    const label = /<h2>([\s\S]*?)<\/h2>/.exec(m[2]);
    const line = /<p class="short">([\s\S]*?)<\/p>/.exec(m[2]);
    if (!line) continue;
    originals[m[1]] = { label: label ? decode(label[1].replace(/<[^>]+>/g, '').trim()) : m[1], line: decode(line[1].trim()) };
  }
  return originals;
}

// The changed lines only: { id: text }.
function changed() {
  const saved = db.getSetting(KEY, null);
  const out = {};
  if (saved && typeof saved === 'object') {
    for (const id of GAMES) if (typeof saved[id] === 'string' && saved[id]) out[id] = saved[id];
  }
  return out;
}

// Every game, in the home page's own order: its name, the line it came with, and the line now.
function list() {
  const orig = readOriginals();
  const now = changed();
  return GAMES.filter(id => Object.hasOwn(orig, id)).map(id => ({ id, label: orig[id].label, original: orig[id].line, line: now[id] || orig[id].line }));
}

// lines: { id: text }. A blank line, or the one the game came with, goes back to the original.
function set(lines) {
  if (!lines || typeof lines !== 'object' || Array.isArray(lines)) throw Object.assign(new Error('Nothing to save.'), { status: 400 });
  const orig = readOriginals();
  const next = changed();
  for (const [id, raw] of Object.entries(lines)) {
    if (!Object.hasOwn(orig, id)) continue;
    // One line of plain text: no line breaks or control characters.
    const text = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > MAX) throw Object.assign(new Error(`${orig[id].label}'s line is ${text.length} characters. Keep it to ${MAX}.`), { status: 400 });
    if (!text || text === orig[id].line) delete next[id];
    else next[id] = text;
  }
  db.setSetting(KEY, next);
  return list();
}

module.exports = { list, set, changed, MAX };
