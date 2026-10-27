// Browsertest van de printknop in de rolscanner (Chromium via Playwright). Draaien met: node tests/browser/printen.browser.cjs
// Gebruikt de echte niimbluelib voor het coderen van het label en een nagebootste printer voor de Bluetooth-verbinding.
// Dit is GEEN test met een echte D101: die is niet beschikbaar in de testomgeving.
const { chromium } = require('playwright');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAeACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxWiiigAooooAKKKKACiiigAooooAKKKKAP//Z';
(async () => {
  const { createScanner } = await import(require('node:path').resolve(__dirname, '../../rolscanner/rolscanner.mjs'));
  const types = [{ key: 'c190', label: 'SUNLU PLA C190', brand: 'Sunlu', material: 'PLA', product: 'PLA C190', nozzle: 190, bed: null, profile: { id: 'P71db9ac' } }];
  const bridge = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c; res.setHeader('content-type', 'application/json');
    if (req.url === '/api/quick-add') { const body = JSON.parse(b); return setTimeout(() => res.end(JSON.stringify({ spoolId: 12, name: 'Sunlu ' + body.name, weight: body.weight, location: body.location })), 400); }
    res.end(JSON.stringify({ brands: ['Sunlu'], filaments: [], locations: ['Vincent', 'Ine'], types }));
  });
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  const sc = createScanner({ bridgeUrl: 'http://127.0.0.1:' + bridge.address().port, token: 't', labelBaseUrl: 'http://homeassistant.local:3005' },
    { read: async () => ({ fields: { brand: 'Sunlu', material: 'PLA', name: 'PLA C190 Zwart', colorHex: '161616', colorName: 'Zwart', netWeight: 1000 }, check: [] }) });
  await new Promise((r) => sc.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + sc.address().port;
  const browser = await chromium.launch();
  const mk = async (withBt = true) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 1600 } });
    const page = await ctx.newPage();
    if (withBt) await page.addInitScript(() => { if (!navigator.bluetooth) Object.defineProperty(navigator, 'bluetooth', { value: {} }); });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url); await page.waitForFunction(() => document.querySelectorAll('#type option').length === 2);
    return { page, errors };
  };
  const FAKE = () => {
    window.__log = [];
    const real = window.niimbluelib;
    class Fake {
      constructor() { this.ok = false; }
      on() {}
      isConnected() { return this.ok; }
      async connect() { window.__log.push(['connect', Date.now()]); if (window.__failConnect) { window.__failConnect = false; throw new Error('Gebruiker annuleerde'); } await new Promise((r) => setTimeout(r, 50)); this.ok = true; return { deviceName: 'D101-TEST' }; }
      getModelMetadata() { return { model: 'D101', printDirection: 'left', densityDefault: 2 }; }
      getPrintTaskType() { return 'B1'; }
      get protocol() { const log = window.__log; return {
        newPrintTask(name, opts) { log.push(['newPrintTask', name, opts]); return {
          async printInit() { log.push(['printInit']); },
          async printPage(enc, q) { log.push(['printPage', enc.cols, enc.rows, q, enc.rowsData.length]); if (window.__failPage) { window.__failPage = false; throw new Error('Papier op'); } },
          async waitForPageFinished() { log.push(['waitForPageFinished']); }, async waitForFinished() { log.push(['waitForFinished']); } }; },
        async printEnd() { log.push(['printEnd']); return true; } }; }
    }
    window.niimbluelib = Object.assign({}, real, { NiimbotBluetoothClient: Fake });
  };
  const fillAndSave = async (page) => {
    await page.selectOption('#loc', 'Ine'); await page.selectOption('#type', 'c190');
    await page.setInputFiles('#photo', { name: 'label.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(JPG, 'base64') }); await page.waitForFunction(() => document.querySelector('#name').value !== '');
    await page.fill('#weight', '111');
  };

  // A. Echte bibliotheek: label tekenen en coderen; QR blijft leesbaar na zwart/wit-drempel
  {
    const { page, errors } = await mk();
    const r = await page.evaluate(() => {
      const cv = document.createElement('canvas');
      const info = drawLabel(cv, { id: 12, url: 'http://homeassistant.local:3005/scan/spool/12', name: 'Sunlu PLA C190 Zwart', weight: 111, location: 'Ine' });
      const enc = niimbluelib.ImageEncoder.encodeCanvas(cv, niimbluelib.PageColorType.SingleColor, 'left');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; const odd = [];
      for (let i = 0; i < d.length; i += 4) { if (d[i] !== 0 && d[i] !== 255) { odd.push(d[i]); break; } }
      return { w: cv.width, h: cv.height, info, cols: enc.cols, rows: enc.rows, rowsData: enc.rowsData.length, grijs: odd.length, png: cv.toDataURL('image/png'), tasks: niimbluelib.printTaskNames };
    });
    console.log('A:', JSON.stringify({ ...r, png: undefined }));
    assert.equal(r.w, 240); assert.equal(r.h, 160); assert.equal(r.cols, 160); assert.equal(r.rows, 240); assert.equal(r.grijs, 0);
    assert.equal(r.info.moduleDots, 3); assert.ok(r.tasks.includes('B1') && r.tasks.includes('D110M_V4'));
    fs.writeFileSync('/tmp/label-30x20.png', Buffer.from(r.png.split(',')[1], 'base64'));
    assert.deepEqual(errors, []);
    // andere maat 25 x 24: breedte is gemaximeerd op 192
    const r2 = await page.evaluate(() => { $('lenmm').value = 25; $('widmm').value = 30; const cv = document.createElement('canvas'); drawLabel(cv, { id: 1, url: 'http://homeassistant.local:3005/scan/spool/1', name: 'X', weight: 1, location: '' }); return [cv.width, cv.height]; });
    assert.deepEqual(r2, [200, 192]);
    await page.close();
  }

  // B. Volgorde: verbinden start in de tik, vóór de opslag klaar is; daarna afdrukken met de juiste stappen
  {
    const { page, errors } = await mk(); await page.evaluate(FAKE);
    await fillAndSave(page);
    const t0 = await page.evaluate(() => Date.now());
    await page.click('#save'); await page.waitForFunction(() => document.querySelector('#btStatus').textContent.startsWith('Afgedrukt'));
    const log = await page.evaluate(() => window.__log);
    const names = log.map((l) => l[0]);
    assert.deepEqual(names, ['connect', 'newPrintTask', 'printInit', 'printPage', 'waitForPageFinished', 'waitForFinished', 'printEnd']);
    assert.ok(log[0][1] - t0 < 300, 'verbinden moet direct bij de tik beginnen (voor de opslag van 400 ms klaar is)');
    assert.deepEqual(log[1].slice(1), ['B1', { totalPages: 1, density: 2, labelType: 1 }]);
    assert.deepEqual(log[3].slice(1, 4), [160, 240, 1]);
    assert.match(await page.textContent('#btStatus'), /#12/);
    assert.equal(await page.isHidden('#btPrint'), false);
    await page.screenshot({ path: '/tmp/pagina-printer.png', fullPage: true });
    // tweede rol: al verbonden, geen nieuwe connect nodig; dichtheid en print task uit instellingen
    await page.evaluate(() => { $('density').value = '3'; $('density').dispatchEvent(new Event('change')); $('ptask').value = 'D110M_V4'; $('ptask').dispatchEvent(new Event('change')); window.__log.length = 0; });
    await fillAndSave(page); await page.click('#save'); await page.waitForFunction(() => window.__log.some((l) => l[0] === 'printEnd'));
    const log2 = await page.evaluate(() => window.__log);
    assert.equal(log2.filter((l) => l[0] === 'connect').length, 0); // al verbonden: geen nieuw keuzemenu
    assert.deepEqual(log2.find((l) => l[0] === 'newPrintTask').slice(1), ['D110M_V4', { totalPages: 1, density: 3, labelType: 1 }]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  // C. Verbinden geannuleerd: rol is toch opgeslagen, duidelijke melding, herprinten werkt daarna
  {
    const { page, errors } = await mk(); await page.evaluate(FAKE); await page.evaluate(() => { window.__failConnect = true; });
    await fillAndSave(page); await page.click('#save'); await page.waitForSelector('#labelSec:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('niet verbonden'));
    assert.match(await page.textContent('#msg'), /Opgeslagen als Spoolman #12/);
    assert.match(await page.textContent('#btStatus'), /annuleerde/);
    assert.equal(await page.isHidden('#btPrint'), false);
    await page.click('#btPrint'); await page.waitForFunction(() => document.querySelector('#btStatus').textContent.startsWith('Afgedrukt'));
    assert.deepEqual((await page.evaluate(() => window.__log)).map((l) => l[0]), ['connect', 'connect', 'newPrintTask', 'printInit', 'printPage', 'waitForPageFinished', 'waitForFinished', 'printEnd']);
    assert.deepEqual(errors, []); await page.close();
  }
  // D. Afdrukfout: wordt gemeld, printEnd loopt toch, herprinten kan
  {
    const { page, errors } = await mk(); await page.evaluate(FAKE); await page.evaluate(() => { window.__failPage = true; });
    await fillAndSave(page); await page.click('#save'); await page.waitForFunction(() => document.querySelector('#btStatus').textContent.startsWith('Afdrukken mislukt'));
    assert.match(await page.textContent('#btStatus'), /Papier op/);
    assert.ok((await page.evaluate(() => window.__log)).some((l) => l[0] === 'printEnd'));
    await page.click('#btPrint'); await page.waitForFunction(() => document.querySelector('#btStatus').textContent.startsWith('Afgedrukt'));
    assert.deepEqual(errors, []); await page.close();
  }
  // E. Testlabel en uitgeschakelde automatische afdruk
  {
    const { page } = await mk(); await page.evaluate(FAKE);
    await page.click('#btTest'); await page.waitForFunction(() => document.querySelector('#btStatus').textContent.startsWith('Afgedrukt: #0'));
    await page.evaluate(() => { window.__log.length = 0; }); await page.uncheck('#autoPrint');
    await fillAndSave(page); await page.click('#save'); await page.waitForSelector('#labelSec:not([hidden])'); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => window.__log), []); // niets afgedrukt zonder automatische afdruk
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#type option').length === 2);
    assert.equal(await page.isChecked('#autoPrint'), false); // keuze onthouden
    await page.close();
  }
  // F. Onveilig adres (geen secure context): duidelijke uitleg met het adres, rest werkt gewoon
  {
    const os = require('node:os');
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!lan) { console.log('F overgeslagen: geen netwerkadres in deze omgeving'); }
    else {
      const sc2 = createScanner({ bridgeUrl: 'http://127.0.0.1:' + bridge.address().port, token: 't', labelBaseUrl: 'http://homeassistant.local:3005' }, { read: async () => ({ fields: {}, check: [] }) });
      await new Promise((r) => sc2.listen(0, '0.0.0.0', r));
      const u2 = 'http://' + lan.address + ':' + sc2.address().port;
      const page = await (await browser.newContext()).newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(u2); await page.waitForFunction(() => document.querySelectorAll('#type option').length === 2);
      assert.equal(await page.evaluate(() => window.isSecureContext), false);
      assert.equal(await page.isHidden('#btControls'), true);
      const hint = await page.textContent('#btHint');
      assert.match(hint, /Insecure origins treated as secure/); assert.ok(hint.includes(u2), hint);
      await page.selectOption('#loc', 'Ine'); assert.equal(await page.inputValue('#loc'), 'Ine'); // de rest van de pagina werkt
      assert.deepEqual(errors, []); await page.close(); sc2.close();
    }
  }
  console.log('PRINTTEST A-F OK');
  await browser.close(); sc.close(); bridge.close();
})().catch((e) => { console.error('PRINTTEST FOUT', e); process.exit(1); });
