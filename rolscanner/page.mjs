// De webpagina van de rolscanner (één bestand, geen afhankelijkheden). Bewust geen template-strings in het script.
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
.swatch{width:44px;flex:none!important}
ul{padding-left:18px;margin:6px 0}
</style></head><body><main>
<h1>Rol toevoegen</h1>
<section><h2>1. Printinstellingen (blijven staan)</h2>
<div class="row"><div><label for="nozzle">Nozzle (&deg;C)</label><input id="nozzle" type="number" inputmode="numeric" min="100" max="400"></div>
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
<section><h2>Toegevoegd in deze sessie</h2><ul id="done"></ul></section>
<datalist id="brands"></datalist><datalist id="materials"><option value="PLA"><option value="PETG"><option value="ABS"><option value="ASA"><option value="TPU"><option value="PA"><option value="PC"><option value="PVA"></datalist>
</main>
<script>
var $ = function (id) { return document.getElementById(id); };
var ids = ['nozzle', 'bed'];
ids.forEach(function (k) { try { $(k).value = localStorage.getItem('rol.' + k) || ''; } catch (e) {} $(k).addEventListener('input', function () { try { localStorage.setItem('rol.' + k, $(k).value); } catch (e) {} validate(); }); });
function say(t, cls) { $('msg').textContent = t; $('msg').className = cls || ''; }
function validHex(v) { return /^#?[0-9a-fA-F]{6}$/.test(v.trim()); }
function validate() {
  var ok = $('brand').value.trim() && $('material').value.trim() && $('name').value.trim() && validHex($('hex').value) && Number($('weight').value) >= 1;
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
  $('color').value = '#888888'; $('preview').style.display = 'none'; $('photo').value = ''; $('reading').textContent = ''; $('wHint').textContent = ''; mark([]); validate();
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
    $('brand').value = j.fields.brand; $('material').value = j.fields.material; $('name').value = j.fields.name;
    $('hex').value = j.fields.colorHex; if (j.fields.colorHex) $('color').value = '#' + j.fields.colorHex;
    $('wHint').textContent = j.fields.netWeight ? '(label: ' + j.fields.netWeight + ' g)' : '';
    mark(j.check); $('reading').textContent = j.check.length ? 'Gelezen. Rood omrande velden zijn onzeker of leeg.' : 'Gelezen. Controleer alles en vul het gewicht in.';
    $('weight').focus(); validate();
  } catch (e) { $('reading').textContent = ''; say(e.message, 'bad'); }
});
$('save').onclick = async function () {
  $('save').disabled = true; say('Opslaan...');
  var body = { brand: $('brand').value, material: $('material').value, name: $('name').value, colorHex: $('hex').value, weight: $('weight').value, nozzle: $('nozzle').value, bed: $('bed').value };
  try {
    var r = await fetch('api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    var j = await r.json(); if (!r.ok) throw new Error(j.error || 'Opslaan mislukt');
    var li = document.createElement('li'); li.textContent = '#' + j.spoolId + ' ' + j.name + ' – ' + j.weight + ' g' + (j.filamentReused ? ' (bestaand filament)' : ''); $('done').prepend(li);
    resetFields(); say('Opgeslagen als Spoolman #' + j.spoolId + '. Volgende rol!', 'ok'); loadCatalog();
  } catch (e) { say(e.message, 'bad'); validate(); }
};
async function loadCatalog() {
  try { var r = await fetch('api/catalog'); if (!r.ok) return; var j = await r.json();
    $('brands').innerHTML = ''; j.brands.forEach(function (b) { var o = document.createElement('option'); o.value = b; $('brands').appendChild(o); });
  } catch (e) {}
}
loadCatalog(); validate();
</script></body></html>`;
