// Rolscanner: foto van een filamentlabel -> Codex leest merk/kleur -> jij controleert -> rol in Spoolman (via de bridge).
// Draait op je eigen pc met Node 20+ en de Codex CLI. Geen npm-afhankelijkheden.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGE } from './page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['brand', 'material', 'product', 'colorName', 'colorHex', 'netWeight', 'unsure'],
  properties: {
    brand: { type: 'string' }, material: { type: 'string' }, product: { type: 'string' },
    colorName: { type: 'string' }, colorHex: { type: 'string' },
    netWeight: { type: ['number', 'null'] },
    unsure: { type: 'array', items: { type: 'string', enum: ['brand', 'material', 'product', 'colorName', 'colorHex', 'netWeight'] } },
  },
};

export const PROMPT = `Je ziet een foto van het label van een rol 3D-printfilament.
Lees af wat er echt op staat:
- brand: merk (bijv. Sunlu, Bambu Lab, eSun)
- material: materiaal (PLA, PETG, ABS, ASA, TPU, ...)
- product: productnaam of serie zonder merk en kleur (bijv. "PLA C220", "Matte", "Silk")
- colorName: de kleur in het Nederlands (bijv. Zwart, Wit, Donkergroen)
- colorHex: schat de kleur als #RRGGBB, bij voorkeur van het kleurvlak of de tekst op het label
- netWeight: nettogewicht in gram als dat op het label staat, anders null
Verzin niets. Is iets onleesbaar of een gok, zet dan een lege tekst (of null) en noem het veld in "unsure".
Zet ook velden in "unsure" waarvan je het niet zeker weet, zoals een geschatte kleurcode.
Antwoord alleen met JSON volgens het schema.`;

const HEX = /^#?([0-9a-f]{6})$/i;

// Maakt van het Codex-antwoord veilige, vaste velden.
export function sanitize(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '');
  const m = HEX.exec(str(raw?.colorHex));
  const unsure = new Set(Array.isArray(raw?.unsure) ? raw.unsure.filter((x) => typeof x === 'string') : []);
  const fields = {
    brand: str(raw?.brand), material: str(raw?.material).toUpperCase(), name: [str(raw?.product), str(raw?.colorName)].filter(Boolean).join(' '),
    colorHex: m ? m[1].toUpperCase() : '', netWeight: Number.isFinite(raw?.netWeight) ? raw.netWeight : null,
    colorName: str(raw?.colorName), // los doorgegeven: bij een vast type wordt de naam "<type> <kleur>"
  };
  // Elk veld dat leeg is of niet klopt, moet jij controleren.
  const map = { brand: 'brand', material: 'material', name: 'product', colorHex: 'colorHex' };
  const check = new Set();
  for (const [k, from] of Object.entries(map)) if (!fields[k] || unsure.has(from) || (k === 'name' && unsure.has('colorName'))) check.add(k);
  if (unsure.has('colorHex')) check.add('colorHex');
  return { fields, check: [...check] };
}

function pickJson(text) {
  try { return JSON.parse(text); } catch { /* val terug op eerste {...} */ }
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error('Codex gaf geen JSON terug');
}

const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

// Roept de Codex CLI aan met de foto. Het prompt gaat via stdin zodat -i het niet als bestand opvat.
export function runCodex({ bin = 'codex', extraArgs = [], imagePath, schemaPath, outPath, timeoutMs = 120000, cwd }) {
  return new Promise((resolve, reject) => {
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', schemaPath, '-o', outPath, '-i', imagePath, ...extraArgs, '-'];
    const win = process.platform === 'win32';
    const child = spawn(win ? quote(bin) : bin, win ? args.map(quote) : args, { shell: win, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Codex duurde te lang (timeout)')); }, timeoutMs);
    child.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `Codex CLI niet gevonden (${bin}). Installeer Codex of zet "codexBin" in de config.` : e.message)); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Codex stopte met code ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`)); });
    child.stdin.end(PROMPT);
  });
}

export async function readLabel(imageBuffer, ext, cfg) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rolscanner-'));
  try {
    const imagePath = path.join(dir, `foto.${ext}`); const schemaPath = path.join(dir, 'schema.json'); const outPath = path.join(dir, 'antwoord.txt');
    await fs.writeFile(imagePath, imageBuffer); await fs.writeFile(schemaPath, JSON.stringify(SCHEMA));
    await runCodex({ bin: cfg.codexBin, extraArgs: cfg.codexArgs, imagePath, schemaPath, outPath, timeoutMs: (cfg.timeoutSec || 120) * 1000, cwd: dir });
    return sanitize(pickJson(await fs.readFile(outPath, 'utf8')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

async function bridge(cfg, method, p, body, fetchImpl = fetch) {
  if (!cfg.bridgeUrl || !cfg.token) throw Object.assign(new Error('bridgeUrl en token ontbreken in rolscanner.config.json'), { status: 500 });
  let res;
  try {
    res = await fetchImpl(`${cfg.bridgeUrl.replace(/\/+$/, '')}${p}`, {
      method, headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
  } catch (e) { throw Object.assign(new Error(`Bridge niet bereikbaar: ${e.message}`), { status: 502 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Bridge gaf ${res.status}`), { status: res.status === 401 ? 502 : res.status });
  return data;
}

export function createScanner(cfg, { fetchImpl = fetch, read = readLabel } = {}) {
  let busy = false;
  return http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (req.method === 'GET' && p === '/') return send(200, PAGE, 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/vendor/niimbluelib.min.js') {
        try { return send(200, await fs.readFile(path.join(here, 'vendor', 'niimbluelib.min.js')), 'text/javascript; charset=utf-8'); }
        catch { return send(404, { error: 'niimbluelib ontbreekt in rolscanner/vendor' }); }
      }
      if (req.method === 'GET' && p === '/api/info') return send(200, { labelBaseUrl: String(cfg.labelBaseUrl || '').replace(/\/+$/, '') });
      if (req.method === 'GET' && p === '/api/catalog') return send(200, await bridge(cfg, 'GET', '/api/quick-add/catalog', null, fetchImpl));
      const readBody = async (limit) => {
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('Te groot'), { status: 413 }); chunks.push(c); }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Ongeldige JSON'), { status: 400 }); }
      };
      if (req.method === 'POST' && p === '/api/read') {
        const body = await readBody(15e6);
        const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(body.image || ''));
        if (!m) throw Object.assign(new Error('Geen geldige afbeelding'), { status: 400 });
        if (busy) throw Object.assign(new Error('Er wordt al een foto gelezen'), { status: 429 });
        busy = true;
        try { return send(200, await read(Buffer.from(m[2], 'base64'), m[1] === 'jpeg' ? 'jpg' : m[1], cfg)); } finally { busy = false; }
      }
      if (req.method === 'POST' && p === '/api/save') {
        const b = await readBody(20000);
        // Alleen deze velden gaan door naar de bridge; de bridge valideert opnieuw.
        const out = await bridge(cfg, 'POST', '/api/quick-add', { brand: b.brand, material: b.material, name: b.name, colorHex: b.colorHex, weight: b.weight, nozzle: b.nozzle, bed: b.bed, location: b.location, typeKey: b.typeKey, comment: 'Toegevoegd via rolscanner' }, fetchImpl);
        return send(200, out);
      }
      send(404, { error: 'Onbekend endpoint' });
    } catch (e) { send(e.status || 500, { error: e.message }); }
  });
}

export async function loadConfig(file = path.join(here, 'rolscanner.config.json')) {
  let cfg = {};
  try { cfg = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, '')); } // Kladblok en PowerShell zetten soms een BOM voor het bestand catch (e) { if (e.code !== 'ENOENT') throw new Error(`Config onleesbaar: ${e.message}`); }
  return {
    port: 8787, host: '127.0.0.1', codexBin: 'codex', codexArgs: [], timeoutSec: 120,
    labelBaseUrl: 'http://homeassistant.local:3005', // waar de QR-code van een rol naartoe wijst (SpoolmanSync, poort 3005)
    ...cfg,
    bridgeUrl: process.env.ROLSCANNER_BRIDGE_URL || cfg.bridgeUrl || '', token: process.env.ROLSCANNER_TOKEN || cfg.token || '',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = await loadConfig();
  if (!cfg.bridgeUrl || !cfg.token) console.warn('Let op: zet bridgeUrl en token in rolscanner.config.json (zie rolscanner.config.example.json).');
  createScanner(cfg).listen(cfg.port, cfg.host, () => console.log(`Rolscanner: open http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`));
}
