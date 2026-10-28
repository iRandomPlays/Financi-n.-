// Pagina die opent als je het QR-label van een rol scant (poort 8100, /scan/spool/<id>).
// Kies de tray, doe daarna de rol in de printer: de koppeling gebeurt pas als de printer de rol ziet.
export const SCAN_PAGE = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rol koppelen</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f6f8; --card:#fff; --fg:#1b1d21; --muted:#6b7280; --line:#e2e5ea; --accent:#0b7a3b; --warn:#a15c00; --bad:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121417; --card:#1c1f24; --fg:#eceef1; --muted:#9aa3b0; --line:#2c3037; --accent:#3ecf7a; --warn:#f0b35a; --bad:#ff7b72; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:16px/1.4 system-ui,sans-serif; }
  main { max-width:520px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:13px; margin:20px 0 8px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:10px; }
  .spool { display:flex; gap:12px; align-items:center; } .dot { width:34px; height:34px; border-radius:50%; border:1px solid var(--line); flex:none; }
  .muted { color:var(--muted); font-size:14px; }
  .status { border-left:5px solid var(--warn); } .status.ok { border-color:var(--accent); } .status.bad { border-color:var(--bad); }
  .status b { display:block; margin-bottom:2px; }
  .tray { display:flex; gap:10px; align-items:center; } .tray .grow { flex:1; min-width:0; } .tray .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chip { width:14px; height:14px; border-radius:50%; border:1px solid var(--line); display:inline-block; vertical-align:-2px; margin-right:4px; }
  button { font:inherit; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--fg); padding:10px 14px; min-height:44px; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; } button.link { border:0; background:none; color:var(--muted); text-decoration:underline; padding:6px 8px; min-height:0; }
  button:disabled { opacity:.5; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px; }
</style></head><body><main>
<h1>Rol koppelen aan een tray</h1>
<div id="spool" class="card muted">Laden...</div>
<div id="status"></div>
<h2>Kies de tray</h2>
<div id="trays"></div>
<p class="muted">Tik op een tray en doe daarna de rol in de printer. Zodra de printer de rol ziet, koppel ik hem aan die tray. Je hoeft niets te bevestigen.</p>
</main>
<script>
var id = location.pathname.split('/').filter(Boolean).pop();
var base = '/api/scan/' + encodeURIComponent(id);
var $ = function (s) { return document.getElementById(s); };
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function api(path, body) {
  return fetch(base + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('Fout ' + r.status)); return j; }); });
}
var PHASES = {
  'wacht-op-rol': ['Wacht op de rol', 'De tray is leeg. Doe de rol in de printer.', ''],
  'oude-rol-eruit': ['Haal eerst de oude rol eruit', 'Er zit nog een rol in deze tray. Haal die eruit en doe daarna de nieuwe rol erin.', ''],
  'rol-gezien': ['Rol gezien, een moment...', 'De printer ziet een rol. Ik controleer even of hij blijft zitten.', ''],
  gezien: ['Bijna klaar...', 'Ik koppel de rol nu.', ''],
  onbekend: ['Status van de tray onbekend', 'Home Assistant geeft nu geen status van de printer. Ik blijf proberen.', 'bad']
};
var busy = false;
function render(d) {
  var s = d.spool, box = $('spool'); box.className = 'card spool'; box.textContent = '';
  var dot = el('div', 'dot'); dot.style.background = s.colorHex || 'transparent'; box.appendChild(dot);
  var t = el('div'); t.appendChild(el('b', '', 'Rol #' + s.id + ' ' + s.name));
  t.appendChild(el('div', 'muted', [s.grams != null ? Math.round(s.grams) + ' g over' : '', s.location].filter(Boolean).join(' - '))); box.appendChild(t);
  var st = $('status'); st.textContent = '';
  var cur = d.trays.filter(function (x) { return x.id === d.assignedTrayId; })[0];
  if (d.pending) {
    var ph = PHASES[d.pending.phase] || PHASES['wacht-op-rol'];
    var c = el('div', 'card status ' + (ph[2] || '')); c.appendChild(el('b', '', ph[0] + ': ' + d.pending.label)); c.appendChild(el('div', 'muted', ph[1]));
    if (d.pending.error) c.appendChild(el('div', 'muted', 'Laatste fout: ' + d.pending.error));
    var row = el('div', 'row');
    var now = el('button', '', 'Rol zit er al in: nu koppelen'); now.onclick = function () { act('/now', { trayId: d.pending.trayId }); }; row.appendChild(now);
    var no = el('button', 'link', 'Annuleren'); no.onclick = function () { act('/cancel', {}); }; row.appendChild(no);
    c.appendChild(row); st.appendChild(c);
  } else if (cur) {
    var ok = el('div', 'card status ok'); ok.appendChild(el('b', '', 'Gekoppeld aan ' + cur.printer + ' ' + cur.group + ' ' + cur.label)); st.appendChild(ok);
  }
  var list = $('trays'); list.textContent = '';
  var lastGroup = null;
  d.trays.forEach(function (tr) {
    var key = tr.printer + ' - ' + tr.group;
    if (key !== lastGroup) { lastGroup = key; list.appendChild(el('h2', '', key)); }
    var card = el('div', 'card tray'); var g = el('div', 'grow');
    g.appendChild(el('b', '', tr.label));
    var line = el('div', 'muted name'); var chip = el('span', 'chip'); chip.style.background = tr.color || 'transparent'; line.appendChild(chip);
    line.appendChild(document.createTextNode(tr.name || 'leeg')); g.appendChild(line);
    if (tr.assignedSpoolId && tr.assignedSpoolId !== s.id) g.appendChild(el('div', 'muted', 'Nu gekoppeld aan rol #' + tr.assignedSpoolId));
    if (tr.waitingSpoolId && tr.waitingSpoolId !== s.id) g.appendChild(el('div', 'muted', 'Rol #' + tr.waitingSpoolId + ' wacht hier al'));
    card.appendChild(g);
    var isMine = d.pending && d.pending.trayId === tr.id;
    var b = el('button', isMine ? '' : 'primary', isMine ? 'Gekozen' : 'Wacht op rol'); b.disabled = isMine || busy;
    b.onclick = function () { act('/queue', { trayId: tr.id }); }; card.appendChild(b);
    list.appendChild(card);
  });
}
function show(e) { var st = $('status'); st.textContent = ''; var c = el('div', 'card status bad'); c.appendChild(el('b', '', 'Mislukt')); c.appendChild(el('div', 'muted', e.message)); st.appendChild(c); }
function act(path, body) { busy = true; api(path, body).then(render).catch(show).then(function () { busy = false; }); }
function poll() { if (busy) return; api('').then(render).catch(function (e) { if (!$('trays').children.length) show(e); }); }
poll(); setInterval(poll, 3000);
</script></body></html>`;
