import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Store, Bridge } from '../spoolman_bambu_bridge/app/core.mjs';
import { createLanApp } from '../spoolman_bambu_bridge/app/server.mjs';
import { validate } from '../spoolman_bambu_bridge/app/quickadd.mjs';
import { createScanner, sanitize, readLabel } from '../rolscanner/rolscanner.mjs';

const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const url = (s) => `http://127.0.0.1:${s.address().port}`;

// Nagebootste Spoolman met leveranciers, filamenten en rollen.
async function fakeSpoolman() {
  const db = { vendors: [{ id: 1, name: 'Sunlu' }], filaments: [], spools: [], posts: [] };
  const srv = await listen(async (req, res) => {
    const p = req.url.split('?')[0];
    if (req.method === 'GET' && p === '/api/v1/vendor') return json(res, 200, db.vendors);
    if (req.method === 'GET' && p === '/api/v1/filament') return json(res, 200, db.filaments);
    if (req.method === 'GET' && p === '/api/v1/spool') return json(res, 200, db.spools);
    const b = await readBody(req); db.posts.push([p, b]);
    if (p === '/api/v1/vendor') { const v = { id: db.vendors.length + 1, ...b }; db.vendors.push(v); return json(res, 200, v); }
    if (p === '/api/v1/filament') { const f = { id: db.filaments.length + 1, ...b, vendor: db.vendors.find((v) => v.id === b.vendor_id) }; db.filaments.push(f); return json(res, 200, f); }
    if (p === '/api/v1/spool') { const s = { id: db.spools.length + 1, ...b }; db.spools.push(s); return json(res, 200, s); }
    json(res, 404, {});
  });
  return { db, srv };
}

async function bridgeWith(spoolmanUrl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-'));
  const store = new Store(path.join(dir, 'state.json')); await store.load();
  store.state.settings.spoolmanUrl = spoolmanUrl;
  return new Bridge({ store });
}

const good = { brand: 'Sunlu', material: 'pla', name: 'PLA C220 Zwart', colorHex: '#161616', weight: 1000, nozzle: 210, bed: 60 };

test('validatie: duidelijke fouten', () => {
  assert.throws(() => validate({ ...good, brand: '' }), /Merk/);
  assert.throws(() => validate({ ...good, colorHex: 'zwart' }), /Kleurcode/);
  assert.throws(() => validate({ ...good, weight: 0 }), /Gewicht/);
  assert.throws(() => validate({ ...good, nozzle: 900 }), /Nozzle/);
  assert.equal(validate({ ...good, bed: '' }).bed, null);
  assert.equal(validate(good).material, 'PLA');
});

test('snel toevoegen: bestaande leverancier, nieuw filament met temperaturen, hergebruik bij tweede rol', async () => {
  const { db, srv } = await fakeSpoolman();
  const b = await bridgeWith(url(srv));
  const r1 = await b.quickAddSpool(good);
  assert.equal(r1.filamentReused, false); assert.equal(r1.vendorCreated, false);
  assert.equal(db.filaments.length, 1); assert.equal(db.filaments[0].settings_extruder_temp, 210); assert.equal(db.filaments[0].settings_bed_temp, 60);
  assert.equal(db.filaments[0].color_hex, '161616'); assert.equal(db.filaments[0].vendor_id, 1);
  assert.equal(db.spools[0].initial_weight, 1000); assert.equal(db.spools[0].used_weight, 0);
  const r2 = await b.quickAddSpool({ ...good, brand: 'SUNLU', weight: 800 }); // andere schrijfwijze, ander gewicht
  assert.equal(r2.filamentReused, true); assert.equal(db.filaments.length, 1); assert.equal(db.spools.length, 2); assert.equal(db.spools[1].initial_weight, 800);
  const r3 = await b.quickAddSpool({ ...good, brand: 'Nieuw Merk' });
  assert.equal(r3.vendorCreated, true); assert.equal(db.vendors.length, 2);
  srv.close();
});

test('lan-ingang: zonder of met fout token geweigerd, met token werkt, blokkade na herhaalde fouten, token niet in status', async () => {
  const { db, srv } = await fakeSpoolman();
  const b = await bridgeWith(url(srv));
  const lan = createLanApp({ bridge: b }); await new Promise((r) => lan.listen(0, '127.0.0.1', r));
  const post = (tok) => fetch(`${url(lan)}/api/quick-add`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok && { authorization: `Bearer ${tok}` }) }, body: JSON.stringify(good) });
  assert.equal((await post()).status, 401); // nog geen token ingesteld
  const token = await b.newLanToken();
  assert.equal(JSON.stringify(b.status()).includes(token), false);
  assert.equal(b.status().settings.lanTokenSet, true); assert.equal(b.status().settings.lanTokenHash, undefined);
  assert.equal((await post('fout')).status, 401);
  const ok = await post(token); assert.equal(ok.status, 200); assert.equal(db.spools.length, 1);
  const cat = await (await fetch(`${url(lan)}/api/quick-add/catalog`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.ok(cat.brands.includes('Sunlu')); assert.equal(cat.filaments[0].nozzle, 210);
  assert.equal((await fetch(`${url(lan)}/api/spool`, { headers: { authorization: `Bearer ${token}` } })).status, 404); // alleen smalle ingang
  const bad = await post('x'); const results = [bad.status]; for (let i = 0; i < 6; i++) results.push((await post('x')).status);
  assert.ok(results.includes(429));
  assert.equal((await post(token)).status, 429); // blokkade geldt ook even voor geldig token vanaf dit adres
  lan.close(); srv.close();
});

test('nieuw token maakt het oude ongeldig', async () => {
  const b = await bridgeWith('http://127.0.0.1:1');
  const t1 = await b.newLanToken(); const t2 = await b.newLanToken();
  assert.equal(b.checkLanToken(t1), false); assert.equal(b.checkLanToken(t2), true);
});

test('sanitize: onzekere en lege velden worden gemarkeerd; hex genormaliseerd', () => {
  const r = sanitize({ brand: ' Sunlu ', material: 'pla', product: 'PLA C220', colorName: 'Zwart', colorHex: '#161616', netWeight: 1000, unsure: ['colorHex'] });
  assert.deepEqual(r.fields, { brand: 'Sunlu', material: 'PLA', name: 'PLA C220 Zwart', colorHex: '161616', netWeight: 1000, colorName: 'Zwart' });
  assert.deepEqual(r.check, ['colorHex']);
  const r2 = sanitize({ brand: '', material: 'PLA', product: 'x', colorName: '', colorHex: 'geen', netWeight: null, unsure: [] });
  assert.ok(r2.check.includes('brand') && r2.check.includes('colorHex') && r2.fields.colorHex === '');
  assert.deepEqual(sanitize(null).fields.name, '');
});

test('rolscanner: nagebootste codex wordt aangeroepen met foto, schema en prompt via stdin', async (t) => {
  if (process.platform === 'win32') return t.skip('shim is voor unix');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fakecodex-'));
  const shim = path.join(dir, 'codex');
  const logFile = path.join(dir, 'log.json');
  await fs.writeFile(shim, `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2); let stdin = ''; process.stdin.on('data', (d) => stdin += d);
process.stdin.on('end', () => {
  const out = a[a.indexOf('-o') + 1]; const img = a[a.indexOf('-i') + 1];
  fs.writeFileSync(${JSON.stringify(logFile)}, JSON.stringify({ args: a, stdin, imgExists: fs.existsSync(img), schemaExists: fs.existsSync(a[a.indexOf('--output-schema') + 1]), imgBytes: fs.readFileSync(img).length }));
  fs.writeFileSync(out, 'Hier is het resultaat: ' + JSON.stringify({ brand: 'Sunlu', material: 'PLA', product: 'PLA C220', colorName: 'Zwart', colorHex: '#161616', netWeight: 1000, unsure: [] }));
});`);
  await fs.chmod(shim, 0o755);
  const r = await readLabel(Buffer.from('jpegdata'), 'jpg', { codexBin: shim, codexArgs: [], timeoutSec: 20 });
  assert.equal(r.fields.name, 'PLA C220 Zwart');
  const log = JSON.parse(await fs.readFile(logFile, 'utf8'));
  assert.equal(log.args.at(-1), '-'); assert.ok(log.args.includes('--skip-git-repo-check')); assert.ok(log.args.includes('read-only'));
  assert.ok(log.imgExists && log.schemaExists); assert.equal(log.imgBytes, 8); assert.match(log.stdin, /filament/);
  await assert.rejects(() => readLabel(Buffer.from('x'), 'jpg', { codexBin: path.join(dir, 'bestaat-niet'), timeoutSec: 5 }), /niet gevonden/);
});

test('rolscanner-server: lezen, opslaan via bridge, foutafhandeling', async () => {
  const seen = [];
  const bridgeSrv = await listen(async (req, res) => {
    seen.push([req.method, req.url, req.headers.authorization, req.method === 'POST' ? await readBody(req) : null]);
    if (req.url === '/api/quick-add') return json(res, 200, { spoolId: 7, name: 'Sunlu PLA C220 Zwart', weight: 1000, filamentReused: false });
    json(res, 200, { brands: ['Sunlu'], filaments: [] });
  });
  const reads = [];
  const sc = createScanner({ bridgeUrl: url(bridgeSrv), token: 'tok' }, { read: async (buf, ext) => { reads.push([buf.length, ext]); return { fields: { brand: 'Sunlu' }, check: [] }; } });
  await new Promise((r) => sc.listen(0, '127.0.0.1', r));
  const post = (p, b) => fetch(`${url(sc)}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.match(await (await fetch(url(sc))).text(), /Rol toevoegen/);
  const img = 'data:image/jpeg;base64,' + Buffer.from('abcd').toString('base64');
  assert.equal((await (await post('/api/read', { image: img })).json()).fields.brand, 'Sunlu'); assert.deepEqual(reads, [[4, 'jpg']]);
  assert.equal((await post('/api/read', { image: 'geen afbeelding' })).status, 400);
  const saved = await post('/api/save', { ...good, comment: 'HACK', extra: 'x', location: 'Ine', typeKey: 'c190' });
  assert.equal((await saved.json()).spoolId, 7);
  const fwd = seen.find((s) => s[1] === '/api/quick-add');
  assert.equal(fwd[2], 'Bearer tok'); assert.equal(fwd[3].comment, 'Toegevoegd via rolscanner'); assert.equal(fwd[3].extra, undefined);
  assert.equal(fwd[3].location, 'Ine'); assert.equal(fwd[3].typeKey, 'c190');
  assert.equal((await fetch(`${url(sc)}/api/catalog`)).status, 200);
  const sc2 = createScanner({ bridgeUrl: '', token: '' }); await new Promise((r) => sc2.listen(0, '127.0.0.1', r));
  assert.equal((await fetch(`${url(sc2)}/api/catalog`)).status, 500);
  sc.close(); sc2.close(); bridgeSrv.close();
});

test('locatie en vast type: locatie komt in Spoolman, profiel wordt vastgelegd, onbekend type of onbekende locatie wordt geweigerd', async () => {
  const { db, srv } = await fakeSpoolman();
  const b = await bridgeWith(url(srv));
  const r = await b.quickAddSpool({ ...good, name: 'PLA C190 Zwart', location: 'vincent', typeKey: 'C190' });
  assert.equal(db.spools[0].location, 'vincent'); assert.equal(r.location, 'vincent');
  assert.equal(b.s.profileOverrides[r.spoolId].id, 'P71db9ac'); assert.equal(b.s.profileOverrides[r.spoolId].name, 'PLA C190');
  await assert.rejects(() => b.quickAddSpool({ ...good, typeKey: 'bestaat-niet' }), /Onbekend type/);
  await assert.rejects(() => b.quickAddSpool({ ...good, location: 'Piet' }), /Onbekende locatie/);
  assert.equal(db.spools.length, 1); // bij een geweigerde aanvraag is niets aangemaakt
  const r2 = await b.quickAddSpool({ ...good }); // zonder locatie en type mag ook
  assert.equal(db.spools[1].location, undefined); assert.equal(b.s.profileOverrides[r2.spoolId], undefined);
  const cat = await b.quickAddCatalog();
  assert.deepEqual(cat.locations, ['Vincent', 'Ine']); assert.deepEqual(cat.types.map((t) => t.key), ['c190', 'c210', 'c220', 'petg']);
  assert.deepEqual(cat.types.map((t) => t.profile.id), ['P71db9ac', 'Paed3d28', 'P9877e1f', 'P05a4964']);
  srv.close();
});

test('instellingen: locaties en typen worden gevalideerd', async () => {
  const b = await bridgeWith('http://127.0.0.1:1');
  await b.updateSettings({ locations: ['Vincent', 'Ine', 'Opa'] });
  assert.deepEqual(b.s.settings.locations, ['Vincent', 'Ine', 'Opa']);
  await assert.rejects(() => b.updateSettings({ locations: [] }), /Locaties/);
  await assert.rejects(() => b.updateSettings({ locations: ['A', 'a'] }), /Locaties/);
  const t = { key: 'x1', label: 'X', brand: 'B', material: 'pla', product: 'P', nozzle: '205', profile: { vendor: 'V', type: 'pla', name: 'N', id: 'Pabc' } };
  await b.updateSettings({ rolTypes: [t] });
  assert.equal(b.s.settings.rolTypes[0].nozzle, 205); assert.equal(b.s.settings.rolTypes[0].material, 'PLA'); assert.equal(b.s.settings.rolTypes[0].bed, null);
  await assert.rejects(() => b.updateSettings({ rolTypes: [t, t] }), /dubbele/);
  await assert.rejects(() => b.updateSettings({ rolTypes: [{ ...t, profile: { vendor: 'V', name: 'N' } }] }), /verplicht/);
});

test('rolscanner serveert de meegeleverde printerbibliotheek en de labelinstelling', async () => {
  const sc = createScanner({ bridgeUrl: '', token: '', labelBaseUrl: 'http://homeassistant.local:3005/' });
  await new Promise((r) => sc.listen(0, '127.0.0.1', r));
  const lib = await fetch(`${url(sc)}/vendor/niimbluelib.min.js`);
  assert.equal(lib.status, 200); assert.match(lib.headers.get('content-type'), /javascript/);
  assert.match(await lib.text(), /NiimbotBluetoothClient/);
  assert.deepEqual(await (await fetch(`${url(sc)}/api/info`)).json(), { labelBaseUrl: 'http://homeassistant.local:3005' });
  const page = await (await fetch(url(sc))).text();
  assert.ok(page.includes('vendor/niimbluelib.min.js') && page.includes('Afdrukken naar Niimbot'));
  sc.close();
});
