import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, Bridge, HttpError } from './core.mjs';
import { analyzeGcode, summarize, proposeAbort } from './usage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const INGRESS_IP = '172.30.32.2'; // Supervisor-ingress; overige bronnen worden geweigerd in add-on-modus

export function createApp({ bridge, ingressOnly = false, publicDir = path.join(here, 'public') }) {
  return http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    try {
      const remote = (req.socket.remoteAddress || '').replace('::ffff:', '');
      if (ingressOnly && remote !== INGRESS_IP && req.url !== '/health') return send(403, { error: 'Alleen via Home Assistant Ingress' });
      const url = new URL(req.url, 'http://x');
      let p = url.pathname.replace(/\/{2,}/g, '/');
      if (p === '/health') return send(200, { ok: true });
      if (p.startsWith('/api/')) {
        let body = {};
        if (req.method !== 'GET') {
          const chunks = []; let size = 0;
          for await (const c of req) { size += c.length; if (size > 50e6) throw new HttpError('Bestand te groot', 413); chunks.push(c); }
          const raw = Buffer.concat(chunks).toString('utf8');
          if (raw) { try { body = JSON.parse(raw); } catch { throw new HttpError('Ongeldige JSON', 400); } }
        }
        const route = `${req.method} ${p}`;
        if (route === 'GET /api/status') return send(200, bridge.status());
        if (route === 'POST /api/settings') { await bridge.updateSettings(body); return send(200, bridge.status()); }
        if (route === 'POST /api/bambu/login') return send(200, await bridge.login(body.email, body.password));
        if (route === 'POST /api/bambu/verify') return send(200, await bridge.verify(String(body.code || '')));
        if (route === 'POST /api/bambu/logout') { await bridge.logout(); return send(200, { ok: true }); }
        if (route === 'GET /api/spoolman') return send(200, await bridge.spoolmanCheck());
        if (route === 'GET /api/overview') return send(200, await bridge.overview());
        if (route === 'POST /api/links') return send(200, await bridge.addLink(body.spoolmanId, body.bambuId));
        if (route === 'POST /api/links/create-bambu') return send(200, await bridge.createBambuFor(body.spoolmanId));
        if (req.method === 'DELETE' && p.startsWith('/api/links/')) { await bridge.removeLink(p.slice(11)); return send(200, { ok: true }); }
        if (route === 'POST /api/sync') return send(200, await bridge.syncOnce('handmatig'));
        // Voorstel uit G-code; boekt niets af.
        if (route === 'POST /api/estimate') {
          const a = analyzeGcode(String(body.gcode || ''));
          const out = body.lastConfirmedLayer != null
            ? proposeAbort(a, Number(body.lastConfirmedLayer), body.materials, body.diameter)
            : { kind: 'plan-uit-gcode', filaments: summarize(a, body.materials, body.diameter), totalLayers: a.totalLayers };
          return send(200, out);
        }
        return send(404, { error: 'Onbekend endpoint' });
      }
      if (p === '/') p = '/index.html';
      const file = path.join(publicDir, path.normalize(p));
      if (!file.startsWith(publicDir)) return send(403, { error: 'Verboden' });
      try { return send(200, await fs.readFile(file), TYPES[path.extname(file)] || 'application/octet-stream'); }
      catch { return send(404, { error: 'Niet gevonden' }); }
    } catch (e) {
      const status = e instanceof HttpError && e.status >= 400 && e.status < 600 ? e.status : 500;
      send(status, { error: e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.DATA_DIR || '/data';
  const store = new Store(path.join(dataDir, 'state.json'));
  await store.load();
  const bridge = new Bridge({ store });
  bridge.schedule();
  const port = Number(process.env.PORT || 8099);
  createApp({ bridge, ingressOnly: process.env.INGRESS_ONLY === '1' }).listen(port, () => console.log(`Spoolman Bambu Bridge luistert op ${port}`));
}
