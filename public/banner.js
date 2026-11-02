// The banner across the top of every page: one short message the admin
// types once, shown in every app until it's cleared or it ends (ARKS ID's
// contract v13).
//
// The page asks its own server for it at /api/banner (the server asks ARKS ID
// and keeps the answer for a minute), then again every minute, so a screen
// left open on the wall picks up a new message or loses an old one by itself.
// The text is put in with textContent, never as HTML.
//
// Hide tucks it away on this device until tomorrow. A new message shows
// again straight away, even on a device that hid the last one.
//
// Part of the shared kit: every app has this exact file in public/banner.js,
// with its looks in public/banner.css, which this file loads itself. A page
// only needs <script src="/banner.js" defer></script>.
(function () {
  'use strict';
  if (window.ArksBanner) return;
  var KEY = 'arks-banner-hidden';
  var EVERY_MS = 60 * 1000;
  var box = null, shown = '';

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function wasHidden(b) {
    try {
      var h = JSON.parse(localStorage.getItem(KEY) || 'null');
      return !!h && h.id === b.id && h.day === today();
    } catch (e) { return false; }
  }
  function hideFor(b) {
    try { localStorage.setItem(KEY, JSON.stringify({ id: b.id, day: today() })); } catch (e) { /* private mode: hidden for this page only */ }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  // The two icons, drawn element by element: an "i" in a circle, and a "!"
  // in a triangle.
  function icon(tone) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'arks-banner-icon');
    var shapes = tone === 'warning'
      ? [['path', { d: 'M12 3.5 2.5 20h19L12 3.5Z' }], ['path', { d: 'M12 10v4.5M12 17.5h.01' }]]
      : [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 11v5.5M12 7.5h.01' }]];
    shapes.forEach(function (x) {
      var p = document.createElementNS(NS, x[0]);
      Object.keys(x[1]).forEach(function (k) { p.setAttribute(k, x[1][k]); });
      s.appendChild(p);
    });
    return s;
  }
  function addStyles() {
    if (document.getElementById('arksBannerCss')) return;
    var l = document.createElement('link');
    l.id = 'arksBannerCss';
    l.rel = 'stylesheet';
    l.href = '/banner.css';
    document.head.appendChild(l);
  }
  function remove() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    shown = '';
  }

  function show(b) {
    if (!b || typeof b.text !== 'string' || !b.text || wasHidden(b)) return remove();
    var tone = b.tone === 'warning' ? 'warning' : 'info';
    var same = b.id + '|' + tone + '|' + b.text;
    if (box && shown === same) return;
    addStyles();
    if (!box) {
      box = el('div');
      box.id = 'arksBanner';
      box.setAttribute('role', 'status');
      document.body.insertBefore(box, document.body.firstChild);
    }
    shown = same;
    box.className = 'arks-banner is-' + tone;
    box.textContent = '';
    var inner = el('div', 'arks-banner-in');
    var word = el('span', 'arks-banner-word');
    word.appendChild(icon(tone));
    word.appendChild(document.createTextNode(tone === 'warning' ? 'Warning' : 'Heads up'));
    inner.appendChild(word);
    inner.appendChild(el('span', 'arks-banner-text', b.text));
    var x = el('button', 'arks-banner-hide', 'Hide');
    x.type = 'button';
    x.setAttribute('aria-label', 'Hide this message on this device until tomorrow');
    x.addEventListener('click', function () { hideFor(b); remove(); });
    inner.appendChild(x);
    box.appendChild(inner);
  }

  // XMLHttpRequest rather than fetch, so older wall screens get it too.
  function check() {
    if (document.hidden) return;
    var r = new XMLHttpRequest();
    r.open('GET', '/api/banner');
    r.setRequestHeader('Accept', 'application/json');
    r.onload = function () {
      if (r.status !== 200) return;
      try { show(JSON.parse(r.responseText).banner); } catch (e) { /* leave it as it is */ }
    };
    r.send();
  }

  function begin() {
    check();
    setInterval(check, EVERY_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  }
  window.ArksBanner = { check: check };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
})();
