'use strict';

// ARKS Train Station's page: the game (cab-train.js) runs in the cabinet frame (cab-frame.js), and GameShell handles the
// game-over panel and the high scores. The cars' names are this arcade's own, set on the admin page; the page fetches
// them before the train is built. The page sends the points it counted; the server refuses a score no real game could
// reach (arcade/scores.js), the deliberate exception the 3D cabinet games make to "the server decides".
(async () => {
  const $ = id => document.getElementById(id);
  const game = CAB.games[0];

  // The arcade's car names (the game keeps its made-up ones if this can't be reached).
  try {
    const r = await fetch('/api/train-cars');
    const d = r.ok ? await r.json() : null;
    if (d && Array.isArray(d.cars) && d.cars.length === 8) game.cars = d.cars.map(c => [c.name, c.kind]);
  } catch { /* made-up names it is */ }

  const shell = GameShell.create({
    game: 'train', boards: { points: 'Points' }, mount: $('cab'),
    onAgain: () => frame.start()
  });

  const frame = CabFrame.run({
    game, root: $('cab'), muteBtn: $('muteBtn'), musicBtn: $('musicBtn'),
    onStart: () => shell.hideOver(),
    onOver: g => {
      const f = g.final();
      setTimeout(() => shell.over({ score: f.score, board: f.board, detail: f.detail, title: `Last stop, level ${g.level || 1}` }), 1600);
    }
  });

  $('scoresBtn').addEventListener('click', () => shell.openScores('points'));
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));

  // ---- how to play -------------------------------------------------------------------------------
  const help = Tutorial.create('train', [
    {
      emoji: '🚂', title: 'Drop the ball into the train',
      html: `<p>A train of eight cars circles the track. Each <b>tap</b> lets a ball go down the spiral and along the ramp, and it drops off the end onto the track. Time it so it lands in a car. The ball takes a few seconds to get there, so you're aiming for the car that's coming, not the one under the ramp.</p>
        <table>
          <tr><td>📱 Phone</td><td>Tap the game or the big button.</td></tr>
          <tr><td>⌨️ Keyboard</td><td><b>Space</b> drops a ball. <b>P</b> pauses.</td></tr>
          <tr><td>🎮 Controller</td><td><b>A</b>, <b>X</b>, <b>R1</b> or the right trigger. <b>Start</b> pauses.</td></tr>
        </table>`
    },
    {
      emoji: '💡', title: 'Light the board for All Aboard',
      html: `<p>Long cars are easy and worth <b>5</b>, medium ones <b>15</b>, and the short ones are hard and worth <b>40</b>. Landing in a car lights its letter on the board over the station.</p>
        <p>Light all eight for <b>All Aboard</b>: 250 more points, the board clears, you get 15 new balls, and the next level starts. The game ends when you're out of balls.</p>`
    },
    {
      emoji: '🎚️', title: 'Ten levels',
      html: `<p>Opening Day, then Express (a third faster), Rush Hour (it speeds up and slows down without warning), The Tunnel (it hides the cars you're aiming for), All Change (the cars swap places every time you land one), Wrong Way, Compact Cars, Lights Out, Express Tunnel and Grand Central. After that it starts over.</p>
        <p><b>Start at</b> jumps to any level, and <b>Look</b> turns on the blacklight for the whole game. The bots at the station have opinions about your aim.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => { frame.pause(); help.open(); });
  help.autoOpen();
})();
