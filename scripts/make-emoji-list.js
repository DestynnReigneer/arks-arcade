'use strict';

// Builds public/emoji-list.js, the emoji the chat's picker offers (2026-11-13): every
// single-character emoji Unicode marks as shown in color by default, grouped by where
// it sits in Unicode, plus the skin-tone-free people and the hand signs. It reads the
// list straight from the JavaScript engine (the \p{Emoji_Presentation} property), so
// nothing is downloaded. Run it again with a newer Node to pick up newer emoji:
//
//   node scripts/make-emoji-list.js

const fs = require('fs');
const path = require('path');

const isEmoji = /^\p{Emoji_Presentation}$/u;
const pick = (from, to) => {
  const out = [];
  for (let cp = from; cp <= to; cp++) {
    const ch = String.fromCodePoint(cp);
    // Skin tones and regional letters only make sense joined to something else.
    if (cp >= 0x1F3FB && cp <= 0x1F3FF) continue;
    if (cp >= 0x1F1E6 && cp <= 0x1F1FF) continue;
    if (isEmoji.test(ch)) out.push(ch);
  }
  return out;
};

// Unicode keeps emoji in rough neighborhoods; these ranges follow them.
const GROUPS = [
  { id: 'faces', label: '😀 Faces', ranges: [[0x1F600, 0x1F64F], [0x1F910, 0x1F92F], [0x1F970, 0x1F97A], [0x1F9D0, 0x1F9D0], [0x1FAE0, 0x1FAEF], [0x1F47B, 0x1F480], [0x1F4A9, 0x1F4A9]] },
  { id: 'people', label: '👋 People', ranges: [[0x1F440, 0x1F47A], [0x1F481, 0x1F4A8], [0x1F930, 0x1F93F], [0x1F9B0, 0x1F9CF], [0x1F9D1, 0x1F9DF], [0x1FAF0, 0x1FAFF], [0x1F483, 0x1F487], [0x1F574, 0x1F57A], [0x1F590, 0x1F596]] },
  { id: 'nature', label: '🐶 Animals and nature', ranges: [[0x1F400, 0x1F43F], [0x1F980, 0x1F9AF], [0x1F331, 0x1F344], [0x1FAB0, 0x1FABF], [0x1F300, 0x1F32F]] },
  { id: 'food', label: '🍕 Food', ranges: [[0x1F345, 0x1F37F], [0x1F32D, 0x1F330], [0x1F950, 0x1F96F], [0x1F9C0, 0x1F9CB], [0x1FAD0, 0x1FADF]] },
  { id: 'fun', label: '⚽ Activities and places', ranges: [[0x1F380, 0x1F3FA], [0x1F680, 0x1F6FF], [0x1F93A, 0x1F94F], [0x1F6F0, 0x1F6FF], [0x1F3D0, 0x1F3FA], [0x26BD, 0x26FF]] },
  { id: 'things', label: '💡 Objects', ranges: [[0x1F4AA, 0x1F4FF], [0x1F500, 0x1F573], [0x1F5A4, 0x1F5FF], [0x1F9E0, 0x1F9FF], [0x1FA70, 0x1FAAF], [0x231A, 0x23FF]] },
  { id: 'symbols', label: '❤️ Symbols', ranges: [[0x2600, 0x26BC], [0x2700, 0x27BF], [0x2B00, 0x2BFF], [0x1F7E0, 0x1F7EF], [0x1F191, 0x1F19A]] }
];

const seen = new Set();
const out = [];
for (const g of GROUPS) {
  const list = [];
  for (const [a, b] of g.ranges) for (const ch of pick(a, b)) if (!seen.has(ch)) { seen.add(ch); list.push(ch); }
  out.push({ id: g.id, label: g.label, emoji: list });
}
// The red heart is two characters (a heart symbol shown in color), so it's added by hand.
const symbols = out.find(g => g.id === 'symbols');
if (!symbols.emoji.includes('❤️')) symbols.emoji.unshift('❤️');

const file = path.join(__dirname, '..', 'public', 'emoji-list.js');
const body = `'use strict';\n\n// Made by scripts/make-emoji-list.js (don't edit by hand): every standard emoji, grouped\n// for the chat's picker in lobby-ui.js. ${seen.size + 1} in all.\nwindow.EMOJI_GROUPS = ${JSON.stringify(out)};\n`;
fs.writeFileSync(file, body);
console.log(out.map(g => `${g.id}: ${g.emoji.length}`).join(', '), '| total', seen.size + 1);
