'use strict';

// Live updates that come back by themselves.
//
// A room's page listens to the arcade with an EventSource. When the connection
// drops, the browser tries again on its own. But when it's answered with an
// error page instead (what a proxy in front of the arcade sends while the
// arcade restarts), the browser gives up for good, and the page would sit on
// a game that never moves again. ArcadeLive.retry starts the live updates
// again in that case, every couple of seconds, until the arcade is back.
//
// A page uses it where its live updates report an error, after checking the
// game isn't simply gone:
//
//   es.onerror = () => stillThere().then(yes => {
//     if (!yes) leave(); else ArcadeLive.retry(es, () => S.es === es, connect);
//   });

window.ArcadeLive = (() => {
  const GAVE_UP = 2;   // EventSource.CLOSED. 0 means the browser is already trying again by itself.

  // es: the EventSource that just reported an error.
  // current(): is it still the one the page is using (the page may have left the room since)?
  // again(): open a new one.
  function retry(es, current, again, ms = 2000) {
    if (!es || es.readyState !== GAVE_UP) return;
    setTimeout(() => { if (current()) again(); }, ms);
  }

  return { retry };
})();
