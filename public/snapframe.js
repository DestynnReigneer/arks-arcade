/* snapframe.js: "Snap this page" with a frame (2026-11-01).
 *
 * The same file in every app that has the feedback card. Instead of taking
 * the picture straight away, it hides the card and puts a dashed frame over
 * the screen, with Capture and Cancel floating at the bottom. You move and
 * pinch-zoom the page itself to show the part you want; Capture takes exactly
 * what's inside the frame. The frame and the buttons follow the zoom, so they
 * stay the same size and in reach.
 *
 *   SnapFrame.start({
 *     library: () => Promise of html-to-image,
 *     background: '#170a2e',            // behind anything see-through
 *     maxWidth: 1600,                   // the picture is never wider
 *     skip: node => true to leave a node out of the picture,
 *     options: { skipFonts: true },     // anything else for html-to-image
 *     done: (canvas) => {},             // null when canceled
 *     failed: (error) => {}
 *   });
 *
 * Its styles are set from here (element.style), so it needs no stylesheet and
 * works under a strict content security policy.
 */
(function (root) {
  'use strict';
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  function css(el, s) { for (var k in s) el.style[k] = s[k]; return el; }
  function make(tag, s, text) { var e = document.createElement(tag); if (s) css(e, s); if (text) e.textContent = text; return e; }

  function start(o) {
    var vv = root.visualViewport;
    var ui = make('div', { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', zIndex: '2147483600', pointerEvents: 'none' });
    ui.setAttribute('data-snapframe', '');
    var frame = make('div', { position: 'absolute', inset: '0', border: '3px dashed #ff2ec4', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.5)', boxSizing: 'border-box', borderRadius: '6px' });
    var bar = make('div', {
      position: 'absolute', left: '50%', bottom: '16px', transform: 'translateX(-50%)', transformOrigin: 'bottom center', pointerEvents: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '14px',
      background: 'rgba(10, 4, 22, 0.92)', border: '1px solid rgba(255, 255, 255, 0.15)', boxShadow: '0 10px 30px rgba(0,0,0,.5)',
      color: '#f5eaff', font: '600 14px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif', textAlign: 'center', width: 'max-content', maxWidth: '92vw'
    });
    bar.appendChild(make('div', null, 'Move and zoom the page to show the part you want, then tap Capture.'));
    var row = make('div', { display: 'flex', gap: '10px' });
    var btn = function (label, hot) {
      var b = make('button', { minWidth: '110px', height: '44px', padding: '0 16px', borderRadius: '10px', cursor: 'pointer', font: '700 15px/1 system-ui, -apple-system, sans-serif',
        border: hot ? '0' : '1px solid rgba(255,255,255,.25)', background: hot ? '#ff2ec4' : 'transparent', color: hot ? '#1c0326' : '#f5eaff' }, label);
      b.type = 'button';
      return b;
    };
    var cancel = btn('Cancel', false), capture = btn('Capture', true);
    row.appendChild(cancel); row.appendChild(capture);
    bar.appendChild(row);
    ui.appendChild(frame); ui.appendChild(bar);
    document.body.appendChild(ui);

    // Keep the frame on the visible part of the page and the buttons the same
    // size, however far the page is zoomed.
    function place() {
      if (!vv) return;
      css(ui, { left: vv.offsetLeft + 'px', top: vv.offsetTop + 'px', width: vv.width + 'px', height: vv.height + 'px' });
      bar.style.transform = 'translateX(-50%) scale(' + (1 / (vv.scale || 1)) + ')';
      bar.style.bottom = (16 / (vv.scale || 1)) + 'px';
    }
    place();
    if (vv) { vv.addEventListener('resize', place); vv.addEventListener('scroll', place); }
    root.addEventListener('scroll', place, { passive: true });
    function end() {
      if (vv) { vv.removeEventListener('resize', place); vv.removeEventListener('scroll', place); }
      root.removeEventListener('scroll', place);
      ui.remove();
    }

    cancel.addEventListener('click', function () { end(); o.done(null); });
    capture.addEventListener('click', function () {
      // What's in the frame, in the page's own coordinates.
      var v = vv || { pageLeft: root.scrollX, pageTop: root.scrollY, width: root.innerWidth, height: root.innerHeight, scale: 1 };
      var b = document.body.getBoundingClientRect();
      var x = v.pageLeft - (b.left + root.scrollX), y = v.pageTop - (b.top + root.scrollY);
      var w = Math.round(v.width), h = Math.round(v.height);
      // Zoomed in, the picture is drawn finer, so it stays sharp.
      var ratio = Math.min(4, (root.devicePixelRatio || 1) * (v.scale || 1), (o.maxWidth || 1600) / w);
      ui.style.visibility = 'hidden';
      o.library().then(function (lib) {
        var opts = {
          width: w, height: h, pixelRatio: ratio,
          backgroundColor: o.background || getComputedStyle(document.documentElement).backgroundColor || '#000',
          imagePlaceholder: BLANK,
          // The page keeps its full size; it's only shifted so the framed part
          // lands in the picture (the width and height above are the frame's).
          style: { margin: '0', width: b.width + 'px', height: document.body.scrollHeight + 'px',
            transform: 'translate(' + (-x) + 'px, ' + (-y) + 'px)', transformOrigin: '0 0' },
          filter: function (n) {
            if (n === ui) return false;
            if (n.tagName === 'IMG' && !n.getAttribute('src')) return false;
            return !(o.skip && o.skip(n));
          }
        };
        for (var k in o.options || {}) opts[k] = o.options[k];
        return lib.toCanvas(document.body, opts);
      }).then(function (canvas) { end(); o.done(canvas); }, function (err) { end(); o.failed(err); });
    });
    capture.focus();
  }

  root.SnapFrame = { start: start };
})(window);
