'use strict';

// Block Drop's rules: falling pieces of four squares, a 10 x 20 well, and
// rows that vanish when they're full. Standard rotation with wall kicks (so
// a piece next to a wall or in a gap still turns the way players expect),
// pieces dealt from a shuffled bag of all seven, hold, a ghost, lock delay,
// and the usual scoring: more lines at once is worth much more.
//
// The well has 2 hidden rows on top where pieces appear. Rows are numbered
// from the top, so y grows downward.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlocksEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 10, ROWS = 22, HIDDEN = 2;
  const LOCK_DELAY = 0.5, MAX_LOCK_RESETS = 15;
  const RUSH_SECONDS = 120;
  const SOFT_SECONDS = 0.06;     // seconds per row while holding down (about 16 rows a second)
  const MODES = { marathon: 'Marathon', rush: '2-Minute Rush' };

  const COLORS = { I: '#2de2e6', O: '#ffd23f', T: '#c86bff', S: '#3ddc84', Z: '#ff5e5e', J: '#2e9bff', L: '#ff9f2c' };
  // Spawn shapes in their boxes; the other three turns are worked out below.
  const SHAPES = {
    I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }
  };
  const TYPES = Object.keys(SHAPES);
  // Each turn rotates the box a quarter clockwise: (x, y) -> (size-1-y, x).
  const ROTATIONS = {};
  for (const t of TYPES) {
    const { size, cells } = SHAPES[t];
    const states = [cells];
    for (let r = 1; r < 4; r++) states.push(states[r - 1].map(([x, y]) => [size - 1 - y, x]));
    ROTATIONS[t] = states;
  }

  // Wall kicks to try, in order, for each turn (from-to). Written the usual
  // way with y up; flipped when used.
  const KICKS = {
    '0-1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '1-0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1-2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '2-1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2-3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '3-2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3-0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '0-3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  const KICKS_I = {
    '0-1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '1-0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1-2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '2-1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2-3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '3-2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3-0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '0-3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };

  const LINE_POINTS = [0, 100, 300, 500, 800];
  const TSPIN_POINTS = [400, 800, 1200, 1600];

  function emptyBoard() { return Array.from({ length: ROWS }, () => new Array(COLS).fill(null)); }

  function create({ mode = 'marathon', rand = Math.random, startLevel = 1 } = {}) {
    const g = {
      mode: MODES[mode] ? mode : 'marathon', rand,
      board: emptyBoard(), bag: [], queue: [],
      piece: null, hold: null, canHold: true,
      score: 0, lines: 0, level: startLevel, startLevel,
      combo: -1, b2b: false, tetrises: 0, tspins: 0,
      gravity: 0, lockTimer: 0, lockResets: 0, lowest: 0, lastMoveRotate: false,
      time: 0, over: false, events: [], cleared: []
    };
    fillQueue(g);
    spawn(g);
    return g;
  }

  // A shuffled bag of all seven, so you never wait forever for a long piece.
  function fillQueue(g) {
    while (g.queue.length < 7) {
      if (!g.bag.length) {
        g.bag = TYPES.slice();
        for (let i = g.bag.length - 1; i > 0; i--) {
          const j = Math.floor(g.rand() * (i + 1));
          [g.bag[i], g.bag[j]] = [g.bag[j], g.bag[i]];
        }
      }
      g.queue.push(g.bag.pop());
    }
  }

  const cellsOf = p => ROTATIONS[p.type][p.rot].map(([x, y]) => [p.x + x, p.y + y]);

  function fits(g, p) {
    return cellsOf(p).every(([x, y]) => x >= 0 && x < COLS && y < ROWS && (y < 0 || !g.board[y][x]));
  }

  function spawn(g, type) {
    fillQueue(g);
    type = type || g.queue.shift();
    fillQueue(g);
    const size = SHAPES[type].size;
    const p = { type, rot: 0, x: Math.floor((COLS - size) / 2), y: type === 'I' ? 0 : HIDDEN - 1 };
    g.piece = p;
    g.lockTimer = 0;
    g.lockResets = 0;
    g.gravity = 0;
    g.lowest = p.y;
    g.lastMoveRotate = false;
    if (!fits(g, p)) { g.over = true; g.events.push('over'); }
    return p;
  }

  const onGround = g => !fits(g, { ...g.piece, y: g.piece.y + 1 });

  // Moving or turning a piece that's resting gives it a little more time,
  // but only so many times, so nobody can stall forever.
  function touched(g) {
    if (onGround(g) && g.lockResets < MAX_LOCK_RESETS) { g.lockTimer = 0; g.lockResets++; }
  }

  function move(g, dx) {
    if (g.over || !g.piece) return false;
    const p = { ...g.piece, x: g.piece.x + dx };
    if (!fits(g, p)) return false;
    g.piece = p;
    g.lastMoveRotate = false;
    touched(g);
    g.events.push('move');
    return true;
  }

  function rotate(g, dir = 1) {
    if (g.over || !g.piece || g.piece.type === 'O') return false;
    const from = g.piece.rot, to = (from + (dir > 0 ? 1 : 3)) % 4;
    const table = g.piece.type === 'I' ? KICKS_I : KICKS;
    for (const [kx, ky] of table[`${from}-${to}`]) {
      const p = { ...g.piece, rot: to, x: g.piece.x + kx, y: g.piece.y - ky };
      if (fits(g, p)) {
        g.piece = p;
        g.lastMoveRotate = true;
        touched(g);
        g.events.push('rotate');
        return true;
      }
    }
    return false;
  }

  function ghostY(g) {
    if (!g.piece) return 0;
    let y = g.piece.y;
    while (fits(g, { ...g.piece, y: y + 1 })) y++;
    return y;
  }

  function hardDrop(g) {
    if (g.over || !g.piece) return 0;
    const to = ghostY(g);
    const dist = to - g.piece.y;
    if (dist > 0) g.lastMoveRotate = false;
    g.piece = { ...g.piece, y: to };
    g.score += dist * 2;
    g.events.push('harddrop');
    lock(g);
    return dist;
  }

  // Down pressed: one row right away (the timer keeps going while it's held).
  function softStep(g) {
    if (g.over || !g.piece) return false;
    const down = { ...g.piece, y: g.piece.y + 1 };
    if (!fits(g, down)) return false;
    g.piece = down;
    g.lastMoveRotate = false;
    g.score += 1;
    if (down.y > g.lowest) { g.lowest = down.y; g.lockResets = 0; }
    g.lockTimer = 0;
    g.gravity = 0;
    g.events.push('move');
    return true;
  }

  function hold(g) {
    if (g.over || !g.canHold) return false;
    const current = g.piece.type;
    if (g.hold) spawn(g, g.hold);
    else spawn(g);
    g.hold = current;
    g.canHold = false;
    g.events.push('hold');
    return true;
  }

  // A T-spin: the last thing the T did was turn, and three of the four
  // corners around its middle are filled.
  function isTSpin(g) {
    const p = g.piece;
    if (p.type !== 'T' || !g.lastMoveRotate) return false;
    const corners = [[0, 0], [2, 0], [0, 2], [2, 2]].filter(([cx, cy]) => {
      const x = p.x + cx, y = p.y + cy;
      return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && g.board[y][x]);
    });
    return corners.length >= 3;
  }

  function levelFor(g) { return g.startLevel + Math.floor(g.lines / 10); }

  // Seconds per row at each level (the usual curve: about a second at level
  // 1, a blink by level 15).
  function fallSeconds(level) {
    return Math.max(0.012, Math.pow(0.8 - (level - 1) * 0.007, level - 1));
  }

  function lock(g) {
    const p = g.piece;
    const tspin = isTSpin(g);
    const cells = cellsOf(p);
    for (const [x, y] of cells) if (y >= 0) g.board[y][x] = p.type;
    g.events.push('lock');
    // Locked entirely in the hidden rows: no room left.
    if (cells.every(([, y]) => y < HIDDEN)) { g.over = true; g.events.push('over'); return; }

    const full = [];
    for (let y = 0; y < ROWS; y++) if (g.board[y].every(Boolean)) full.push(y);
    for (const y of full) { g.board.splice(y, 1); g.board.unshift(new Array(COLS).fill(null)); }
    g.cleared = full;
    const n = full.length;
    const level = g.level;
    let points = 0;
    if (tspin) { points = TSPIN_POINTS[n] * level; g.tspins++; g.events.push('tspin'); }
    else points = LINE_POINTS[n] * level;
    if (n) {
      const special = n === 4 || tspin;
      if (special && g.b2b) { points = Math.round(points * 1.5); g.events.push('b2b'); }
      g.b2b = special;
      g.combo++;
      if (g.combo > 0) points += 50 * g.combo * level;
      if (n === 4) { g.tetrises++; g.events.push('four'); }
      g.events.push('clear:' + n);
      if (g.board.every(row => row.every(c => !c))) { points += 2000 * level; g.events.push('perfect'); }
    } else g.combo = -1;
    g.score += points;
    g.lastPoints = points;
    g.lines += n;
    const next = levelFor(g);
    if (next > g.level) { g.level = next; g.events.push('levelup'); }
    g.canHold = true;
    spawn(g);
  }

  // Called every frame. soft: the player is holding down.
  function update(g, dt, { soft = false } = {}) {
    g.events = [];
    g.cleared = [];
    if (g.over) return g;
    g.time += dt;
    if (g.mode === 'rush' && g.time >= RUSH_SECONDS) { g.over = true; g.timeUp = true; g.events.push('timeup', 'over'); return g; }
    const perRow = soft ? Math.min(fallSeconds(g.level), SOFT_SECONDS) : fallSeconds(g.level);
    g.gravity += dt;
    while (g.gravity >= perRow && !g.over) {
      g.gravity -= perRow;
      const down = { ...g.piece, y: g.piece.y + 1 };
      if (fits(g, down)) {
        g.piece = down;
        g.lastMoveRotate = false;
        if (soft) g.score += 1;
        if (down.y > g.lowest) { g.lowest = down.y; g.lockResets = 0; }
        g.lockTimer = 0;
      } else { g.gravity = 0; break; }
    }
    if (!g.over && onGround(g)) {
      g.lockTimer += dt;
      if (g.lockTimer >= LOCK_DELAY) lock(g);
    }
    return g;
  }

  return {
    COLS, ROWS, HIDDEN, MODES, COLORS, TYPES, ROTATIONS, SHAPES, RUSH_SECONDS, LOCK_DELAY,
    create, move, rotate, hardDrop, softStep, hold, SOFT_SECONDS, update, ghostY, cellsOf, fits, fallSeconds, spawn
  };
});
