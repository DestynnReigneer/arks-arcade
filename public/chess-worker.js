'use strict';

// The computer thinks here, off the main thread, so the board stays smooth
// while it does. Same engine as the page.
importScripts('chess-engine.js');

self.onmessage = ({ data }) => {
  const { id, fen, level } = data;
  const move = ChessEngine.bestMove(ChessEngine.fromFen(fen), level);
  self.postMessage({ id, move });
};
