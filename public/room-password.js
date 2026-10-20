'use strict';

// The lobby password box for adult games, shared by every game with rooms.
// Hosting an adult game: make one up. Joining a locked game: type it in.
// Brings its own styles so it looks the same in every game.

const RoomPassword = (() => {
  let root = null;

  function build() {
    root = document.createElement('div');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,4,10,.82);backdrop-filter:blur(3px)';
    root.innerHTML = `
      <div style="width:100%;max-width:380px;background:#1e1a30;color:#f4ecd0;border:2px solid #ff2e8c;border-radius:16px;padding:20px;box-shadow:0 0 30px rgba(255,46,140,.35);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center">
        <div style="font-size:40px;line-height:1">🔒</div>
        <h2 data-title style="margin:10px 0 6px;font-size:18px"></h2>
        <p data-hint style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#c9b98a"></p>
        <input data-input type="text" maxlength="30" autocomplete="off" autocapitalize="off" spellcheck="false"
          style="display:block;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #4a4266;background:#12111c;color:#fff;font-size:18px;text-align:center;letter-spacing:2px">
        <div data-msg style="min-height:18px;margin:6px 0;font-size:13px;color:#ff5e5e"></div>
        <button data-ok style="display:block;width:100%;padding:12px;border:0;border-radius:10px;background:#ff2e8c;color:#fff;font-weight:800;font-size:15px;cursor:pointer"></button>
        <button data-cancel style="display:block;width:100%;margin-top:8px;padding:10px;border:1px solid #4a4266;border-radius:10px;background:transparent;color:#f4ecd0;font-size:14px;cursor:pointer">Cancel</button>
      </div>`;
    document.body.appendChild(root);
  }

  // create: the host is making one up. Resolves with the password, or null.
  function ask({ create = false, message = '' } = {}) {
    if (!root) build();
    const $ = sel => root.querySelector(`[data-${sel}]`);
    $('title').textContent = create ? 'Make a lobby password' : 'Grown-ups game';
    $('hint').textContent = create
      ? 'This is an adult game, so it gets a password. Tell your guests; anyone without it (like a curious kid) can\'t join.'
      : 'The host locked this game with a password. Ask them for it.';
    $('ok').textContent = create ? 'Lock it and host' : 'Join';
    $('msg').textContent = message;
    $('input').value = '';
    $('input').placeholder = create ? 'e.g. tacos' : 'Password';
    root.style.display = 'flex';
    setTimeout(() => $('input').focus(), 30);
    return new Promise(resolve => {
      const done = value => { root.style.display = 'none'; $('ok').onclick = $('cancel').onclick = $('input').onkeydown = null; resolve(value); };
      const submit = () => {
        const v = $('input').value.trim();
        if (v.length < 3) { $('msg').textContent = 'At least 3 characters.'; return; }
        done(v);
      };
      $('ok').onclick = submit;
      $('input').onkeydown = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') done(null); };
      $('cancel').onclick = () => done(null);
    });
  }

  // Runs a join (or host) request, asking for the password whenever the
  // server says one is needed or was wrong. `attempt(password)` returns the
  // request's promise; errors carry the server's JSON as err.data.
  async function withPassword(attempt) {
    let password = '';
    let message = '';
    for (;;) {
      try {
        return await attempt(password);
      } catch (e) {
        const need = e && e.data && e.data.needsPassword;
        if (!need) throw e;
        password = await ask({ create: need === 'create', message: password ? e.message : message });
        if (password == null) return null;
        message = '';
      }
    }
  }

  return { ask, withPassword };
})();
