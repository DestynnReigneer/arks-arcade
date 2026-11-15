'use strict';

// A room's clock: the timer that ends a round or moves a game on.
//
// What a clock runs has nobody to answer to. A route that fails sends an error
// back to one device, but a timer that fails would stop the whole arcade. And
// since rooms are kept between restarts, a room that's wrong inside (a row
// someone edited, or a mistake in a later version) would be read back and stop
// it again at the next start.
//
// So when what the clock runs fails, the room is closed, it's said in the log,
// and the arcade carries on.
//
//   r.timer = clock(ms, () => endRound(r), () => close(r));
//   clearTimeout(r.timer);

module.exports = function clock(ms, run, close) {
  return setTimeout(() => {
    try { run(); } catch (e) {
      console.error('A room\'s clock failed, so the room was closed:', e && e.message);
      try { close(); } catch { /* it's as closed as it gets */ }
    }
  }, ms);
};
