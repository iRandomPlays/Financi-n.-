import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Store, Bridge } from '../spoolman_bambu_bridge/app/core.mjs';
import { analyzeGcode, proposeAbort, gramsFromMm } from '../spoolman_bambu_bridge/app/usage.mjs';
import { createApp } from '../spoolman_bambu_bridge/app/server.mjs';

const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };

async function setup({ spools, cloud = [], failCreate = null } = {}) {
  const sm = { spools: spools || [] };
  const bambu = { cloud, nextId: 100, puts: [], creates: 0, failCreate };
  const smSrv = await listen((req, res) => req.url.startsWith('/api/v1/spool') ? json(res, 200, sm.spools) : json(res, 200, {}));
  const bSrv = await listen(async (req, res) => {
    if (!req.url.includes('/my/filament/v2')) return json(res, 404, {});
    if (req.method === 'GET') return json(res, 200, { total: bambu.cloud.length, hits: bambu.cloud });
    const body = await readBody(req);
    if (req.method === 'PUT') { bambu.puts.push(body); const c = bambu.cloud.find((x) => x.id === body.id); if (c) c.netWeight = body.netWeight; return json(res, 200, {}); }
    if (req.method === 'POST') {
      bambu.creates++;
      const c = { id: bambu.nextId++, ...body }; bambu.cloud.push(c);
      if (bambu.failCreate === 'uncertain') { res.destroy(); return; }
      return json(res, 200, { id: c.id });
    }
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-'));
  const store = new Store(path.join(dir, 'state.json')); await store.load();
  const realFetch = fetch;
  const fetchImpl = (url, opts) => realFetch(String(url).replace(/^https:\/\/api\.bambulab\.com/, `http://127.0.0.1:${bSrv.address().port}`), opts);
  const bridge = new Bridge({ store, fetchImpl });
  store.state.settings.spoolmanUrl = `http://127.0.0.1:${smSrv.address().port}`;
  store.state.bambu = { token: 't', email: 'a@b.nl', status: 'connected' };
  return { sm, bambu, bridge, store, dir, close: () => { smSrv.close(); bSrv.close(); } };
}
const spool = (id, remaining, extra = {}) => ({ id, remaining_weight: remaining, initial_weight: 1000, archived: false, filament: { name: 'Wit', material: 'PLA', color_hex: 'FFFFFF', vendor: { name: 'Bambu' } }, ...extra });

test('afronden naar hele grammen en alleen schrijven bij afwijking', async () => {
  const t = await setup({ spools: [spool(1, 743.6)], cloud: [{ id: 7, netWeight: 800, filamentName: 'PLA Basic', filamentType: 'PLA' }] });
  await t.bridge.addLink(1, 7);
  let r = await t.bridge.syncOnce();
  assert.equal(r.updated, 1); assert.equal(t.bambu.puts[0].netWeight, 744); assert.equal(t.bambu.puts[0].filamentName, 'PLA Basic');
  r = await t.bridge.syncOnce(); assert.equal(r.unchanged, 1); assert.equal(t.bambu.puts.length, 1);
  t.close();
});

test('ontbrekend gewicht wordt niet als 0 gesynchroniseerd; gearchiveerd en ontbrekend pauzeren', async () => {
  const t = await setup({ spools: [spool(1, undefined), spool(2, 500, { archived: true })], cloud: [{ id: 7, netWeight: 800 }, { id: 8, netWeight: 800 }, { id: 9, netWeight: 1 }] });
  delete t.sm.spools[0].remaining_weight;
  await t.bridge.addLink(1, 7); await t.bridge.addLink(2, 8); await t.bridge.addLink(3, 9);
  const r = await t.bridge.syncOnce();
  assert.equal(r.unlinked, 1); assert.equal(r.paused, 2); assert.equal(t.bambu.puts.length, 0);
  assert.equal(t.store.state.links.length, 2); assert.equal(t.bambu.cloud.length, 3); // Bambu-rol blijft staan
  assert.ok(t.store.state.links.every((l) => l.paused));
  t.close();
});

test('gelijktijdige rondes worden overgeslagen', async () => {
  const t = await setup({ spools: [spool(1, 10)], cloud: [{ id: 7, netWeight: 800 }] });
  await t.bridge.addLink(1, 7);
  const [a, b] = await Promise.all([t.bridge.syncOnce(), t.bridge.syncOnce()]);
  assert.ok(a.skipped || b.skipped);
  t.close();
});

test('mislukte update herstelt in volgende ronde met nieuwste stand', async () => {
  const t = await setup({ spools: [spool(1, 700)], cloud: [{ id: 7, netWeight: 800 }] });
  await t.bridge.addLink(1, 7);
  const orig = t.bridge.bambu.bind(t.bridge);
  t.bridge.bambu = () => { const c = orig(); c.updateWeight = async () => { throw new Error('boem'); }; return c; };
  let r = await t.bridge.syncOnce(); assert.equal(r.failed, 1);
  t.bridge.bambu = orig; t.sm.spools[0].remaining_weight = 650;
  r = await t.bridge.syncOnce(); assert.equal(r.updated, 1); assert.equal(t.bambu.puts.at(-1).netWeight, 650);
  t.close();
});

test('dubbele koppeling wordt geweigerd; ontkoppelen laat rollen intact', async () => {
  const t = await setup({ spools: [spool(1, 10)], cloud: [{ id: 7, netWeight: 1 }] });
  const l = await t.bridge.addLink(1, 7);
  await assert.rejects(() => t.bridge.addLink(1, 8)); await assert.rejects(() => t.bridge.addLink(2, 7));
  await t.bridge.removeLink(l.id);
  assert.equal(t.sm.spools.length, 1); assert.equal(t.bambu.cloud.length, 1);
  t.close();
});

test('aanmaken in Bambu: markering, geen duplicaat bij onzekere reactie of herhaling', async () => {
  const t = await setup({ spools: [spool(1, 321.4)], failCreate: 'uncertain' });
  const l = await t.bridge.createBambuFor(1);
  assert.equal(t.bambu.creates, 1); assert.equal(t.bambu.cloud[0].netWeight, 321); assert.match(t.bambu.cloud[0].note, /\[spoolman:1\]/);
  assert.equal(String(l.bambuId), String(t.bambu.cloud[0].id));
  await t.bridge.removeLink(l.id);
  await t.bridge.createBambuFor(1); // hergebruikt bestaande gemarkeerde rol
  assert.equal(t.bambu.creates, 1);
  t.close();
});

test('suggesties op kleur+materiaal zijn nooit automatisch gekoppeld en dubbelzinnig bij meerdere', async () => {
  const c = (id) => ({ id, filamentType: 'PLA', color: 'FFFFFF', netWeight: 1 });
  const t = await setup({ spools: [spool(1, 10)], cloud: [c(1), c(2)] });
  const o = await t.bridge.overview();
  assert.equal(o.suggestions[0].confidence, 'dubbelzinnig'); assert.equal(o.links.length, 0);
  t.close();
});

test('interval wordt begrensd; state overleeft herstart; geen wachtwoord/token in status', async () => {
  const t = await setup({});
  await assert.rejects(() => t.bridge.updateSettings({ intervalSeconds: 10 })); await assert.rejects(() => t.bridge.updateSettings({ intervalSeconds: 4000 }));
  await t.bridge.updateSettings({ intervalSeconds: 45 }); await t.bridge.addLink(1, 2);
  const s2 = new Store(path.join(t.dir, 'state.json')); await s2.load();
  assert.equal(s2.state.settings.intervalSeconds, 45); assert.equal(s2.state.links.length, 1);
  assert.ok(!JSON.stringify(t.bridge.status()).includes('"token"'));
  t.bridge.schedule(); clearInterval(t.bridge.timer); t.close();
});

test('API: ingress-controle weigert vreemde bron niet-lokaal en health blijft open', async () => {
  const t = await setup({});
  const app = createApp({ bridge: t.bridge, ingressOnly: true });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(`${base}/api/status`)).status, 403);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  app.close(); t.close();
});
test('API: status en schatting zonder ingress-beperking', async () => {
  const t = await setup({});
  const app = createApp({ bridge: t.bridge });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await (await fetch(`${base}/api/status`)).json()).version.length > 0, true);
  assert.match(await (await fetch(`${base}/`)).text(), /Spoolman Bambu Bridge/);
  app.close(); t.close();
});

// ---- G-code ----
test('gcode: relatieve extrusie, retractie, tool-wissel, laagvoorstel', () => {
  const g = `M83
; layer num/total_layer_count: 1/3
T0
G1 X1 E10
G1 E-2
G1 X2 E2
G1 X3 E5
; layer num/total_layer_count: 2/3
T1
G1 X1 E10
; layer num/total_layer_count: 3/3
G1 X1 E700`;
  const a = analyzeGcode(g);
  assert.equal(a.filaments[0].mm, 15); // 10 + (2 terug na retractie telt niet) + 5
  assert.equal(a.filaments[1].mm, 710);
  const p = proposeAbort(a, 2);
  assert.equal(p.kind, 'schatting'); assert.equal(p.requiresConfirmation, true);
  const f1 = p.filaments.find((f) => f.filament === 1);
  assert.equal(f1.estimatedGrams, Math.round(gramsFromMm(10) * 10) / 10);
  assert.ok(f1.uncertaintyGrams > 0);
});
test('gcode: absolute extrusie met G92-reset', () => {
  const a = analyzeGcode('M82\nG1 E5\nG1 E10\nG92 E0\nG1 E4');
  assert.equal(a.filaments[0].mm, 14);
});

test('spoolman-statuscontrole meldt aantal rollen of fout', async () => {
  const t = await setup({ spools: [spool(1, 10), spool(2, 5, { archived: true })] });
  assert.deepEqual(await t.bridge.spoolmanCheck(), { ok: true, count: 2, active: 1 });
  t.store.state.settings.spoolmanUrl = 'http://127.0.0.1:1';
  assert.equal((await t.bridge.spoolmanCheck()).ok, false);
  t.close();
});

test('lege Spoolman-lijst ontkoppelt niets maar pauzeert', async () => {
  const t = await setup({ spools: [], cloud: [{ id: 7, netWeight: 800 }] });
  await t.bridge.addLink(1, 7);
  const r = await t.bridge.syncOnce();
  assert.equal(r.unlinked, undefined); assert.equal(r.paused, 1); assert.equal(t.store.state.links.length, 1);
  t.close();
});
