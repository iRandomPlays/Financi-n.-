// Browsertest van de QR-pagina /scan/spool/<id> (Chromium via Playwright) met een echte bridge en nagebootste Spoolman, SpoolmanSync en Home Assistant.
// Draaien met: node tests/browser/scan.browser.cjs   (duurt ~15 s: de rol moet 8 s in de tray worden gezien)
const { chromium } = require('playwright');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
const json = (res, c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
const body = async (req) => { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const TRAY = 'sensor.x2d_ams_1_tray_1';

(async () => {
  const root = path.resolve(__dirname, '../../spoolman_bambu_bridge/app');
  const { Store, Bridge } = await import(path.join(root, 'core.mjs'));
  const { HaPublisher } = await import(path.join(root, 'publish.mjs'));
  const { createLanApp } = await import(path.join(root, 'server.mjs'));
  const world = { ha: { [TRAY]: { state: 'Empty', attributes: { empty: true } } }, assigns: [], assigned: null };
  const spools = () => [{ id: 5, remaining_weight: 912.4, initial_weight: 1000, archived: false, location: 'Vincent', extra: world.assigned ? { active_tray: JSON.stringify(world.assigned) } : {},
    filament: { name: 'PLA C220 Zwart', material: 'PLA', color_hex: '161616', vendor: { name: 'SUNLU' } } }];
  const sm = await listen((q, s) => json(s, 200, spools()));
  const ss = await listen(async (q, s) => {
    if (q.url === '/api/printers') return json(s, 200, { printers: [{ name: 'X2D', ams_units: [{ name: 'AMS 1', trays: [
      { entity_id: TRAY, unique_id: 'uid1', tray_number: 1, name: world.assigned ? 'Sunlu PLA' : '', color: '#161616FF', ...(world.assigned ? { assigned_spool: { id: 5 } } : {}) },
      { entity_id: 'sensor.t2', unique_id: 'uid2', tray_number: 2, name: 'Bambu PLA Matte', color: '#0078BFFF' }] }], external_spools: [] }] });
    if (q.url === '/api/spools') { const b = await body(q); world.assigns.push(b); world.assigned = b.trayId; return json(s, 200, {}); }
    json(s, 404, {});
  });
  const ha = await listen((q, s) => { const id = q.url.replace('/states/', ''); if (q.method === 'GET') return world.ha[id] ? json(s, 200, world.ha[id]) : json(s, 200, { state: 'Empty', attributes: { empty: true } }); q.resume(); json(s, 200, {}); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanbrowser-'));
  const store = new Store(path.join(dir, 'state.json')); await store.load();
  const bridge = new Bridge({ store });
  bridge.ha = new HaPublisher({ baseUrl: `http://127.0.0.1:${ha.address().port}`, token: 't' });
  store.state.settings.spoolmanUrl = `http://127.0.0.1:${sm.address().port}`;
  store.state.settings.spoolmansyncUrl = `http://127.0.0.1:${ss.address().port}`;
  bridge.watchPending(500);
  const lan = createLanApp({ bridge }); await new Promise((r) => lan.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${lan.address().port}/scan/spool/5`;

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 400, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#trays button').length === 2);
  const spoolText = await page.textContent('#spool');
  assert.match(spoolText, /Rol #5 SUNLU PLA C220 Zwart/); assert.match(spoolText, /912 g over/);
  await page.screenshot({ path: path.join(dir, 'scan-1-kiezen.png') });
  console.log('SCANTEST A OK: pagina toont rol en beide trays');

  await page.click('#trays .card:nth-of-type(1) button.primary');
  await page.waitForFunction(() => /Wacht op de rol/.test(document.getElementById('status').textContent));
  assert.equal(world.assigns.length, 0, 'direct na kiezen nog niet gekoppeld');
  await page.screenshot({ path: path.join(dir, 'scan-2-wachten.png') });
  console.log('SCANTEST B OK: na kiezen staat er "wacht op de rol" en is er nog niets gekoppeld');

  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(world.assigns.length, 0, 'tray is nog leeg: niet koppelen');
  world.ha[TRAY] = { state: 'Sunlu PLA', attributes: { empty: false } };
  await page.waitForFunction(() => /Rol gezien/.test(document.getElementById('status').textContent), null, { timeout: 8000 });
  assert.equal(world.assigns.length, 0, 'rol net gezien: nog niet koppelen');
  console.log('SCANTEST C OK: rol gezien, eerst even wachten');

  await page.waitForFunction(() => /Gekoppeld aan X2D AMS 1 Tray 1/.test(document.getElementById('status').textContent), null, { timeout: 20000 });
  assert.deepEqual(world.assigns, [{ spoolId: 5, trayId: 'uid1' }]);
  await page.screenshot({ path: path.join(dir, 'scan-3-gekoppeld.png') });
  console.log('SCANTEST D OK: gekoppeld na 8 s onafgebroken in de tray');

  assert.deepEqual(errors, [], 'geen fouten in de browserconsole');
  console.log('screenshots in', dir);
  await browser.close(); lan.close(); sm.close(); ss.close(); ha.close(); bridge.pendingTimer && clearInterval(bridge.pendingTimer);
})().catch((e) => { console.error('SCANTEST MISLUKT:', e); process.exit(1); });
