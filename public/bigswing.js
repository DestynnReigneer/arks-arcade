'use strict';

// Big Swing's page: the game (cab-swing.js) runs in the cabinet frame (cab-frame.js), and GameShell handles the
// game-over panel and the high scores. The page sends the runs it counted; the server only refuses a score no real
// game could reach (arcade/scores.js), the deliberate exception the 3D cabinet games make to "the server decides".
(() => {
  const $ = id => document.getElementById(id);

  const shell = GameShell.create({
    game: 'bigswing', boards: { runs: 'Runs' }, mount: $('cab'),
    onAgain: () => frame.start()
  });

  const frame = CabFrame.run({
    game: CAB.games[0], root: $('cab'), muteBtn: $('muteBtn'), musicBtn: $('musicBtn'),
    onStart: () => shell.hideOver(),
    onOver: g => {
      const f = g.final();
      // the game's own THREE OUTS banner shows first, then the panel
      setTimeout(() => shell.over({ score: f.score, board: f.board, detail: f.detail, title: g.big ? 'The Big Win! 🏆' : 'Three outs!' }), 1600);
    }
  });

  $('scoresBtn').addEventListener('click', () => shell.openScores('runs'));
  Blip.muteButton($('muteBtn'));
  Blip.musicButton($('musicBtn'));

  // ---- how to play -------------------------------------------------------------------------------
  const help = Tutorial.create('bigswing', [
    {
      emoji: '⚾', title: 'Pull back, let go, swing',
      html: `<p>A ball rolls down from the pitching machine and along the track to your bat at home plate. <b>Hold</b> the game or the big button to pull the bat back, and <b>let go</b> to swing. The longer you hold, the harder the swing (the Power bar shows it).</p>
        <p>Timing aims the hit: swing early and the ball goes left, late and it goes right.</p>
        <table>
          <tr><td>📱 Phone</td><td>Hold the game or the big button, and let go to swing.</td></tr>
          <tr><td>⌨️ Keyboard</td><td>Hold <b>Space</b> and let go. <b>P</b> pauses.</td></tr>
          <tr><td>🎮 Controller</td><td>Hold <b>A</b>, <b>X</b>, <b>R1</b> or the right trigger. <b>Start</b> pauses.</td></tr>
        </table>`
    },
    {
      emoji: '🏟️', title: 'Singles, doubles and home runs',
      html: `<p>A hit rolls to the slots at the back wall: <b>single</b>, <b>double</b>, <b>triple</b> and <b>out</b>. They shuffle before every pitch, so watch where they land.</p>
        <p>A full-power swing that meets the ball right over the plate flies up into the <b>HOME RUN</b> target. Runners move around the bases like a real game, and every runner who gets home is a run.</p>`
    },
    {
      emoji: '🏆', title: 'Three outs and you\'re done',
      html: `<p>An out slot, or three strikes, is an out. Three outs end the game, and your score is how many runs you got. Ten runs is the <b>Big Win</b>.</p>
        <p>After the game, put your initials on the board to see where you stack up.</p>`
    }
  ]);
  $('helpBtn').addEventListener('click', () => { frame.pause(); help.open(); });
  help.autoOpen();
})();
