'use strict';

// Setup in two steps on a phone (2026-11-20). A setup screen with more choices than
// an upright phone can show at once splits them into two steps there: the page marks
// each part with data-step="1" or data-step="2", and this shows one step at a time
// with two dots under it (the step you're on lit up), Next on step 1 and Back plus
// the game's own start button on step 2. Tablets, laptops and TVs keep the whole
// setup on one screen, untouched.
//
//   const steps = SetupSteps.create(document.getElementById('setup'), {
//     start: startButton,     // moves under step 2 on a phone, and back again
//     msg: messageLine,       // optional: errors show under either step
//     next: true,             // false: no Next (something on step 1 goes to step 2 itself)
//     backClass: 'ghost', nextClass: 'primary big'
//   });
//   steps.active   true while the setup is in steps (a phone)
//   steps.step     1 or 2
//   steps.go(n)    show step n (does nothing but remember it when not in steps)
//
// Moving between steps only hides and shows, so every choice made is kept. A part
// can be moved up on the phone with style="--step-order:-1". Next shows only while
// the start button does (a mode that has nothing to start hides both).
window.SetupSteps = (() => {
  const PHONE = '(max-width: 759px)';

  function create(root, { start, msg = null, next = true, backClass = 'ghost', nextClass = 'primary big' } = {}) {
    const mq = window.matchMedia(PHONE);
    const nav = document.createElement('div');
    nav.className = 'steps-nav';
    nav.innerHTML = '<div class="steps-dots" aria-hidden="true"><i></i><i></i></div><div class="steps-row"></div>';
    const row = nav.querySelector('.steps-row');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = `${backClass} steps-back`;
    back.textContent = 'Back';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = `${nextClass} steps-next`;
    nextBtn.textContent = 'Next';
    row.append(back, nextBtn);
    root.appendChild(nav);
    start.classList.add('steps-start');

    // Where the start button and the message line live when the setup is on one screen.
    const homes = new Map();
    for (const el of [msg, start]) {
      if (!el) continue;
      const mark = document.createComment('setup-steps');
      el.before(mark);
      homes.set(el, mark);
    }

    let step = 1;
    let on = null;

    function nextShown() {
      nextBtn.classList.toggle('hidden', !next || start.classList.contains('hidden'));
    }

    function update() {
      const want = mq.matches && !document.documentElement.classList.contains('tv');
      if (want !== on) {
        on = want;
        if (on) {
          if (msg) nav.insertBefore(msg, nav.firstChild);
          row.appendChild(start);
        } else {
          for (const [el, mark] of homes) mark.after(el);
        }
      }
      root.classList.toggle('steps-on', on);
      root.classList.toggle('on-step-1', on && step === 1);
      root.classList.toggle('on-step-2', on && step === 2);
      nextShown();
    }

    function go(n) {
      const changed = n !== step;
      step = n === 2 ? 2 : 1;
      update();
      if (on && changed) window.scrollTo(0, 0);
    }

    back.addEventListener('click', () => go(1));
    nextBtn.addEventListener('click', () => go(2));
    new MutationObserver(nextShown).observe(start, { attributes: true, attributeFilter: ['class'] });
    if (mq.addEventListener) mq.addEventListener('change', update); else mq.addListener(update);
    // The TV layout can switch on after the page has started.
    new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    update();

    return {
      get active() { return on; },
      get step() { return step; },
      go
    };
  }

  return { create };
})();
