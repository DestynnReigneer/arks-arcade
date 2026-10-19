'use strict';

// Know-It-All's scoring and party rules, shared by the page (solo and
// one-phone games) and the server (room games), so both play the same.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TriviaRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BASE = { easy: 100, medium: 200, hard: 300 };
  const STREAK = 3;

  // Harder questions are worth more; answering fast adds up to half again.
  function points(difficulty, correct, msLeft, msTotal) {
    if (!correct) return 0;
    const base = BASE[difficulty] || BASE.medium;
    const speed = Math.max(0, Math.min(1, msLeft / Math.max(1, msTotal)));
    return base + Math.round(base * 0.5 * speed);
  }

  const pick = (list, rand) => list[Math.floor(rand() * list.length)];

  // What the room has to do after a question: drinks for the wrong, a
  // reward for a streak, and (couples) one dare for someone who missed.
  // results: [{ id, name, correct, streak }]
  function afterQuestion(results, { drinking, couples, drinks, dares, rand = Math.random }) {
    const out = [];
    const wrong = results.filter(r => !r.correct);
    if (drinking && drinks) {
      if (results.length > 1 && wrong.length === results.length) out.push({ kind: 'drink', who: null, text: drinks.everyone });
      else for (const r of wrong) out.push({ kind: 'drink', who: r.id, name: r.name, text: drinks.wrong });
      for (const r of results) if (r.correct && r.streak > 0 && r.streak % STREAK === 0) out.push({ kind: 'drink', who: r.id, name: r.name, text: drinks.streak });
    }
    if (couples && dares && dares.length && wrong.length) {
      const who = pick(wrong, rand);
      out.push({ kind: 'dare', who: who.id, name: who.name, text: pick(dares, rand) });
    }
    return out;
  }

  // The end of the game: the last place drinks, and gets one more dare.
  // standings: [{ id, name, score }], best first.
  function afterGame(standings, { drinking, couples, drinks, dares, rand = Math.random }) {
    const out = [];
    if (standings.length < 2) return out;
    const last = standings[standings.length - 1];
    if (drinking && drinks) out.push({ kind: 'drink', who: last.id, name: last.name, text: drinks.last });
    if (couples && dares && dares.length) out.push({ kind: 'dare', who: last.id, name: last.name, text: pick(dares, rand) });
    return out;
  }

  return { BASE, STREAK, points, afterQuestion, afterGame };
});
