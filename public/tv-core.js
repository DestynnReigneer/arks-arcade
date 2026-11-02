'use strict';

// The parts of the TV layout that don't need a page, so the tests can check
// them on their own: is this a TV, and which button is "the next one over"
// when someone presses an arrow on the remote. public/tv.js uses them.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TvCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // The ARKS TV app adds " ARKS-TV/<version>" to the browser's user agent.
  const isTvAgent = ua => /(^|\s)ARKS-TV\/[0-9A-Za-z.+_-]+/.test(String(ua || ''));

  // A TV, or someone trying the TV layout with ?tv=1 in the address (it's
  // remembered for the visit, and ?tv=0 turns it off again).
  // -> { on, remember } where remember is '1', '0' or null (leave it).
  function wantsTv(ua, search, remembered) {
    if (isTvAgent(ua)) return { on: true, remember: null };
    const q = new URLSearchParams(String(search || '')).get('tv');
    if (q === '1') return { on: true, remember: '1' };
    if (q === '0') return { on: false, remember: '0' };
    return { on: remembered === '1', remember: null };
  }

  // "BCDFGH" -> "BCD FGH", easier to read across a room.
  const splitCode = code => String(code || '').replace(/^(.{3})(.+)$/, '$1 $2');

  // Spatial navigation. from and each candidate are boxes
  // ({ left, top, right, bottom }); dir is up, down, left or right. Picks
  // the nearest box that's really in that direction, preferring boxes that
  // line up with this one (the button straight below beats the one below
  // and off to the side). Left and right only move within the row.
  // -> the chosen candidate, or null.
  function pick(from, candidates, dir) {
    const cx = b => (b.left + b.right) / 2, cy = b => (b.top + b.bottom) / 2;
    const fx = cx(from), fy = cy(from);
    let best = null, bestScore = Infinity;
    for (const c of candidates) {
      if (c === from) continue;
      const x = cx(c), y = cy(c);
      let gap, cross, overlap;
      if (dir === 'right' || dir === 'left') {
        if (dir === 'right' ? x <= fx + 1 || c.right <= from.right : x >= fx - 1 || c.left >= from.left) continue;
        gap = dir === 'right' ? c.left - from.right : from.left - c.right;
        overlap = Math.min(c.bottom, from.bottom) - Math.max(c.top, from.top);
        // Left and right stay in the same row: the last button in a row is
        // the end of it, not a jump to something higher up the screen.
        if (overlap <= 0) continue;
        cross = Math.abs(y - fy);
      } else if (dir === 'down' || dir === 'up') {
        if (dir === 'down' ? y <= fy + 1 || c.bottom <= from.bottom : y >= fy - 1 || c.top >= from.top) continue;
        gap = dir === 'down' ? c.top - from.bottom : from.top - c.bottom;
        overlap = Math.min(c.right, from.right) - Math.max(c.left, from.left);
        cross = Math.abs(x - fx);
      } else return null;
      // Boxes in the same row or column count their gap only; the others pay
      // for how far off to the side they are.
      const score = Math.max(0, gap) + (overlap > 0 ? cross * 0.05 : 40 + cross * 2);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  return { isTvAgent, wantsTv, splitCode, pick, DIRS };
});
