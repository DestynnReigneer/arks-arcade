/* dock.js: the sticky header that "catches" parts of the page as you scroll.
 *
 * The same file is used in every app, so a fix here is copied to the others.
 *
 *   Dock.header(el)            the header shrinks (gets the "docked" class) once
 *                              the page has scrolled a little.
 *   Dock.catch(section, items) as the section slides up under the header it
 *                              fades out, and its small copies (items) fade
 *                              into the header at the same pace. Scrolling back
 *                              up runs it in reverse.
 *   Dock.chin(el)              the footer fades and rises in as it comes onto
 *                              the screen.
 *   Dock.edges(el)             no scroll bars: a list that has more to see
 *                              fades out at that edge (more-up, more-down,
 *                              more-left, more-right classes), and keeps doing
 *                              so as its contents change.
 *
 * Everything runs once per animation frame, and only while scrolling.
 */
(function (root) {
  'use strict';
  var head = null, catches = [], chins = [], queued = false;
  var still = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function shown(el) { return !!(el && el.offsetParent !== null && el.getClientRects().length); }

  function frame() {
    queued = false;
    if (head) head.classList.toggle('docked', root.scrollY > 24);
    var line = head ? head.getBoundingClientRect().bottom : 0;
    catches.forEach(function (c) {
      // 0 while the section is clear of the header, 1 once it has slid under it
      var p = 0;
      if (shown(c.section)) {
        var r = c.section.getBoundingClientRect();
        p = clamp((line - r.top) / Math.max(r.height * 0.8, 1));
      }
      c.section.style.opacity = p ? (1 - p).toFixed(3) : '';
      c.section.style.transform = p && !still ? 'translateY(' + (p * -8).toFixed(1) + 'px) scale(' + (1 - p * 0.02).toFixed(3) + ')' : '';
      c.items.forEach(function (x) {
        x.classList.toggle('in', p > 0.02);
        x.style.opacity = p.toFixed(3);
        x.style.transform = still ? '' : 'translateY(' + ((1 - p) * 10).toFixed(1) + 'px)';
        x.inert = p < 0.5;   // half faded in before it can be tapped
      });
    });
    chins.forEach(function (el) {
      var r = el.getBoundingClientRect(), q = clamp((root.innerHeight - r.top) / Math.max(r.height, 1));
      el.style.opacity = q.toFixed(3);
      el.style.transform = still ? '' : 'translateY(' + ((1 - q) * 24).toFixed(1) + 'px)';
    });
  }
  function kick() { if (!queued) { queued = true; root.requestAnimationFrame(frame); } }
  root.addEventListener('scroll', kick, { passive: true });
  root.addEventListener('resize', kick);
  root.addEventListener('load', kick);
  if (root.document.fonts) root.document.fonts.ready.then(kick);

  function edges(el) {
    if (!el || el.dataset.edges) return;
    el.dataset.edges = '1';
    var across = el.classList.contains('fade-x');
    function upd() {
      if (across) {
        el.classList.toggle('more-left', el.scrollLeft > 2);
        el.classList.toggle('more-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      } else {
        el.classList.toggle('more-up', el.scrollTop > 2);
        el.classList.toggle('more-down', el.scrollTop + el.clientHeight < el.scrollHeight - 2);
      }
    }
    el.addEventListener('scroll', upd, { passive: true });
    if (root.ResizeObserver) new root.ResizeObserver(upd).observe(el);
    if (root.MutationObserver) new root.MutationObserver(upd).observe(el, { childList: true, subtree: true });
    upd();
  }

  root.Dock = {
    header: function (el) { head = el; kick(); },
    catch: function (section, items) { if (section) { catches.push({ section: section, items: items.filter(Boolean) }); kick(); } },
    chin: function (el) { if (el) { chins.push(el); kick(); } },
    edges: edges,
    refresh: kick
  };
})(window);
