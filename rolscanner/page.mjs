// De webpagina van de rolscanner (één bestand, geen afhankelijkheden). Bewust geen template-strings in het script.
import { makeQr } from './qr.mjs';

export const PAGE = String.raw`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rol toevoegen</title>
<style>
:root{--bg:#fff;--fg:#1b1b1b;--card:#f3f4f6;--acc:#0b6bcb;--bad:#c62828;--ok:#2e7d32;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--bg:#151517;--fg:#eee;--card:#232326;--acc:#6ab0ff;--bad:#ff8a80;--ok:#81c784}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:12px 16px 40px}
section{background:var(--card);border-radius:12px;padding:12px;margin:12px 0}
h1{font-size:1.25rem}h2{font-size:1rem;margin:0 0 8px}
label{display:block;margin:8px 0 2px;font-size:.85rem;opacity:.8}
input,select,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #8886;box-sizing:border-box;width:100%;background:var(--bg);color:var(--fg)}
button{background:var(--acc);color:#fff;border:0;min-height:48px;cursor:pointer;margin-top:10px}button.sec{background:#8885;color:var(--fg)}button:disabled{opacity:.45}
.row{display:flex;gap:10px}.row>*{flex:1}
.check input,.check select{border:2px solid var(--bad)}.check label::after{content:" \2013 controleer";color:var(--bad);font-weight:600}
#preview{max-width:100%;max-height:260px;border-radius:8px;display:none;margin-top:8px}
#msg{min-height:1.4em}.bad{color:var(--bad)}.ok{color:var(--ok)}
.swatch{width:48px;flex:none!important;padding:3px;height:46px}
#labelPrint{display:flex;gap:14px;align-items:center;background:#fff;color:#000;border-radius:8px;padding:10px}
#labelText{font-size:.95rem;line-height:1.3}#labelText b{display:block;font-size:1.05rem}
@media print{body *{visibility:hidden}#labelPrint,#labelPrint *{visibility:visible}#labelPrint{position:absolute;left:0;top:0;padding:4mm}}
label.chk{display:flex;gap:8px;align-items:center;font-size:1rem;opacity:1;margin:4px 0 8px}
details summary{cursor:pointer;padding:6px 0}
.chips{display:flex;gap:8px;margin-top:6px}.chip{flex:1;width:auto;margin:0;min-height:42px;background:#8885;color:var(--fg)}.chip.on{background:var(--acc);color:#fff}
ul{padding-left:18px;margin:6px 0}
</style></head><body><main>
<h1>Rol toevoegen</h1>
<section><h2>1. Instellingen (blijven staan)</h2>
<div class="row"><div><label for="loc">Locatie (van wie)</label><select id="loc"></select></div>
<div><label for="type">Type</label><select id="type"></select></div></div>
<div class="row"><div><label for="nozzle">Nozzle (&deg;C)</label><input id="nozzle" type="number" inputmode="numeric" min="100" max="400">
<div class="chips"><button type="button" class="chip" data-t="190">190</button><button type="button" class="chip" data-t="210">210</button><button type="button" class="chip" data-t="220">220</button></div></div>
<div><label for="bed">Bed (&deg;C)</label><input id="bed" type="number" inputmode="numeric" min="0" max="150"></div></div></section>
<section><h2>2. Foto van het label</h2>
<input id="photo" type="file" accept="image/*" capture="environment">
<img id="preview" alt="Foto van het label"><div id="reading" class="ok"></div></section>
<section><h2>3. Controleer wat gelezen is</h2>
<div id="fBrand"><label for="brand">Merk</label><input id="brand" list="brands" autocomplete="off"></div>
<div class="row"><div id="fMaterial"><label for="material">Materiaal</label><input id="material" list="materials" autocomplete="off"></div>
<div id="fName"><label for="name">Naam (product + kleur)</label><input id="name" autocomplete="off"></div></div>
<div id="fColor"><label for="hex">Kleur</label><div class="row"><input id="color" type="color" class="swatch" value="#888888"><input id="hex" placeholder="161616" maxlength="7" autocomplete="off"></div></div>
<div><label for="weight">Gewicht (g) <span id="wHint"></span></label><input id="weight" type="number" inputmode="decimal" min="1" max="10000"></div>
<button id="save" disabled>Opslaan en volgende rol</button><button id="clear" class="sec">Foto weggooien</button>
<div id="msg" role="status"></div></section>
<section id="labelSec" hidden><h2>QR-label van de laatste rol</h2>
<div id="labelPrint"><div id="qr"></div><div id="labelText"></div></div>
<div class="row"><button id="btPrint" type="button" hidden>Afdrukken naar Niimbot</button><button id="printLabel" class="sec" type="button">Label afdrukken (scherm)</button></div>
<div id="labelUrl" style="font-size:.8rem;opacity:.7;margin-top:6px;word-break:break-all"></div></section>
<section id="printerSec"><h2>Label-printer (Niimbot)</h2>
<div id="btHint" class="bad" hidden></div>
<div id="btControls" hidden>
<label class="chk"><input id="autoPrint" type="checkbox" style="width:auto"> Direct afdrukken na opslaan</label>
<div class="row"><button id="btConnect" type="button" class="sec">Verbind printer</button><button id="btTest" type="button" class="sec">Testlabel</button></div>
<div id="btStatus" style="margin-top:8px"></div>
<details style="margin-top:8px"><summary>Instellingen label en printer</summary>
<div class="row"><div><label for="lenmm">Label lengte (mm)</label><input id="lenmm" type="number" min="10" max="100" value="30"></div>
<div><label for="widmm">Label breedte (mm)</label><input id="widmm" type="number" min="8" max="24" value="20"></div></div>
<div class="row"><div><label for="density">Dichtheid (1-3)</label><select id="density"><option value="">Standaard</option><option>1</option><option>2</option><option>3</option></select></div>
<div><label for="ptask">Print task</label><select id="ptask"><option value="">Automatisch</option></select></div></div>
<div style="font-size:.8rem;opacity:.75;margin-top:6px">Komt het label verschoven of blanco uit, probeer dan een andere print task (bijv. B1 of D110M_V4) en tik op Testlabel.</div>
</details></div></section>
<section><h2>Toegevoegd in deze sessie</h2><ul id="done"></ul></section>
<datalist id="brands"></datalist><datalist id="materials"><option value="PLA"><option value="PETG"><option value="ABS"><option value="ASA"><option value="TPU"><option value="PA"><option value="PC"><option value="PVA"></datalist>
</main>
<script src="vendor/niimbluelib.min.js"></script>
<script>
/*QR*/
var $ = function (id) { return document.getElementById(id); };
var INFO = { labelBaseUrl: '' };
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function qrSvg(text, px) {
  var m = makeQr(text), n = m.length, d = '';
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + 4) + ' ' + (r + 4) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 8) + ' ' + (n + 8) + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
// QR-label van een rol: wijst naar de SpoolmanSync-pagina waar je de tray kiest (/scan/spool/ID).
function showLabel(j) {
  if (!INFO.labelBaseUrl) { $('labelSec').hidden = true; return; }
  var url = INFO.labelBaseUrl + '/scan/spool/' + j.spoolId;
  BT.last = { id: j.spoolId, url: url, name: j.name, weight: j.weight, location: j.location || '' }; $('btPrint').hidden = !btOk();
  $('qr').innerHTML = qrSvg(url, 150);
  $('labelText').innerHTML = '<b>#' + esc(j.spoolId) + ' ' + esc(j.name) + '</b>' + esc(j.weight) + ' g' + (j.location ? ' &middot; ' + esc(j.location) : '');
  $('labelUrl').textContent = url; $('labelSec').hidden = false;
}
$('printLabel').onclick = function () { window.print(); };
fetch('api/info').then(function (r) { return r.json(); }).then(function (j) { INFO = j; }).catch(function () {});

// ---- Niimbot-printer via Web Bluetooth (niimbluelib) ----
var BT = { client: null, last: null };
function btOk() { return !!(window.niimbluelib && navigator.bluetooth); }
function btSay(t, cls) { $('btStatus').textContent = t; $('btStatus').className = cls || ''; }
function numOr(v, d) { var n = Number(v); return isFinite(n) && n > 0 ? n : d; }
function labelDims() {
  var len = Math.max(10, Math.min(100, numOr($('lenmm').value, 30)));
  var wid = Math.max(8, Math.min(24, numOr($('widmm').value, 20)));
  return { w: Math.round(len * 8), h: Math.round(wid * 8) }; // 203 dpi is ongeveer 8 beeldpunten per mm; de printkop is 192 breed
}
function labelData(j) { return { id: j.spoolId, url: INFO.labelBaseUrl + '/scan/spool/' + j.spoolId, name: j.name, weight: j.weight, location: j.location || '' }; }
function wrapText(ctx, text, maxW, maxLines) {
  var words = String(text).split(/\s+/), lines = [], cur = '';
  words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (!cur || ctx.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = w; } });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '...'; }
  return lines;
}
// Tekent het label liggend (lengte x breedte van de rol); de bibliotheek draait het voor de printkop. Alleen zwart en wit.
function drawLabel(canvas, d) {
  var dim = labelDims(); canvas.width = dim.w; canvas.height = dim.h;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim.w, dim.h);
  var m = makeQr(d.url), n = m.length;
  var k = Math.max(2, Math.floor(Math.min(dim.h, dim.w * 0.62) / (n + 8)));
  var size = (n + 8) * k, y0 = Math.floor((dim.h - size) / 2);
  ctx.fillStyle = '#000';
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) ctx.fillRect((c + 4) * k, y0 + (r + 4) * k, k, k);
  var tx = size + 6, tw = dim.w - tx - 6;
  if (tw > 40) {
    var fs = dim.h >= 150 ? 26 : 20; ctx.textBaseline = 'top';
    ctx.font = 'bold ' + fs + 'px sans-serif'; var y = Math.max(4, Math.floor(dim.h * 0.1)); ctx.fillText('#' + d.id, tx, y); y += fs + 6;
    ctx.font = (fs - 4) + 'px sans-serif';
    wrapText(ctx, d.name, tw, 3).forEach(function (l) { ctx.fillText(l, tx, y); y += fs; });
    ctx.fillText(d.weight + ' g' + (d.location ? ' - ' + d.location : ''), tx, y + 2);
  }
  var img = ctx.getImageData(0, 0, dim.w, dim.h), px = img.data;
  for (var i = 0; i < px.length; i += 4) { var v = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) < 150 ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return { qrModules: n, moduleDots: k };
}
function getClient() {
  if (!BT.client) {
    BT.client = new niimbluelib.NiimbotBluetoothClient();
    BT.client.on('disconnect', function () { btSay('Printer losgekoppeld. Tik op Verbind printer.', 'bad'); });
  }
  return BT.client;
}
// Moet synchroon vanuit een tik worden aangeroepen: Chrome laat het apparaatkeuzemenu alleen bij een gebaar zien.
function btConnect() {
  var c = getClient();
  if (c.isConnected()) return Promise.resolve(c);
  btSay('Verbinden... kies je printer in het lijstje.', 'ok');
  return c.connect().then(function (info) {
    var meta = c.getModelMetadata();
    btSay('Verbonden met ' + (info && info.deviceName ? info.deviceName : 'printer') + (meta ? ' (' + meta.model + ')' : ''), 'ok');
    return c;
  });
}
async function btPrintCanvas(canvas) {
  var c = BT.client; if (!c || !c.isConnected()) throw new Error('Printer is niet verbonden');
  var meta = c.getModelMetadata();
  var taskName = $('ptask').value || c.getPrintTaskType();
  if (!taskName) throw new Error('Printermodel onbekend: kies een print task bij de instellingen');
  var density = Number($('density').value) || (meta && meta.densityDefault) || 2;
  var dir = meta && meta.printDirection ? meta.printDirection : 'left';
  var enc = niimbluelib.ImageEncoder.encodeCanvas(canvas, niimbluelib.PageColorType.SingleColor, dir);
  var task = c.protocol.newPrintTask(taskName, { totalPages: 1, density: density, labelType: niimbluelib.LabelType.WithGaps });
  try {
    await task.printInit(); await task.printPage(enc, 1); await task.waitForPageFinished(); await task.waitForFinished();
  } finally { try { await c.protocol.printEnd(); } catch (e) {} }
}
async function btPrintLabel(d) {
  var cv = document.createElement('canvas'); drawLabel(cv, d);
  btSay('Label wordt afgedrukt...', 'ok'); await btPrintCanvas(cv); btSay('Afgedrukt: #' + d.id, 'ok');
}
function btFail(e) { btSay((e && e.message) || String(e), 'bad'); }
function initBt() {
  if (!btOk()) {
    var secure = window.isSecureContext;
    $('btHint').hidden = false;
    $('btHint').textContent = !window.niimbluelib ? 'De printerbibliotheek is niet geladen (map vendor ontbreekt?).'
      : !secure ? 'Bluetooth-printen is hier niet beschikbaar: Chrome staat Bluetooth alleen toe op https:// of localhost. Zet in chrome://flags de optie "Insecure origins treated as secure" aan met dit adres: ' + location.origin
      : 'Deze browser ondersteunt geen Web Bluetooth. Gebruik Chrome op Android.';
    return;
  }
  $('btControls').hidden = false;
  window.niimbluelib.printTaskNames.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; $('ptask').appendChild(o); });
  ['lenmm', 'widmm', 'density', 'ptask'].forEach(function (k) { if (recall(k)) $(k).value = recall(k); $(k).addEventListener('change', function () { store(k, $(k).value); }); });
  $('autoPrint').checked = recall('autoprint') !== 'nee'; $('autoPrint').addEventListener('change', function () { store('autoprint', $('autoPrint').checked ? 'ja' : 'nee'); });
  $('btConnect').onclick = function () { btConnect().catch(btFail); };
  $('btTest').onclick = function () {
    var d = { id: 0, url: (INFO.labelBaseUrl || 'http://homeassistant.local:3005') + '/scan/spool/0', name: 'Testlabel', weight: 0, location: '' };
    btConnect().then(function () { return btPrintLabel(d); }).catch(btFail);
  };
  $('btPrint').onclick = function () { if (!BT.last) return; btConnect().then(function () { return btPrintLabel(BT.last); }).catch(btFail); };
}
var CAT = { types: [], locations: [] };
function store(k, v) { try { localStorage.setItem('rol.' + k, v); } catch (e) {} }
function recall(k) { try { return localStorage.getItem('rol.' + k) || ''; } catch (e) { return ''; } }
function curType() { return CAT.types.filter(function (t) { return t.key === $('type').value; })[0] || null; }
// Vast type: merk en materiaal staan vast, de nozzletemperatuur wordt ingevuld (aanpasbaar).
function applyType() {
  var t = curType(); if (!t) return;
  $('brand').value = t.brand; $('material').value = t.material;
  if (t.nozzle != null) { $('nozzle').value = t.nozzle; store('nozzle', t.nozzle); markChips(); }
  if (t.bed != null) { $('bed').value = t.bed; store('bed', t.bed); }
  validate();
}
function fillSelects() {
  $('loc').innerHTML = ''; CAT.locations.forEach(function (l) { var o = document.createElement('option'); o.value = l; o.textContent = l; $('loc').appendChild(o); });
  $('type').innerHTML = ''; var any = document.createElement('option'); any.value = ''; any.textContent = 'Anders (lees het label)'; $('type').appendChild(any);
  CAT.types.forEach(function (t) { var o = document.createElement('option'); o.value = t.key; o.textContent = t.label; $('type').appendChild(o); });
  if (recall('loc') && CAT.locations.indexOf(recall('loc')) >= 0) $('loc').value = recall('loc');
  if (CAT.types.some(function (t) { return t.key === recall('type'); })) $('type').value = recall('type');
  applyType();
}
$('loc').addEventListener('change', function () { store('loc', $('loc').value); validate(); });
$('type').addEventListener('change', function () { store('type', $('type').value); applyType(); });
var ids = ['nozzle', 'bed'];
ids.forEach(function (k) { try { $(k).value = localStorage.getItem('rol.' + k) || ''; } catch (e) {} $(k).addEventListener('input', function () { try { localStorage.setItem('rol.' + k, $(k).value); } catch (e) {} validate(); }); });
function markChips() { document.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-t') === $('nozzle').value.trim()); }); }
document.querySelectorAll('.chip').forEach(function (c) {
  c.addEventListener('click', function () { $('nozzle').value = c.getAttribute('data-t'); try { localStorage.setItem('rol.nozzle', $('nozzle').value); } catch (e) {} markChips(); validate(); });
});
$('nozzle').addEventListener('input', markChips); markChips();
function say(t, cls) { $('msg').textContent = t; $('msg').className = cls || ''; }
function validHex(v) { return /^#?[0-9a-fA-F]{6}$/.test(v.trim()); }
function validate() {
  var ok = $('brand').value.trim() && $('material').value.trim() && $('name').value.trim() && validHex($('hex').value) && Number($('weight').value) >= 1 && $('loc').value;
  $('save').disabled = !ok;
}
['brand', 'material', 'name', 'hex', 'weight'].forEach(function (k) { $(k).addEventListener('input', validate); });
$('hex').addEventListener('input', function () { if (validHex($('hex').value)) $('color').value = '#' + $('hex').value.replace('#', ''); });
$('color').addEventListener('input', function () { $('hex').value = $('color').value.replace('#', '').toUpperCase(); validate(); });
function mark(check) {
  ['fBrand:brand', 'fMaterial:material', 'fName:name', 'fColor:colorHex'].forEach(function (p) { var s = p.split(':'); $(s[0]).classList.toggle('check', check.indexOf(s[1]) >= 0); });
}
function resetFields() {
  ['brand', 'material', 'name', 'hex', 'weight'].forEach(function (k) { $(k).value = ''; });
  $('color').value = '#888888'; $('preview').style.display = 'none'; $('photo').value = ''; $('reading').textContent = ''; $('wHint').textContent = ''; mark([]);
  applyType(); validate(); // locatie, type en temperaturen blijven staan; bij een vast type komen merk en materiaal terug
}
$('clear').onclick = function () { resetFields(); say(''); };
function shrink(file) {
  return new Promise(function (resolve, reject) {
    var img = new Image(); var url = URL.createObjectURL(file);
    img.onload = function () {
      var s = Math.min(1, 1600 / Math.max(img.width, img.height)); var c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function () { reject(new Error('Foto kon niet worden geopend')); }; img.src = url;
  });
}
$('photo').addEventListener('change', async function () {
  var f = $('photo').files[0]; if (!f) return;
  say(''); $('reading').textContent = 'Codex leest het label...'; $('reading').className = 'ok';
  try {
    var data = await shrink(f); $('preview').src = data; $('preview').style.display = 'block';
    var r = await fetch('api/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: data }) });
    var j = await r.json(); if (!r.ok) throw new Error(j.error || 'Lezen mislukt');
    var t = curType(); var check = j.check.slice();
    if (t) { // vast type: alleen de kleur komt van de foto
      $('brand').value = t.brand; $('material').value = t.material;
      $('name').value = (t.product + ' ' + (j.fields.colorName || '')).trim();
      check = check.filter(function (c) { return c === 'colorHex'; }); if (!j.fields.colorName) check.push('name');
    } else { $('brand').value = j.fields.brand; $('material').value = j.fields.material; $('name').value = j.fields.name; }
    $('hex').value = j.fields.colorHex; if (j.fields.colorHex) $('color').value = '#' + j.fields.colorHex;
    $('wHint').textContent = j.fields.netWeight ? '(label: ' + j.fields.netWeight + ' g)' : '';
    j.check = check; mark(j.check); $('reading').textContent = j.check.length ? 'Gelezen. Rood omrande velden zijn onzeker of leeg.' : 'Gelezen. Controleer alles en vul het gewicht in.';
    $('weight').focus(); validate();
  } catch (e) { $('reading').textContent = ''; say(e.message, 'bad'); }
});
$('save').onclick = async function () {
  // De printer-verbinding moet in deze tik starten (vóór de eerste await), anders blokkeert Chrome het keuzemenu.
  var connectP = null;
  if (btOk() && $('autoPrint').checked) connectP = btConnect().catch(function (e) { btFail(e); return null; });
  $('save').disabled = true; say('Opslaan...');
  var body = { brand: $('brand').value, material: $('material').value, name: $('name').value, colorHex: $('hex').value, weight: $('weight').value, nozzle: $('nozzle').value, bed: $('bed').value, location: $('loc').value, typeKey: $('type').value };
  try {
    var r = await fetch('api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    var j = await r.json(); if (!r.ok) throw new Error(j.error || 'Opslaan mislukt');
    var li = document.createElement('li'); li.textContent = '#' + j.spoolId + ' ' + j.name + ' – ' + j.weight + ' g' + (j.location ? ' – ' + j.location : '') + (j.filamentReused ? ' (bestaand filament)' : ''); $('done').prepend(li);
    resetFields(); say('Opgeslagen als Spoolman #' + j.spoolId + '. Volgende rol!', 'ok'); showLabel(j); loadCatalog();
    if (connectP && BT.last) { // direct afdrukken; mislukt het, dan is de rol al opgeslagen en kan het label opnieuw
      if (await connectP) { try { await btPrintLabel(BT.last); } catch (e2) { btSay('Afdrukken mislukt: ' + e2.message + '. Tik op "Afdrukken naar Niimbot" om opnieuw te proberen.', 'bad'); } }
      else say('Opgeslagen als Spoolman #' + j.spoolId + ', maar de printer is niet verbonden. Tik op "Afdrukken naar Niimbot".', 'bad');
    }
  } catch (e) { say(e.message, 'bad'); validate(); }
};
async function loadCatalog() {
  try { var r = await fetch('api/catalog'); var j = await r.json(); if (!r.ok) { say(j.error || 'Bridge niet bereikbaar', 'bad'); return; }
    $('brands').innerHTML = ''; j.brands.forEach(function (b) { var o = document.createElement('option'); o.value = b; $('brands').appendChild(o); });
    var sameLists = JSON.stringify(CAT.types) === JSON.stringify(j.types) && JSON.stringify(CAT.locations) === JSON.stringify(j.locations);
    if (!sameLists) { var keepLoc = $('loc').value, keepType = $('type').value; CAT.types = j.types || []; CAT.locations = j.locations || []; fillSelects(); if (keepLoc && CAT.locations.indexOf(keepLoc) >= 0) $('loc').value = keepLoc; if (keepType && CAT.types.some(function (t) { return t.key === keepType; })) $('type').value = keepType; }
  } catch (e) {}
}
loadCatalog(); validate(); initBt();
</script></body></html>`.replace('/*QR*/', () => makeQr.toString());
