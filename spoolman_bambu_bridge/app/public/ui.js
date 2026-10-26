// Relatieve URLs: werkt achter de wisselende Ingress-URL.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function msg(t, bad) { const m = $('msg'); m.textContent = t; m.className = bad ? 'bad' : ''; }
async function api(path, method = 'GET', body) {
  const r = await fetch('api/' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Fout ${r.status}`);
  return d;
}
const run = (fn) => async () => { try { await fn(); } catch (e) { msg(e.message, true); } };
let overview = null;

async function refresh() {
  const s = await api('status');
  $('ver').textContent = 'v' + s.version;
  $('url').value = s.settings.spoolmanUrl; $('interval').value = s.settings.intervalSeconds; $('auto').checked = s.settings.autoSync; $('autocreate').checked = s.settings.autoCreate;
  const b = s.bambu.status;
  const bl = { connected: 'verbonden', disconnected: 'niet ingelogd', pending_code: 'wacht op code', expired: 'sessie verlopen, log opnieuw in' }[b] || b;
  const sm = s.settings.spoolmanUrl ? await api('spoolman').catch(() => ({ ok: false, error: 'geen antwoord' })) : null;
  const smTxt = !sm ? '<span class="warn">niet ingesteld</span>' : sm.ok ? `<b>verbonden</b> (${sm.active} actieve rollen)` : `<b class="bad">geen verbinding: ${esc(sm.error)}</b>`;
  $('conn').innerHTML = `<div>Bambu: <b class="${b === 'connected' ? '' : 'warn'}">${esc(bl)}</b> ${esc(s.bambu.email)}</div><div>Spoolman: ${smTxt}</div>`;
  $('loginForm').hidden = b === 'connected' || b === 'pending_code'; $('codeForm').hidden = b !== 'pending_code'; $('logout').hidden = b !== 'connected';
  $('last').textContent = s.lastRound ? `Laatste ronde ${new Date(s.lastRound.at).toLocaleString('nl-NL')}: ${s.lastRound.updated} bijgewerkt, ${s.lastRound.unchanged} ongewijzigd, ${s.lastRound.paused} gepauzeerd, ${s.lastRound.failed} mislukt` : 'Nog niet gesynchroniseerd.';
  $('links').innerHTML = s.links.length ? s.links.map((l) => `<div class="item"><span>Spoolman #${l.spoolmanId} ↔ Bambu ${esc(l.bambuId)}
    ${l.paused ? `<span class="warn">⏸ ${esc(l.pauseReason)}</span>` : l.lastSyncedGrams != null ? `· ${l.lastSyncedGrams} g` : ''}
    ${l.lastError ? `<span class="bad">${esc(l.lastError)}</span>` : ''}</span><button class="sec" data-unlink="${l.id}">Ontkoppel</button></div>`).join('') : '<p>Geen koppelingen.</p>';
  $('activity').innerHTML = s.activity.map((a) => `<li class="${a.level === 'error' ? 'bad' : a.level === 'warn' ? 'warn' : ''}">${new Date(a.at).toLocaleTimeString('nl-NL')} ${esc(a.message)}</li>`).join('');
}
function renderOverview() {
  if (!overview) return;
  const linked = new Set(overview.links.map((l) => l.spoolmanId));
  $('suggest').innerHTML = overview.suggestions.length ? '<h3>Suggesties (bevestig handmatig)</h3>' + overview.suggestions.map((g) =>
    `<div class="item"><span>Spoolman #${g.spoolmanId} → Bambu ${esc(g.bambuId)} <small>${esc(g.confidence)}: ${esc(g.reason)}</small></span><button data-link="${g.spoolmanId}:${g.bambuId}">Bevestig koppeling</button></div>`).join('') : '';
  $('spools').innerHTML = overview.spools.filter((s) => !s.archived && !linked.has(s.id)).map((s) =>
    `<div class="item"><span><i class="sw" style="background:#${esc(s.colorHex || '888')}"></i>#${s.id} ${esc(s.brand)} ${esc(s.material)} ${esc(s.name)} · ${s.remainingWeight == null ? 'gewicht onbekend' : Math.round(s.remainingWeight) + ' g'}</span>
    <span><select data-pick="${s.id}"><option value="">Bambu-rol…</option>${overview.cloud.filter((c) => !overview.links.some((l) => String(l.bambuId) === String(c.id))).map((c) => `<option value="${esc(c.id)}">${esc(c.filamentVendor)} ${esc(c.filamentType)} ${esc(c.filamentName)} ${c.netWeight} g</option>`).join('')}</select>
    <button class="sec" data-create="${s.id}">Maak in Bambu</button></span></div>`).join('');
}
document.addEventListener('click', run(async (e) => {
  const t = e.target; if (!(t instanceof HTMLButtonElement)) return;
  if (t.dataset.unlink) { if (confirm('Ontkoppelen? De rollen zelf blijven bestaan.')) { await api('links/' + t.dataset.unlink, 'DELETE'); msg('Ontkoppeld'); } }
  else if (t.dataset.link) { const [a, b] = t.dataset.link.split(':'); await api('links', 'POST', { spoolmanId: a, bambuId: b }); msg('Gekoppeld'); overview = await api('overview'); }
  else if (t.dataset.create) { await api('links/create-bambu', 'POST', { spoolmanId: t.dataset.create }); msg('Bambu-rol aangemaakt en gekoppeld'); overview = await api('overview'); }
  else return;
  renderOverview(); await refresh();
}));
document.addEventListener('change', run(async (e) => {
  const sel = e.target; if (sel.dataset?.pick && sel.value) { await api('links', 'POST', { spoolmanId: sel.dataset.pick, bambuId: sel.value }); msg('Gekoppeld'); overview = await api('overview'); renderOverview(); await refresh(); }
}));
$('save').onclick = run(async () => { await api('settings', 'POST', { spoolmanUrl: $('url').value, intervalSeconds: $('interval').value, autoSync: $('auto').checked, autoCreate: $('autocreate').checked }); msg('Opgeslagen'); await refresh(); });
$('doLogin').onclick = run(async () => { const r = await api('bambu/login', 'POST', { email: $('email').value, password: $('pw').value }); $('pw').value = ''; msg(r.needsCode ? 'Voer de verificatiecode in' : 'Ingelogd'); await refresh(); });
$('doVerify').onclick = run(async () => { await api('bambu/verify', 'POST', { code: $('code').value }); $('code').value = ''; msg('Ingelogd'); await refresh(); });
$('logout').onclick = run(async () => { await api('bambu/logout', 'POST'); await refresh(); });
$('sync').onclick = run(async () => { const r = await api('sync', 'POST'); msg(r.skipped ? 'Er loopt al een ronde' : r.error ? r.error : 'Synchronisatie klaar', !!r.error); await refresh(); });
$('load').onclick = run(async () => { overview = await api('overview'); renderOverview(); msg('Rollen geladen'); });
refresh().catch((e) => msg(e.message, true)); setInterval(() => refresh().catch(() => {}), 15000);
