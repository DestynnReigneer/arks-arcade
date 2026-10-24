'use strict';

// Admin for arcade profiles: approve or turn down requests, rename, clear a
// forgotten PIN, unlock a profile or device locked by wrong PINs, or remove a
// profile. Lives in the Arcade tab.

(() => {
  const API = '/api/profiles/admin';
  const $ = id => document.getElementById(id);
  async function api(path = '', { method = 'GET', body } = {}) {
    const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const avatar = id => {
    const el = document.createElement('span');
    el.style.cssText = 'display:inline-block;width:32px;height:32px;border-radius:50%;overflow:hidden;flex:none';
    Avatars.put(el, id);
    return el;
  };
  const btn = (label, onClick, danger = false) => {
    const b = document.createElement('button');
    b.className = 'small-btn';
    b.textContent = label;
    if (danger) b.style.cssText = 'border-color:#7f3a3a;color:#f5a3a3';
    b.onclick = onClick;
    return b;
  };

  async function load() {
    const box = $('profileList');
    try {
      const rows = await api();
      box.innerHTML = rows.length ? '' : '<div class="admin-note">No profiles yet. When someone taps "New profile" on the home page, it shows up here to approve.</div>';
      for (const p of rows) {
        const row = document.createElement('div');
        row.className = 'theme-row';
        row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
        const label = document.createElement('span');
        label.style.cssText = 'flex:1;min-width:120px;font-weight:700';
        label.textContent = `${p.name}${p.hasPin ? ' 🔑' : ''}${p.locked ? ' · 🔒 Locked' : ''}${p.status === 'pending' ? ' · waiting for approval' : ''}`;
        const actions = document.createElement('span');
        actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        if (p.status === 'pending') {
          actions.append(
            btn('✅ Approve', async () => { await api(`/${p.id}/approve`, { method: 'POST', body: {} }); load(); }),
            btn('✕ Turn down', async () => { await api(`/${p.id}/reject`, { method: 'POST', body: {} }); load(); }, true)
          );
        } else {
          actions.append(
            ...(p.locked ? [btn('🔓 Unlock', async () => {
              await api(`/${p.id}/unlock`, { method: 'POST', body: {} });
              load();
            })] : []),
            btn('✏️ Rename', async () => {
              const name = prompt('New name', p.name);
              if (!name) return;
              try { await api(`/${p.id}`, { method: 'PATCH', body: { name } }); load(); } catch (e) { alert(e.message); }
            }),
            ...(p.hasPin ? [btn('🔓 Clear PIN', async () => {
              if (!confirm(`Remove ${p.name}'s PIN? They can set a new one from their profile.`)) return;
              await api(`/${p.id}/clear-pin`, { method: 'POST', body: {} });
              load();
            })] : []),
            btn('🗑 Remove', async () => {
              if (!confirm(`Remove ${p.name}'s profile? Their old scores stay on the boards.`)) return;
              await api(`/${p.id}`, { method: 'DELETE' });
              load();
            }, true)
          );
        }
        row.append(avatar(p.avatar), label, actions);
        box.appendChild(row);
      }
    } catch (e) { box.textContent = e.message; }
  }

  $('unlockDevicesBtn').onclick = async () => {
    try {
      await api('/unlock-devices', { method: 'POST', body: {} });
      $('unlockDevicesMsg').textContent = 'Done. Every phone and computer can try PINs again.';
    } catch (e) { $('unlockDevicesMsg').textContent = e.message; }
  };

  document.addEventListener('admin-tab', e => { if (e.detail === 'tabArcade') load(); });
  const content = $('adminContent');
  const ready = () => !content.classList.contains('hidden');
  if (ready()) load();
  else new MutationObserver((_, obs) => { if (ready()) { obs.disconnect(); load(); } }).observe(content, { attributes: true, attributeFilter: ['class'] });
})();
