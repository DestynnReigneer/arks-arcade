'use strict';

// Chess rules and a small computer opponent. One file runs in three places:
// the page (to show legal moves), a Web Worker (so the computer can think
// without freezing the screen), and the server (to check moves in two-phone
// games). No dependencies.
//
// Squares are 0-63 with 0 = a8 and 63 = h1, so index order matches how the
// board is drawn: row 0 is Black's back rank at the top. Pieces are letters,
// uppercase for White (PNBRQK) and lowercase for Black.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChessEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const FILES = 'abcdefgh';

  const isWhite = p => p && p === p.toUpperCase();
  const colorOf = p => (p ? (isWhite(p) ? 'w' : 'b') : null);
  const other = c => (c === 'w' ? 'b' : 'w');
  const rowOf = sq => sq >> 3;
  const colOf = sq => sq & 7;
  const name = sq => FILES[colOf(sq)] + (8 - rowOf(sq));
  const parseSquare = s => (8 - Number(s[1])) * 8 + FILES.indexOf(s[0]);

  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // ---- positions ------------------------------------------------------------

  function fromFen(fen = START) {
    const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
    const board = new Array(64).fill(null);
    let sq = 0;
    for (const ch of placement) {
      if (ch === '/') continue;
      if (/\d/.test(ch)) sq += Number(ch);
      else board[sq++] = ch;
    }
    const state = {
      board,
      turn: turn || 'w',
      castling: {
        K: (castling || '').includes('K'), Q: (castling || '').includes('Q'),
        k: (castling || '').includes('k'), q: (castling || '').includes('q')
      },
      ep: ep && ep !== '-' ? parseSquare(ep) : null,
      half: Number(half) || 0,
      full: Number(full) || 1,
      seen: {}
    };
    state.seen[positionKey(state)] = 1;
    return state;
  }

  function toFen(state) {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = state.board[r * 8 + c];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    const cs = ['K', 'Q', 'k', 'q'].filter(k => state.castling[k]).join('') || '-';
    return `${out} ${state.turn} ${cs} ${state.ep == null ? '-' : name(state.ep)} ${state.half} ${state.full}`;
  }

  // Board, side to move, castling rights and en passant: the parts that make
  // two positions "the same" for the repetition rule.
  function positionKey(state) {
    return toFen(state).split(' ').slice(0, 4).join(' ');
  }

  function clone(state) {
    return {
      board: state.board.slice(), turn: state.turn, castling: { ...state.castling },
      ep: state.ep, half: state.half, full: state.full, seen: { ...state.seen }
    };
  }

  // ---- attacks and moves ------------------------------------------------------

  function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  // Is `sq` attacked by any piece of color `by`?
  function attacked(board, sq, by) {
    const r = rowOf(sq), c = colOf(sq);
    const white = by === 'w';
    // Pawns attack diagonally forward: white pawns sit one row below (r+1).
    const pr = white ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      if (onBoard(pr, c + dc) && board[pr * 8 + c + dc] === (white ? 'P' : 'p')) return true;
    }
    for (const [dr, dc] of KNIGHT) {
      if (onBoard(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === (white ? 'N' : 'n')) return true;
    }
    for (const [dr, dc] of KING) {
      if (onBoard(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === (white ? 'K' : 'k')) return true;
    }
    const slide = (dirs, kinds) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (onBoard(rr, cc)) {
          const p = board[rr * 8 + cc];
          if (p) {
            if (colorOf(p) === by && kinds.includes(p.toUpperCase())) return true;
            break;
          }
          rr += dr; cc += dc;
        }
      }
      return false;
    };
    return slide(BISHOP, 'BQ') || slide(ROOK, 'RQ');
  }

  function kingSquare(board, color) {
    const k = color === 'w' ? 'K' : 'k';
    return board.indexOf(k);
  }

  function inCheck(state, color = state.turn) {
    const k = kingSquare(state.board, color);
    return k >= 0 && attacked(state.board, k, other(color));
  }

  // Every move that obeys how the pieces move, before checking whether it
  // leaves your own king in check.
  function pseudoMoves(state, onlyCaptures = false) {
    const { board, turn } = state;
    const moves = [];
    const white = turn === 'w';
    const add = (from, to, extra) => {
      const captured = board[to];
      if (onlyCaptures && !captured && !(extra && (extra.flag === 'ep' || extra.promo))) return;
      moves.push({ from, to, piece: board[from], captured: captured || null, ...extra });
    };

    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p || colorOf(p) !== turn) continue;
      const r = rowOf(sq), c = colOf(sq);
      const kind = p.toUpperCase();

      if (kind === 'P') {
        const dir = white ? -1 : 1;
        const startRow = white ? 6 : 1;
        const lastRow = white ? 0 : 7;
        const fwd = (r + dir) * 8 + c;
        const promos = white ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
        if (onBoard(r + dir, c) && !board[fwd]) {
          if (r + dir === lastRow) promos.forEach(promo => add(sq, fwd, { promo }));
          else {
            add(sq, fwd);
            const two = (r + 2 * dir) * 8 + c;
            if (r === startRow && !board[two]) add(sq, two, { flag: 'double' });
          }
        }
        for (const dc of [-1, 1]) {
          if (!onBoard(r + dir, c + dc)) continue;
          const to = (r + dir) * 8 + c + dc;
          const target = board[to];
          if (target && colorOf(target) !== turn) {
            if (r + dir === lastRow) promos.forEach(promo => add(sq, to, { promo }));
            else add(sq, to);
          } else if (to === state.ep) {
            moves.push({ from: sq, to, piece: p, captured: white ? 'p' : 'P', flag: 'ep' });
          }
        }
        continue;
      }

      if (kind === 'N' || kind === 'K') {
        for (const [dr, dc] of kind === 'N' ? KNIGHT : KING) {
          if (!onBoard(r + dr, c + dc)) continue;
          const to = (r + dr) * 8 + c + dc;
          if (!board[to] || colorOf(board[to]) !== turn) add(sq, to);
        }
        if (kind === 'K' && !onlyCaptures) castleMoves(state, sq, moves);
        continue;
      }

      const dirs = kind === 'B' ? BISHOP : kind === 'R' ? ROOK : [...BISHOP, ...ROOK];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (onBoard(rr, cc)) {
          const to = rr * 8 + cc;
          if (board[to]) {
            if (colorOf(board[to]) !== turn) add(sq, to);
            break;
          }
          add(sq, to);
          rr += dr; cc += dc;
        }
      }
    }
    return moves;
  }

  function castleMoves(state, from, moves) {
    const { board, turn, castling } = state;
    const white = turn === 'w';
    const home = white ? 60 : 4;   // e1 / e8
    if (from !== home) return;
    const enemy = other(turn);
    if (attacked(board, home, enemy)) return;
    const king = board[from];
    // King side: f and g empty and not attacked, rook on h.
    if (castling[white ? 'K' : 'k'] && !board[home + 1] && !board[home + 2] &&
        board[home + 3] === (white ? 'R' : 'r') &&
        !attacked(board, home + 1, enemy) && !attacked(board, home + 2, enemy)) {
      moves.push({ from, to: home + 2, piece: king, captured: null, flag: 'castle' });
    }
    // Queen side: b, c, d empty; c and d not attacked; rook on a.
    if (castling[white ? 'Q' : 'q'] && !board[home - 1] && !board[home - 2] && !board[home - 3] &&
        board[home - 4] === (white ? 'R' : 'r') &&
        !attacked(board, home - 1, enemy) && !attacked(board, home - 2, enemy)) {
      moves.push({ from, to: home - 2, piece: king, captured: null, flag: 'castle' });
    }
  }

  // Plays a move on the state in place and returns what's needed to take it back.
  function make(state, move) {
    const { board } = state;
    const undo = {
      move, castling: { ...state.castling }, ep: state.ep, half: state.half, full: state.full,
      turn: state.turn, rookFrom: null, rookTo: null
    };
    const white = state.turn === 'w';
    board[move.to] = move.promo || move.piece;
    board[move.from] = null;
    if (move.flag === 'ep') board[move.to + (white ? 8 : -8)] = null;
    if (move.flag === 'castle') {
      const kingSide = move.to > move.from;
      undo.rookFrom = kingSide ? move.from + 3 : move.from - 4;
      undo.rookTo = kingSide ? move.from + 1 : move.from - 1;
      board[undo.rookTo] = board[undo.rookFrom];
      board[undo.rookFrom] = null;
    }
    // Moving the king or a rook, or losing a rook, ends those castling rights.
    const touch = sq => {
      if (sq === 60) { state.castling.K = false; state.castling.Q = false; }
      if (sq === 4) { state.castling.k = false; state.castling.q = false; }
      if (sq === 63) state.castling.K = false;
      if (sq === 56) state.castling.Q = false;
      if (sq === 7) state.castling.k = false;
      if (sq === 0) state.castling.q = false;
    };
    touch(move.from); touch(move.to);
    state.ep = move.flag === 'double' ? (move.from + move.to) / 2 : null;
    state.half = move.piece.toUpperCase() === 'P' || move.captured ? 0 : state.half + 1;
    if (!white) state.full++;
    state.turn = other(state.turn);
    return undo;
  }

  function unmake(state, undo) {
    const { board } = state;
    const { move } = undo;
    const white = undo.turn === 'w';
    board[move.from] = move.piece;
    board[move.to] = move.flag === 'ep' ? null : move.captured;
    if (move.flag === 'ep') board[move.to + (white ? 8 : -8)] = move.captured;
    if (move.flag === 'castle') {
      board[undo.rookFrom] = board[undo.rookTo];
      board[undo.rookTo] = null;
    }
    state.castling = undo.castling;
    state.ep = undo.ep;
    state.half = undo.half;
    state.full = undo.full;
    state.turn = undo.turn;
  }

  function legalMoves(state, onlyCaptures = false) {
    const mover = state.turn;
    return pseudoMoves(state, onlyCaptures).filter(m => {
      const undo = make(state, m);
      const ok = !inCheck(state, mover);
      unmake(state, undo);
      return ok;
    });
  }

  function movesFrom(state, sq) {
    return legalMoves(state).filter(m => m.from === sq);
  }

  // ---- game status ----------------------------------------------------------------

  function insufficientMaterial(board) {
    const pieces = board.filter(p => p && p.toUpperCase() !== 'K');
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && 'BN'.includes(pieces[0].toUpperCase())) return true;
    // Bishops only, all on the same color of square.
    if (pieces.every(p => p.toUpperCase() === 'B')) {
      const shades = new Set();
      board.forEach((p, sq) => { if (p && p.toUpperCase() === 'B') shades.add((rowOf(sq) + colOf(sq)) % 2); });
      return shades.size === 1;
    }
    return false;
  }

  // { over, result: '1-0' | '0-1' | '1/2-1/2' | null, reason }
  function status(state) {
    const moves = legalMoves(state);
    if (!moves.length) {
      if (inCheck(state)) {
        return { over: true, result: state.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate', winner: other(state.turn) };
      }
      return { over: true, result: '1/2-1/2', reason: 'stalemate', winner: null };
    }
    if (state.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule', winner: null };
    if ((state.seen[positionKey(state)] || 0) >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold repetition', winner: null };
    if (insufficientMaterial(state.board)) return { over: true, result: '1/2-1/2', reason: 'not enough pieces to checkmate', winner: null };
    return { over: false, result: null, reason: null, winner: null, check: inCheck(state) };
  }

  // Standard notation for the move list: Nf3, exd5, O-O, e8=Q+, Qh7#.
  function san(state, move) {
    let out;
    if (move.flag === 'castle') out = move.to > move.from ? 'O-O' : 'O-O-O';
    else {
      const kind = move.piece.toUpperCase();
      const capture = move.captured ? 'x' : '';
      if (kind === 'P') {
        out = (capture ? FILES[colOf(move.from)] : '') + capture + name(move.to) + (move.promo ? '=' + move.promo.toUpperCase() : '');
      } else {
        // Say which piece when two of the same kind could go there.
        const rivals = legalMoves(state).filter(m => m.piece === move.piece && m.to === move.to && m.from !== move.from);
        let which = '';
        if (rivals.length) {
          const sameFile = rivals.some(m => colOf(m.from) === colOf(move.from));
          const sameRow = rivals.some(m => rowOf(m.from) === rowOf(move.from));
          which = !sameFile ? FILES[colOf(move.from)] : !sameRow ? String(8 - rowOf(move.from)) : name(move.from);
        }
        out = kind + which + capture + name(move.to);
      }
    }
    const undo = make(state, move);
    const s = status(state);
    unmake(state, undo);
    if (s.reason === 'checkmate') out += '#';
    else if (s.check) out += '+';
    return out;
  }

  // Plays a legal move for real: records notation and repetition counts.
  // Accepts { from, to, promo } with squares as numbers or names like "e2".
  function play(state, wanted) {
    const from = typeof wanted.from === 'string' ? parseSquare(wanted.from) : wanted.from;
    const to = typeof wanted.to === 'string' ? parseSquare(wanted.to) : wanted.to;
    const candidates = legalMoves(state).filter(m => m.from === from && m.to === to);
    if (!candidates.length) return null;
    let move = candidates[0];
    if (move.promo) {
      const want = String(wanted.promo || 'q').toLowerCase();
      move = candidates.find(m => m.promo.toLowerCase() === want) || candidates.find(m => m.promo.toLowerCase() === 'q');
    }
    const notation = san(state, move);
    make(state, move);
    const key = positionKey(state);
    state.seen[key] = (state.seen[key] || 0) + 1;
    return { ...move, san: notation };
  }

  // ---- the computer ------------------------------------------------------------------

  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  // Piece-square tables from White's side, row 0 = 8th rank: small nudges
  // toward the center, toward castling, and toward pushing pawns.
  const PST = {
    P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
  };

  // Score from the side to move's point of view, in centipawns.
  function evaluate(state) {
    let score = 0;
    const { board } = state;
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p) continue;
      const kind = p.toUpperCase();
      // Black reads the table upside down.
      const v = VALUE[kind] + PST[kind][isWhite(p) ? sq : (7 - rowOf(sq)) * 8 + colOf(sq)];
      score += isWhite(p) ? v : -v;
    }
    return state.turn === 'w' ? score : -score;
  }

  // Captures of big pieces by small ones first: alpha-beta cuts far more.
  function ordered(moves) {
    return moves.sort((a, b) =>
      ((b.captured ? VALUE[b.captured.toUpperCase()] * 10 - VALUE[b.piece.toUpperCase()] : 0) + (b.promo ? 800 : 0)) -
      ((a.captured ? VALUE[a.captured.toUpperCase()] * 10 - VALUE[a.piece.toUpperCase()] : 0) + (a.promo ? 800 : 0)));
  }

  const MATE = 100000;

  function quiesce(state, alpha, beta, depth, ctx) {
    ctx.nodes++;
    const stand = evaluate(state);
    if (stand >= beta || depth === 0) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of ordered(legalMoves(state, true))) {
      const undo = make(state, m);
      const score = -quiesce(state, -beta, -alpha, depth - 1, ctx);
      unmake(state, undo);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(state, depth, alpha, beta, ply, ctx) {
    ctx.nodes++;
    if (ctx.nodes > ctx.maxNodes) ctx.stopped = true;
    if (ctx.stopped) return 0;
    const moves = legalMoves(state);
    if (!moves.length) return inCheck(state) ? -MATE + ply : 0;
    if (state.half >= 100) return 0;
    if (depth === 0) return ctx.quiet ? quiesce(state, alpha, beta, 4, ctx) : evaluate(state);
    let best = -Infinity;
    for (const m of ordered(moves)) {
      const undo = make(state, m);
      const score = -negamax(state, depth - 1, -beta, -alpha, ply + 1, ctx);
      unmake(state, undo);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: 1, quiet: false, slack: 120, maxNodes: 20000 },
    medium: { depth: 2, quiet: true, slack: 25, maxNodes: 120000 },
    hard: { depth: 3, quiet: true, slack: 0, maxNodes: 600000 }
  };

  // The computer's move for the side to play. Easy picks at random among the
  // moves that are nearly as good as the best, so it blunders like a person.
  function bestMove(input, level = 'medium', random = Math.random) {
    const state = clone(input);
    const cfg = LEVELS[level] || LEVELS.medium;
    const moves = legalMoves(state);
    if (!moves.length) return null;
    const ctx = { nodes: 0, maxNodes: cfg.maxNodes, stopped: false, quiet: cfg.quiet };
    const scored = [];
    for (const m of ordered(moves)) {
      const undo = make(state, m);
      const score = -negamax(state, cfg.depth - 1, -Infinity, Infinity, 1, ctx);
      unmake(state, undo);
      scored.push({ m, score });
      if (ctx.stopped) break;
    }
    // Moves never looked at (out of time) are left out, not guessed at.
    const top = Math.max(...scored.map(s => s.score));
    const pool = scored.filter(s => s.score >= top - cfg.slack);
    const pick = pool[Math.floor(random() * pool.length)].m;
    return { from: pick.from, to: pick.to, promo: pick.promo || null };
  }

  // Counts positions to a depth. Used by the tests: the numbers for the
  // standard positions are known, so any rules bug shows up as a wrong count.
  function perft(state, depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of legalMoves(state)) {
      const undo = make(state, m);
      n += perft(state, depth - 1);
      unmake(state, undo);
    }
    return n;
  }

  return {
    START, fromFen, toFen, clone, legalMoves, movesFrom, play, status, inCheck,
    bestMove, perft, evaluate, name, parseSquare, colorOf, LEVELS
  };
});
