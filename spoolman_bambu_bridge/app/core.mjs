// Spoolman Bambu Bridge - kern: opslag, Spoolman-client, Bambu-client, synchronisatie.
// Geen externe afhankelijkheden. De Bambu-cloud-API is niet openbaar gedocumenteerd;
// alle Bambu-specifieke endpoints staan daarom in BambuClient.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HaPublisher, buildStates, STATUS_ID } from './publish.mjs';
import { fetchUsageLogs, ingest, historyState } from './history.mjs';
import { quickAdd, catalog } from './quickadd.mjs';
import { listProfiles, deriveProfiles, matchProfile } from './profiles.mjs';
import { evaluate, trayLoaded, fetchTrays, assignViaSpoolmanSync } from './trays.mjs';
import { rfidTrays, normalizeTag, addRfidSpool, assignTrays } from './rfid.mjs';

export const VERSION = '0.10.1';
export const RFID_INTERVAL = 60;
const PENDING_ID = 'sensor.spoolman_tray_koppelingen';
const PHASE_TEXT = { 'wacht-op-rol': 'wacht op de rol', 'oude-rol-eruit': 'haal eerst de oude rol uit de tray', 'rol-gezien': 'rol gezien, even wachten', onbekend: 'status van de tray onbekend' };
const trayLoadedOf = (st) => (st && st.state !== undefined ? trayLoaded(st) : null);
export const MIN_INTERVAL = 30;
export const MAX_INTERVAL = 3600;
export const DEFAULT_INTERVAL = 60;
const MAX_ACTIVITY = 100;

const BAMBU_HOSTS = {
  us: 'https://api.bambulab.com',
  eu: 'https://api.bambulab.com',
  cn: 'https://api.bambulab.cn',
};

export class HttpError extends Error {
  constructor(message, status, { uncertain = false } = {}) {
    super(message);
    this.status = status;
    this.uncertain = uncertain; // true: onbekend of de server het verzoek heeft verwerkt
  }
}

async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new HttpError(`Netwerkfout: ${e.message}`, 0, { uncertain: true });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new HttpError(String(msg), res.status, { uncertain: res.status >= 500 });
  }
  return data;
}

// ---------- Opslag ----------

// Vaste rol-typen voor de rolscanner, gekoppeld aan jouw eigen Bambu-profielen (filament_id uit je account, 2026-10-27).
// nozzle = standaard nozzletemperatuur die de rolscanner invult (aanpasbaar per rol); bed blijft leeg tot je hem opgeeft.
export const DEFAULT_ROL_TYPES = () => [
  { key: 'c190', label: 'SUNLU PLA C190', brand: 'Sunlu', material: 'PLA', product: 'PLA C190', nozzle: 190, bed: null, profile: { vendor: 'SUNLU', type: 'PLA', name: 'PLA C190', id: 'P71db9ac' } },
  { key: 'c210', label: 'SUNLU PLA C210', brand: 'Sunlu', material: 'PLA', product: 'PLA C210', nozzle: 210, bed: null, profile: { vendor: 'SUNLU', type: 'PLA', name: 'PLA C210', id: 'Paed3d28' } },
  { key: 'c220', label: 'SUNLU PLA C220', brand: 'Sunlu', material: 'PLA', product: 'PLA C220', nozzle: 220, bed: null, profile: { vendor: 'SUNLU', type: 'PLA', name: 'PLA C220', id: 'P9877e1f' } },
  { key: 'petg', label: 'SUNLU PETG Basic', brand: 'Sunlu', material: 'PETG', product: 'PETG Basic', nozzle: null, bed: null, profile: { vendor: 'SUNLU', type: 'PETG', name: 'PETG Basic', id: 'P05a4964' } },
];

function validateRolTypes(list) {
  if (!Array.isArray(list) || list.length > 30) throw new HttpError('rolTypes moet een lijst van maximaal 30 typen zijn', 400);
  const keys = new Set();
  return list.map((t) => {
    const s = (v) => String(v ?? '').trim();
    const k = s(t.key).toLowerCase();
    if (!/^[a-z0-9_-]{1,20}$/.test(k) || keys.has(k)) throw new HttpError(`Ongeldige of dubbele sleutel: ${k || '(leeg)'}`, 400);
    keys.add(k);
    const p = t.profile || {};
    if (!s(t.label) || !s(t.brand) || !s(t.material) || !s(t.product) || !s(p.id) || !s(p.vendor) || !s(p.name)) throw new HttpError(`Type ${k}: label, merk, materiaal, product en profiel (id, vendor, name) zijn verplicht`, 400);
    const num = (v) => (v === null || v === '' || v === undefined ? null : Math.round(Number(v)));
    return { key: k, label: s(t.label), brand: s(t.brand), material: s(t.material).toUpperCase(), product: s(t.product), nozzle: num(t.nozzle), bed: num(t.bed),
      profile: { vendor: s(p.vendor), type: s(p.type || t.material).toUpperCase(), name: s(p.name), id: s(p.id) } };
  });
}

const EMPTY_STATE = () => ({
  version: 1,
  settings: { spoolmanUrl: '', intervalSeconds: DEFAULT_INTERVAL, autoSync: false, autoCreate: false, rfidAutoAdd: true, chipLeader: 'spoolman', lowStockGrams: 100, spoolmansyncUrl: '', printerPrefix: '', region: 'us',
    locations: ['Vincent', 'Ine'], rolTypes: DEFAULT_ROL_TYPES() },
  profileOverrides: {}, // spoolmanId -> Bambu-profiel dat bij het toevoegen met een vast type is gekozen
  bambu: { token: '', email: '', status: 'disconnected' },
  links: [], // { id, spoolmanId, bambuId, paused, pauseReason, lastSyncedGrams, lastSyncAt, lastError, createdAt }
  pendingCreates: [], // { spoolmanId, marker, startedAt }
  history: { prints: [], seen: [] },
  pendingAssigns: [], // { spoolId, trayId, entityId, label, createdAt, baseLoaded, baseUuid, armed, loadedSince, phase, lastError }
  lastAssigned: null, // { spoolId, label, at }
  activity: [],
});

export class Store {
  constructor(file) { this.file = file; this.state = EMPTY_STATE(); }
  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const base = EMPTY_STATE();
      this.state = { ...base, ...raw, settings: { ...base.settings, ...raw.settings }, bambu: { ...base.bambu, ...raw.bambu } };
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`state.json onleesbaar (${e.message}); herstel uit back-up`);
    }
    return this.state;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
  log(level, message) {
    this.state.activity.unshift({ at: new Date().toISOString(), level, message });
    this.state.activity.length = Math.min(this.state.activity.length, MAX_ACTIVITY);
  }
}

// ---------- Spoolman ----------

export class SpoolmanClient {
  constructor(baseUrl, fetchImpl = fetch) { this.base = baseUrl.replace(/\/+$/, ''); this.fetchImpl = fetchImpl; }
  async listSpools() {
    const data = await request(`${this.base}/api/v1/spool?allow_archived=true`, { fetchImpl: this.fetchImpl });
    return (data || []).map(normalizeSpoolmanSpool);
  }
  async listVendors() { return request(`${this.base}/api/v1/vendor`, { fetchImpl: this.fetchImpl }); }
  async listFilaments() { return request(`${this.base}/api/v1/filament`, { fetchImpl: this.fetchImpl }); }
  async createVendor(b) { return request(`${this.base}/api/v1/vendor`, { method: 'POST', body: b, fetchImpl: this.fetchImpl }); }
  async createFilament(b) { return request(`${this.base}/api/v1/filament`, { method: 'POST', body: b, fetchImpl: this.fetchImpl }); }
  async createSpool(b) { return request(`${this.base}/api/v1/spool`, { method: 'POST', body: b, fetchImpl: this.fetchImpl }); }
  async ping() { await request(`${this.base}/api/v1/health`, { fetchImpl: this.fetchImpl }); }
  async getSpool(id) { return request(`${this.base}/api/v1/spool/${id}`, { fetchImpl: this.fetchImpl }); }
  async patchSpool(id, b) { return request(`${this.base}/api/v1/spool/${id}`, { method: 'PATCH', body: b, fetchImpl: this.fetchImpl }); }
  // Zorgt dat een extra tekstveld voor rollen bestaat (bijv. "tag"); bestaat het al, dan verandert er niets.
  async ensureSpoolField(key, name) {
    const fields = await request(`${this.base}/api/v1/field/spool`, { fetchImpl: this.fetchImpl });
    if ((fields || []).some((f) => f.key === key)) return false;
    await request(`${this.base}/api/v1/field/spool/${key}`, { method: 'POST', body: { name, field_type: 'text' }, fetchImpl: this.fetchImpl });
    return true;
  }
}

function parseExtra(v) {
  if (typeof v !== 'string' || !v) return '';
  try { const x = JSON.parse(v); return typeof x === 'string' ? x : ''; } catch { return v; }
}

export function normalizeSpoolmanSpool(s) {
  const f = s.filament || {};
  const remaining = typeof s.remaining_weight === 'number' ? s.remaining_weight : null; // null = onbekend, niet 0
  return {
    id: s.id,
    archived: !!s.archived,
    brand: f.vendor?.name || '',
    material: f.material || '',
    name: f.name || '',
    colorHex: (f.color_hex || '').replace('#', '').toUpperCase(),
    initialWeight: s.initial_weight ?? f.weight ?? null,
    remainingWeight: remaining,
    location: s.location || '',
    rfid: s.extra?.rfid || s.extra?.tag || '',
    tray: parseExtra(s.extra?.active_tray), // door SpoolmanSync gevuld (JSON-tekst in Spoolman)
  };
}

// ---------- Bambu (niet-openbare API, afzonderlijk onderhoudbaar) ----------

export class BambuClient {
  constructor({ token = '', region = 'us', fetchImpl = fetch } = {}) {
    this.token = token; this.region = region; this.fetchImpl = fetchImpl;
    this.host = BAMBU_HOSTS[region] || BAMBU_HOSTS.us;
  }
  get auth() { return { authorization: `Bearer ${this.token}` }; }
  async login(email, password) {
    const r = await request(`${this.host}/v1/user-service/user/login`, { method: 'POST', body: { account: email, password }, fetchImpl: this.fetchImpl });
    if (r?.loginType === 'verifyCode') {
      await request(`${this.host}/v1/user-service/user/sendemail/code`, { method: 'POST', body: { email, type: 'codeLogin' }, fetchImpl: this.fetchImpl }).catch(() => {});
      return { needs: 'email' };
    }
    if (r?.loginType === 'tfa') return { needs: 'tfa', tfaKey: r.tfaKey };
    if (!r?.accessToken) throw new HttpError('Inloggen mislukt: geen token ontvangen', 400);
    this.token = r.accessToken;
    return { token: this.token };
  }
  async verify({ email, password, code, tfaKey }) {
    let r;
    if (tfaKey) {
      r = await request(`${this.host}/v1/user-service/user/tfa/login`, { method: 'POST', body: { tfaKey, tfaCode: code }, fetchImpl: this.fetchImpl });
    } else {
      r = await request(`${this.host}/v1/user-service/user/login`, { method: 'POST', body: { account: email, password, code, loginType: 'verifyCode' }, fetchImpl: this.fetchImpl });
    }
    const token = r?.accessToken || r?.token;
    if (!token) throw new HttpError('Verificatie mislukt: geen token ontvangen', 400);
    this.token = token;
    return { token };
  }
  get filamentBase() { return `${this.host}/v1/design-user-service/my/filament/v2`; }
  async listFilaments() {
    const all = []; let offset = 0;
    for (;;) {
      const d = await request(`${this.filamentBase}?offset=${offset}&limit=50`, { headers: this.auth, fetchImpl: this.fetchImpl });
      const hits = d?.hits || d?.data?.hits || [];
      all.push(...hits);
      const total = Number(d?.total ?? d?.data?.total ?? 0);
      offset += hits.length;
      if (!hits.length || offset >= total) break;
    }
    return all;
  }
  // Openbare profielenbibliotheek van Bambu (zelfde lijst als de keuze bij "Type" in Handy). Geen inlog nodig.
  async filamentConfig() {
    return request(`${this.host}/v1/design-user-service/filament/config`, { headers: this.token ? this.auth : {}, fetchImpl: this.fetchImpl, timeoutMs: 30000 });
  }
  // Eigen filamentprofielen uit je Bambu-account (zoals in Studio onder "Aangepaste filamenten"). Niet-openbaar endpoint.
  async slicerSettings() {
    return request(`${this.host}/v1/iot-service/api/slicer/setting?version=2.0.0.0`, { headers: this.auth, fetchImpl: this.fetchImpl, timeoutMs: 30000 });
  }
  async createFilament(body) {
    return request(this.filamentBase, { method: 'POST', headers: this.auth, body, fetchImpl: this.fetchImpl });
  }
  async deleteFilaments(ids) {
    return request(`${this.filamentBase}/batch`, { method: 'DELETE', headers: this.auth, body: { ids: ids.map(Number) }, fetchImpl: this.fetchImpl });
  }
  // Bambu eist filamentName ook bij een gewichtsupdate; zonder wordt de naam leeggemaakt of de call geweigerd.
  // totalNetWeight (volle rol) is optioneel: Bambu toont daarmee het percentage.
  async updateWeight(id, netWeight, filamentName, totalNetWeight = null) {
    return request(this.filamentBase, { method: 'PUT', headers: this.auth, body: { id: Number(id), netWeight, filamentName, ...(totalNetWeight ? { totalNetWeight } : {}) }, fetchImpl: this.fetchImpl });
  }
}

// profile (optioneel): het passende Bambu-profiel uit de bibliotheek ("Type" in Handy). Zonder profiel blijft filamentId leeg.
export function bambuCreateBody(spool, marker, profile = null) {
  const material = spool.material || 'PLA';
  const total = Math.round(spool.initialWeight || spool.remainingWeight || 1000);
  return {
    createType: 'manual',
    filamentVendor: profile ? profile.vendor : spool.brand || '',
    filamentType: profile ? profile.type : material,
    // Materiaal alleen voorvoegen als de naam er nog niet mee begint (voorkomt "PLA PLA ...").
    filamentName: profile ? profile.name : spool.name ? (spool.name.toUpperCase().startsWith(material.toUpperCase()) ? spool.name : `${material} ${spool.name}`).slice(0, 60) : material,
    filamentId: profile ? profile.id : '',
    isSupport: false,
    color: `#${(spool.colorHex || '888888').slice(0, 6).toUpperCase()}FF`, // zelfde notatie als Bambu zelf (#RRGGBBAA)
    colorType: 2,
    totalNetWeight: total,
    netWeight: Math.max(0, Math.round(spool.remainingWeight ?? 0)),
    note: marker, // herkenning voor herstel na onzekere aanmaak
  };
}

export const markerFor = (spoolmanId) => `[spoolman:${spoolmanId}]`;
const isChip = (c) => !!normalizeTag(c?.RFID);

// ---------- Synchronisatie ----------

export class Bridge {
  constructor({ store, fetchImpl = fetch }) {
    this.store = store; this.fetchImpl = fetchImpl;
    this.running = false; this.timer = null; this.lastRound = null;
    this.pendingLogin = null;
    this.ha = new HaPublisher({ fetchImpl });
    this.lastPublishError = '';
  }
  get s() { return this.store.state; }
  spoolman() {
    if (!this.s.settings.spoolmanUrl) throw new HttpError('Spoolman-URL is niet ingesteld', 400);
    return new SpoolmanClient(this.s.settings.spoolmanUrl, this.fetchImpl);
  }
  bambu() {
    if (!this.s.bambu.token) throw new HttpError('Niet ingelogd bij Bambu', 401);
    return new BambuClient({ token: this.s.bambu.token, region: this.s.settings.region, fetchImpl: this.fetchImpl });
  }

  async updateSettings(patch) {
    const st = this.s.settings;
    if (patch.spoolmanUrl !== undefined) {
      const u = String(patch.spoolmanUrl).trim();
      if (u && !/^https?:\/\//.test(u)) throw new HttpError('Spoolman-URL moet met http:// of https:// beginnen', 400);
      st.spoolmanUrl = u;
    }
    if (patch.intervalSeconds !== undefined) {
      const n = Math.round(Number(patch.intervalSeconds));
      if (!Number.isFinite(n) || n < MIN_INTERVAL || n > MAX_INTERVAL) throw new HttpError(`Interval moet tussen ${MIN_INTERVAL} en ${MAX_INTERVAL} seconden liggen`, 400);
      st.intervalSeconds = n;
    }
    if (patch.autoSync !== undefined) st.autoSync = !!patch.autoSync;
    if (patch.autoCreate !== undefined) st.autoCreate = !!patch.autoCreate;
    if (patch.rfidAutoAdd !== undefined) st.rfidAutoAdd = !!patch.rfidAutoAdd;
    if (patch.chipLeader !== undefined) {
      if (!['spoolman', 'bambu'].includes(patch.chipLeader)) throw new HttpError('Leidend moet "spoolman" of "bambu" zijn', 400);
      st.chipLeader = patch.chipLeader;
    }
    if (patch.locations !== undefined) {
      const l = (Array.isArray(patch.locations) ? patch.locations : []).map((x) => String(x).trim()).filter(Boolean);
      if (!l.length || l.length > 10 || l.some((x) => x.length > 40) || new Set(l.map((x) => x.toLowerCase())).size !== l.length) throw new HttpError('Locaties: 1 tot 10 unieke namen van maximaal 40 tekens', 400);
      st.locations = l;
    }
    if (patch.rolTypes !== undefined) st.rolTypes = validateRolTypes(patch.rolTypes);
    for (const k of ['spoolmansyncUrl']) if (patch[k] !== undefined) {
      const u = String(patch[k]).trim();
      if (u && !/^https?:\/\//.test(u)) throw new HttpError('SpoolmanSync-URL moet met http:// of https:// beginnen', 400);
      st[k] = u;
    }
    if (patch.printerPrefix !== undefined) {
      const p = String(patch.printerPrefix).trim().toLowerCase();
      if (p && !/^[a-z0-9_]+$/.test(p)) throw new HttpError('Printerprefix mag alleen letters, cijfers en _ bevatten', 400);
      st.printerPrefix = p;
    }
    if (patch.lowStockGrams !== undefined) {
      const g = Math.round(Number(patch.lowStockGrams));
      if (!Number.isFinite(g) || g < 0 || g > 1000) throw new HttpError('Grens voor lage voorraad moet tussen 0 en 1000 g liggen', 400);
      st.lowStockGrams = g;
    }
    if (patch.region !== undefined) st.region = BAMBU_HOSTS[patch.region] ? patch.region : 'us';
    await this.store.save();
    this.schedule();
  }

  // Inloggen: wachtwoord wordt alleen in geheugen bewaard tot verificatie klaar is, nooit opgeslagen.
  async login(email, password) {
    const c = new BambuClient({ region: this.s.settings.region, fetchImpl: this.fetchImpl });
    const r = await c.login(email, password);
    if (r.token) return this.finishLogin(email, r.token);
    this.pendingLogin = { email, password, tfaKey: r.tfaKey, at: Date.now() };
    this.s.bambu.status = 'pending_code';
    return { needsCode: true, method: r.needs };
  }
  async verify(code) {
    const p = this.pendingLogin;
    if (!p || Date.now() - p.at > 600000) throw new HttpError('Geen openstaande login of code verlopen; log opnieuw in', 400);
    const c = new BambuClient({ region: this.s.settings.region, fetchImpl: this.fetchImpl });
    const r = await c.verify({ ...p, code });
    this.pendingLogin = null;
    return this.finishLogin(p.email, r.token);
  }
  async finishLogin(email, token) {
    this.s.bambu = { token, email, status: 'connected' };
    this.store.log('info', `Ingelogd bij Bambu als ${email.replace(/^(.).*(@.*)$/, '$1***$2')}`);
    await this.store.save();
    return { connected: true };
  }
  async logout() {
    this.s.bambu = { token: '', email: '', status: 'disconnected' };
    this.pendingLogin = null;
    await this.store.save();
  }

  // Overzicht voor de UI: beide lijsten + suggesties (nooit automatisch gekoppeld).
  async overview() {
    const [spools, cloud] = await Promise.all([this.spoolman().listSpools(), this.bambu().listFilaments()]);
    const linkedB = new Set(this.s.links.map((l) => String(l.bambuId)));
    const linkedS = new Set(this.s.links.map((l) => l.spoolmanId));
    const suggestions = [];
    for (const sp of spools) {
      if (linkedS.has(sp.id) || sp.archived) continue;
      const marked = cloud.find((c) => (c.note || '').includes(markerFor(sp.id)) && !linkedB.has(String(c.id)));
      if (marked) { suggestions.push({ spoolmanId: sp.id, bambuId: marked.id, confidence: 'hoog', reason: 'Bambu-rol draagt Spoolman-markering' }); continue; }
      const cands = cloud.filter((c) => !linkedB.has(String(c.id)) && (c.filamentType || '').toUpperCase() === sp.material.toUpperCase()
        && (c.color || '').replace('#', '').slice(0, 6).toUpperCase() === sp.colorHex.slice(0, 6));
      // Onduidelijk (0 of >1 kandidaten, of alleen kleur+materiaal): altijd handmatig bevestigen.
      if (cands.length) suggestions.push({ spoolmanId: sp.id, bambuId: cands[0].id, confidence: cands.length === 1 ? 'laag' : 'dubbelzinnig', reason: `kleur+materiaal, ${cands.length} kandidaat/kandidaten`, candidates: cands.map((c) => c.id) });
    }
    return { spools, cloud, links: this.s.links, suggestions };
  }

  // Snel toevoegen vanaf de pc-app. Staat autoCreate aan, dan zet de bridge de rol meteen ook in Bambu.
  async quickAddSpool(input) {
    // Een vast type legt het Bambu-profiel vast (en negeert geen andere velden); onbekend type wordt geweigerd vóór er iets wordt aangemaakt.
    const typeKey = String(input?.typeKey || '').trim().toLowerCase();
    const type = typeKey ? this.s.settings.rolTypes.find((t) => t.key === typeKey) : null;
    if (typeKey && !type) throw new HttpError(`Onbekend type: ${typeKey}`, 400);
    if (input?.location && !this.s.settings.locations.some((l) => l.toLowerCase() === String(input.location).trim().toLowerCase())) throw new HttpError(`Onbekende locatie: ${input.location}`, 400);
    const r = await quickAdd(this.spoolman(), input);
    if (type) this.s.profileOverrides[r.spoolId] = type.profile;
    this.store.log('info', `Rol toegevoegd via foto: Spoolman #${r.spoolId} ${r.name} ${r.weight} g${r.location ? `, locatie ${r.location}` : ''}${type ? `, type ${type.label}` : ''}`);
    await this.store.save();
    if (this.s.settings.autoCreate && this.s.bambu.token) this.syncOnce('nieuwe rol').catch(() => {});
    return r;
  }
  async quickAddCatalog() {
    return { ...(await catalog(this.spoolman())), locations: this.s.settings.locations, types: this.s.settings.rolTypes };
  }
  // ---------- Uitgesteld koppelen aan een tray ----------
  // Scan, kies tray, doe de rol erin: pas als de printer de rol in de tray ziet, wordt de rol in SpoolmanSync aan die tray gekoppeld.
  syncUrl() {
    const u = this.s.settings.spoolmansyncUrl;
    if (!u) throw new HttpError('SpoolmanSync-URL is niet ingesteld in de bridge', 400);
    return u;
  }
  async trays() {
    const now = Date.now();
    if (!this.trayCache || now - this.trayCache.at > 8000) this.trayCache = { at: now, list: await fetchTrays(this.syncUrl(), this.fetchImpl) };
    return this.trayCache.list;
  }
  async scanInfo(spoolId) {
    const id = Number(spoolId);
    if (!Number.isInteger(id) || id < 1) throw new HttpError('Ongeldig rolnummer', 400);
    const spools = await this.spoolman().listSpools();
    const sp = spools.find((x) => x.id === id && !x.archived);
    if (!sp) throw new HttpError(`Rol #${id} bestaat niet (meer) in Spoolman`, 404);
    const trays = await this.trays();
    const pending = this.s.pendingAssigns.find((p) => p.spoolId === id) || null;
    const mine = trays.find((t) => t.assignedSpoolId === id) || null;
    return {
      spool: { id, name: [sp.brand, sp.name || sp.material].filter(Boolean).join(' ') || `Rol ${id}`, material: sp.material, colorHex: sp.colorHex ? `#${sp.colorHex}` : '', grams: sp.remainingWeight, location: sp.location },
      trays: trays.map((t) => ({ id: t.id, printer: t.printer, group: t.group, label: t.label, name: t.name, color: t.color, assignedSpoolId: t.assignedSpoolId,
        waitingSpoolId: this.s.pendingAssigns.find((p) => p.trayId === t.id)?.spoolId ?? null })),
      assignedTrayId: mine?.id ?? null,
      pending: pending && { trayId: pending.trayId, label: pending.label, phase: pending.phase || 'wacht-op-rol', since: pending.createdAt, error: pending.lastError || '' },
      lastAssigned: this.s.lastAssigned && this.s.lastAssigned.spoolId === id ? this.s.lastAssigned : null,
    };
  }
  async queueAssign(spoolId, trayId) {
    const id = Number(spoolId);
    if (!this.ha.enabled) throw new HttpError('Geen verbinding met Home Assistant; kan niet zien wanneer de rol in de tray zit', 503);
    const [spools, trays] = await Promise.all([this.spoolman().listSpools(), this.trays()]);
    if (!spools.some((x) => x.id === id && !x.archived)) throw new HttpError(`Rol #${id} bestaat niet (meer) in Spoolman`, 404);
    const tray = trays.find((t) => t.id === String(trayId));
    if (!tray) throw new HttpError('Onbekende tray', 400);
    const st = await this.ha.getState(tray.entityId).catch(() => null);
    if (!st) throw new HttpError(`Tray-status van ${tray.entityId} niet te lezen in Home Assistant`, 502);
    // Eén wachtende rol per tray en één tray per rol: de laatste scan wint.
    this.s.pendingAssigns = this.s.pendingAssigns.filter((p) => p.spoolId !== id && p.trayId !== tray.id);
    const loaded = trayLoadedOf(st);
    const p = { spoolId: id, trayId: tray.id, entityId: tray.entityId, label: `${tray.printer} ${tray.group} ${tray.label}`.replace(/\s+/g, ' ').trim(), createdAt: Date.now(),
      baseLoaded: loaded !== false, baseUuid: String(st.attributes?.tray_uuid || ''), armed: false, loadedSince: 0, phase: loaded === false ? 'wacht-op-rol' : 'oude-rol-eruit', lastError: '' };
    this.s.pendingAssigns.push(p);
    this.store.log('info', `Rol #${id} wacht op ${p.label} (${loaded === false ? 'tray is leeg' : 'er zit nog een rol in'})`);
    await this.store.save();
    this.publishPending().catch(() => {});
    return this.scanInfo(id);
  }
  async cancelAssign(spoolId) {
    const id = Number(spoolId);
    const before = this.s.pendingAssigns.length;
    this.s.pendingAssigns = this.s.pendingAssigns.filter((p) => p.spoolId !== id);
    if (this.s.pendingAssigns.length !== before) { this.store.log('info', `Wachtende koppeling van rol #${id} geannuleerd`); await this.store.save(); this.publishPending().catch(() => {}); }
    return this.scanInfo(id);
  }
  // Koppelt meteen, zonder te wachten (rol zit er al in).
  async assignNow(spoolId, trayId) {
    const id = Number(spoolId);
    const tray = (await this.trays()).find((t) => t.id === String(trayId));
    if (!tray) throw new HttpError('Onbekende tray', 400);
    await this.finishAssign({ spoolId: id, trayId: tray.id, label: `${tray.printer} ${tray.group} ${tray.label}`.replace(/\s+/g, ' ').trim() }, 'handmatig');
    return this.scanInfo(id);
  }
  async finishAssign(p, how) {
    await assignViaSpoolmanSync(this.syncUrl(), p.spoolId, p.trayId, this.fetchImpl);
    this.s.pendingAssigns = this.s.pendingAssigns.filter((x) => x.spoolId !== p.spoolId && x.trayId !== p.trayId);
    this.s.lastAssigned = { spoolId: p.spoolId, label: p.label, at: new Date().toISOString() };
    this.trayCache = null;
    this.store.log('info', `Rol #${p.spoolId} gekoppeld aan ${p.label} (${how})`);
    await this.store.save();
    this.publishPending().catch(() => {});
  }
  // Loopt langs de wachtende koppelingen; draait elke paar seconden.
  async checkPending(now = Date.now()) {
    if (this.checkingPending || !this.s.pendingAssigns.length) return;
    this.checkingPending = true;
    let dirty = false;
    try {
      for (const p of [...this.s.pendingAssigns]) {
        let st = null;
        try { st = await this.ha.getState(p.entityId); } catch { /* HA even weg: niets afleiden */ }
        const r = evaluate(p, st, now);
        if (r.phase !== p.phase) { p.phase = r.phase; dirty = true; }
        for (const [k, v] of Object.entries(r.patch)) if (p[k] !== v) { p[k] = v; dirty = true; }
        if (r.action === 'expire') {
          this.s.pendingAssigns = this.s.pendingAssigns.filter((x) => x !== p);
          this.store.log('warn', `Rol #${p.spoolId} is niet binnen een uur in ${p.label} gezien; wachtende koppeling verlopen`);
          dirty = true;
        } else if (r.action === 'assign') {
          try { await this.finishAssign(p, 'rol gezien in de tray'); dirty = false; }
          catch (e) { if (p.lastError !== e.message) { p.lastError = e.message; this.store.log('warn', `Koppelen van rol #${p.spoolId} mislukt, ik probeer opnieuw: ${e.message}`); dirty = true; } }
        }
      }
      if (dirty) { await this.store.save(); this.publishPending().catch(() => {}); }
    } finally { this.checkingPending = false; }
  }
  watchPending(everyMs = 5000) {
    clearInterval(this.pendingTimer);
    this.pendingTimer = setInterval(() => { this.checkPending().catch(() => {}); }, everyMs);
    this.pendingTimer.unref?.();
  }
  async publishPending() {
    if (!this.ha.enabled) return;
    const items = this.s.pendingAssigns.map((p) => ({ rol: p.spoolId, tray: p.label, status: PHASE_TEXT[p.phase] || p.phase, sinds: new Date(p.createdAt).toISOString() }));
    await this.ha.publish({ [PENDING_ID]: { state: items.length, attributes: { friendly_name: 'Rollen die op een tray wachten', icon: 'mdi:timer-sand', wachtend: items, laatst_gekoppeld: this.s.lastAssigned || null } } }, { cleanup: false });
  }

  // Token voor de pc-app (poort 8100): wordt eenmalig getoond en alleen als hash bewaard.
  async newLanToken() {
    const token = crypto.randomBytes(24).toString('base64url');
    this.s.settings.lanTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await this.store.save();
    this.store.log('info', 'Nieuw token voor de pc-app aangemaakt');
    return token;
  }
  checkLanToken(token) {
    const h = this.s.settings.lanTokenHash;
    if (!h || !token) return false;
    const a = Buffer.from(crypto.createHash('sha256').update(String(token)).digest('hex'));
    const b = Buffer.from(h);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // Verkenning: staan je eigen filamentprofielen (SUNLU C190 e.d.) in dit endpoint, en met welk ID?
  async slicerProbe() {
    const d = await this.bambu().slicerSettings();
    const f = d?.filament || {};
    const pick = (p) => ({ setting_id: p.setting_id, name: p.name, filament_id: p.filament_id, base_id: p.base_id, vendor: p.filament_vendor, type: p.filament_type, nozzle_temperature: p.nozzle_temperature, version: p.version });
    return {
      filamentKeys: Object.keys(f), counts: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])),
      private: (Array.isArray(f.private) ? f.private : []).slice(0, 40).map(pick),
    };
  }
  // Bambu's profielenbibliotheek (het "Type" in Handy), een uur in het geheugen bewaard.
  async profileList(bambu = this.bambu()) {
    if (!this.profileCache || Date.now() - this.profileCache.at > 3600e3) this.profileCache = { at: Date.now(), list: listProfiles(await bambu.filamentConfig()) };
    return this.profileCache.list;
  }
  // rolls: bestaande rollen in Bambu; hun profielen gaan voor (die kent jouw account), de bibliotheek vult aan.
  async findProfile(bambu, spool, rolls = []) {
    const own = deriveProfiles(rolls);
    const seen = new Set(own.map((p) => `${p.id}|${p.name.toLowerCase()}`));
    let lib = [];
    try { lib = (await this.profileList(bambu)).filter((p) => !seen.has(`${p.id}|${p.name.toLowerCase()}`)); }
    catch (e) { this.store.log('warn', `Profielenbibliotheek niet beschikbaar (${e.message}); alleen profielen van je bestaande rollen gebruikt`); }
    const p = matchProfile([...own, ...lib], spool);
    this.store.log(p ? 'info' : 'warn', p ? `Bambu-profiel voor Spoolman #${spool.id}: ${p.vendor} ${p.name} (${p.id})` : `Geen Bambu-profiel gevonden voor Spoolman #${spool.id} (${spool.brand} ${spool.name}); type blijft leeg`);
    return p;
  }
  async spoolmanCheck() {
    try {
      const spools = await this.spoolman().listSpools();
      return { ok: true, count: spools.length, active: spools.filter((x) => !x.archived).length };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async addLink(spoolmanId, bambuId) {
    spoolmanId = Number(spoolmanId); bambuId = String(bambuId);
    if (this.s.links.some((l) => l.spoolmanId === spoolmanId)) throw new HttpError('Deze Spoolman-rol is al gekoppeld', 409);
    if (this.s.links.some((l) => String(l.bambuId) === bambuId)) throw new HttpError('Deze Bambu-rol is al gekoppeld', 409);
    const link = { id: crypto.randomUUID(), spoolmanId, bambuId, paused: false, pauseReason: '', lastSyncedGrams: null, lastSyncAt: null, lastError: '', createdAt: new Date().toISOString() };
    this.s.links.push(link);
    this.store.log('info', `Koppeling Spoolman #${spoolmanId} ↔ Bambu ${bambuId}`);
    await this.store.save();
    return link;
  }
  // Ontkoppelen verwijdert nooit rollen, alleen de koppeling.
  async removeLink(id) {
    const i = this.s.links.findIndex((l) => l.id === id);
    if (i < 0) throw new HttpError('Koppeling niet gevonden', 404);
    const [l] = this.s.links.splice(i, 1);
    this.store.log('info', `Koppeling Spoolman #${l.spoolmanId} verwijderd (rollen ongewijzigd)`);
    await this.store.save();
  }

  // Maakt een Bambu-rol aan. Bij onzekere uitkomst wordt eerst naar de markering gezocht i.p.v. opnieuw aan te maken.
  async createBambuFor(spoolmanId) {
    spoolmanId = Number(spoolmanId);
    if (this.s.links.some((l) => l.spoolmanId === spoolmanId)) throw new HttpError('Deze Spoolman-rol is al gekoppeld', 409);
    const spool = (await this.spoolman().listSpools()).find((s) => s.id === spoolmanId);
    if (!spool) throw new HttpError('Spoolman-rol niet gevonden', 404);
    if (spool.archived) throw new HttpError('Gearchiveerde rol wordt niet aangemaakt', 400);
    if (spool.remainingWeight == null) throw new HttpError('Rol heeft geen bekend gewicht; stel dat eerst in Spoolman in', 400);
    const bambu = this.bambu();
    const marker = markerFor(spoolmanId);
    const rolls = await bambu.listFilaments();
    const existing = rolls.find((c) => (c.note || '').includes(marker));
    let bambuId = existing?.id;
    if (!bambuId) {
      if (!this.s.pendingCreates.some((p) => p.spoolmanId === spoolmanId)) this.s.pendingCreates.push({ spoolmanId, marker, startedAt: new Date().toISOString() });
      await this.store.save();
      try {
        const fixed = this.s.profileOverrides[spoolmanId];
        if (fixed) this.store.log('info', `Vast Bambu-profiel voor Spoolman #${spoolmanId}: ${fixed.vendor} ${fixed.name} (${fixed.id})`);
        const profile = fixed || await this.findProfile(bambu, spool, rolls);
        const r = await bambu.createFilament(bambuCreateBody(spool, marker, profile));
        bambuId = r?.id ?? r?.data?.id;
      } catch (e) {
        if (e.uncertain) {
          const again = (await bambu.listFilaments().catch(() => [])).find((c) => (c.note || '').includes(marker));
          if (!again) throw new HttpError('Onzeker of de Bambu-rol is aangemaakt. Niet opnieuw geprobeerd; controleer de lijst en probeer later opnieuw.', 502);
          bambuId = again.id;
        } else throw e;
      }
      if (!bambuId) {
        bambuId = (await bambu.listFilaments()).find((c) => (c.note || '').includes(marker))?.id;
        if (!bambuId) throw new HttpError('Bambu gaf geen rol-ID terug en de rol is niet terug te vinden', 502);
      }
    }
    this.s.pendingCreates = this.s.pendingCreates.filter((p) => p.spoolmanId !== spoolmanId);
    const link = await this.addLink(spoolmanId, bambuId);
    this.store.log('info', `Bambu-rol ${bambuId} aangemaakt voor Spoolman #${spoolmanId}`);
    await this.store.save();
    return link;
  }

  // Koppelt Spoolman-rollen met een Bambu-chip (extra.tag = serienummer) aan Bambu's eigen regel (RFID = hetzelfde nummer).
  // Een eerder door de bridge gemaakte dubbele handmatige regel ([spoolman:ID] in de notitie) wordt verwijderd; andere regels blijven staan.
  async pairChipRolls(spools, cloud, byB, result) {
    const chip = new Map();
    for (const c of cloud) { const k = normalizeTag(c.RFID); if (k && !chip.has(k)) chip.set(k, c); }
    if (!chip.size) return;
    for (const sp of spools) {
      const k = sp.archived ? '' : normalizeTag(sp.rfid);
      const cb = k && chip.get(k);
      if (!cb) continue;
      const mine = this.s.links.find((l) => l.spoolmanId === sp.id);
      const lead = this.s.settings.chipLeader === 'bambu' ? 'bambu' : 'spoolman';
      if (mine && String(mine.bambuId) === String(cb.id)) { if (mine.lead !== lead) { mine.lead = lead; await this.store.save(); } continue; }
      if (this.s.links.some((l) => String(l.bambuId) === String(cb.id))) continue; // de chip-regel hoort al bij een andere rol
      try {
        if (mine) {
          const old = byB.get(String(mine.bambuId));
          if (old && (old.note || '').includes(markerFor(sp.id)) && !normalizeTag(old.RFID)) {
            await this.bambu().deleteFilaments([old.id]);
            this.store.log('info', `Dubbele Bambu-regel ${old.id} van Spoolman #${sp.id} verwijderd: Bambu heeft er zelf een (${cb.id})`);
          }
          this.s.links = this.s.links.filter((l) => l !== mine);
        }
        const link = { id: crypto.randomUUID(), spoolmanId: sp.id, bambuId: String(cb.id), lead, paused: false, pauseReason: '', lastSyncedGrams: null, lastSyncAt: null, lastError: '', createdAt: new Date().toISOString() };
        this.s.links.push(link);
        this.store.log('info', `Spoolman #${sp.id} gekoppeld aan Bambu's eigen regel ${cb.id} (serienummer); ${lead === 'bambu' ? 'Bambu' : 'Spoolman'} is leidend voor het gewicht`);
        await this.store.save();
      } catch (e) { result.failed++; this.store.log('error', `Koppelen aan Bambu's eigen regel voor Spoolman #${sp.id}: ${e.message}`); }
    }
  }

  // Eén ronde. Nooit gelijktijdig.
  async syncOnce(trigger = 'handmatig') {
    if (this.running) return { skipped: true, reason: 'ronde loopt al' };
    this.running = true;
    const result = { trigger, updated: 0, unchanged: 0, paused: 0, failed: 0 };
    let lastSpools = null;
    try {
      let spools, cloud;
      try {
        [spools, cloud] = await Promise.all([this.spoolman().listSpools(), this.bambu().listFilaments()]);
      } catch (e) {
        if (e.status === 401) this.s.bambu.status = 'expired';
        this.store.log('error', `Synchronisatie afgebroken: ${e.message}`);
        result.error = e.message; result.failed = this.s.links.length;
        return result;
      }
      lastSpools = spools;
      const byS = new Map(spools.map((s) => [s.id, s]));
      const byB = new Map(cloud.map((c) => [String(c.id), c]));
      const removed = [];
      await this.pairChipRolls(spools, cloud, byB, result);
      for (const link of [...this.s.links]) {
        try {
          const sp = byS.get(link.spoolmanId); const bc = byB.get(String(link.bambuId));
          // Rol met Bambu-chip: Bambu rekent het verbruik zelf uit, dus Bambu is leidend en het gewicht gaat van Bambu naar Spoolman.
          // Bambu's eigen regel wordt nooit verwijderd.
          if (link.lead === 'bambu') {
            if (!sp && spools.length > 0) { removed.push(link); continue; }
            if (!sp || sp.archived) { this.pause(link, !sp ? 'Spoolman-rol ontbreekt' : 'Spoolman-rol is gearchiveerd'); result.paused++; continue; }
            if (!bc) { this.pause(link, 'Bambu-rol ontbreekt'); result.paused++; continue; }
            const net = Math.round(Number(bc.netWeight));
            if (!Number.isFinite(net) || net < 0 || sp.initialWeight == null) { this.pause(link, 'Bambu of Spoolman geeft geen bruikbaar gewicht'); result.paused++; continue; }
            link.paused = false; link.pauseReason = '';
            if (sp.remainingWeight != null && Math.round(sp.remainingWeight) === net) { link.lastSyncedGrams = net; link.lastError = ''; result.unchanged++; continue; }
            await this.spoolman().patchSpool(sp.id, { used_weight: Math.round(Math.max(0, sp.initialWeight - net) * 100) / 100 });
            link.lastSyncedGrams = net; link.lastSyncAt = new Date().toISOString(); link.lastError = '';
            this.store.log('info', `Bambu ${link.bambuId}: ${net} g → Spoolman #${sp.id} (was ${sp.remainingWeight == null ? '?' : Math.round(sp.remainingWeight)} g)`);
            result.updated++; continue;
          }
          // Verwijderde Spoolman-rol: de gekoppelde Bambu-rol wordt ook verwijderd (Spoolman is leidend).
          // Bij een lege Spoolman-lijst (gewiste database?) niets verwijderen maar pauzeren.
          if (!sp && spools.length > 0) {
            if (byB.has(String(link.bambuId)) && !isChip(byB.get(String(link.bambuId)))) await this.bambu().deleteFilaments([link.bambuId]);
            removed.push(link); continue;
          }
          if (!sp || sp.archived) { this.pause(link, !sp ? 'Spoolman-rol ontbreekt' : 'Spoolman-rol is gearchiveerd'); result.paused++; continue; }
          if (!bc) { this.pause(link, 'Bambu-rol ontbreekt'); result.paused++; continue; }
          if (sp.remainingWeight == null) { this.pause(link, 'Spoolman-rol heeft geen bekend gewicht'); result.paused++; continue; }
          link.paused = false; link.pauseReason = '';
          const target = Math.max(0, Math.round(sp.remainingWeight));
          // Volle rol (Spoolman "Weight"): Bambu rekent het percentage uit netWeight / totalNetWeight. Eén poging per waarde:
          // negeert Bambu het veld, dan sturen we het niet elke ronde opnieuw.
          const wantTotal = sp.initialWeight >= 1 ? Math.max(Math.round(sp.initialWeight), target) : null;
          const totalOk = !wantTotal || bc.totalNetWeight == null || Number(bc.totalNetWeight) === wantTotal || link.totalTried === wantTotal;
          if (Number(bc.netWeight) === target && totalOk) { link.lastSyncedGrams = target; link.lastError = ''; result.unchanged++; continue; }
          const name = bc.filamentName || bc.filamentType || '';
          const sendTotal = !totalOk ? wantTotal : null;
          try { await this.bambu().updateWeight(link.bambuId, target, name, sendTotal); }
          catch (e) {
            if (!sendTotal || ![400, 422].includes(e.status)) throw e;
            link.totalTried = wantTotal; this.logOnce(`total-${link.bambuId}`, `Bambu weigert het totaalgewicht (${e.message}); alleen het resterende gewicht wordt gesynchroniseerd`);
            await this.bambu().updateWeight(link.bambuId, target, name);
          }
          if (sendTotal) link.totalTried = wantTotal;
          link.lastSyncedGrams = target; link.lastSyncAt = new Date().toISOString(); link.lastError = '';
          this.store.log('info', `Spoolman #${link.spoolmanId}: ${sp.remainingWeight} g → Bambu ${target} g`);
          result.updated++;
        } catch (e) {
          link.lastError = e.message; result.failed++; // volgende ronde opnieuw met nieuwste Spoolman-stand
          this.store.log('error', `Koppeling Spoolman #${link.spoolmanId}: ${e.message}`);
        }
      }
      if (this.s.settings.autoCreate && spools.length > 0) {
        // Nieuwe Spoolman-rollen automatisch in Bambu aanmaken (max. 5 per ronde); herkenning via [spoolman:ID].
        const linked = new Set(this.s.links.map((l) => l.spoolmanId));
        // Rollen met Bambu-chip (tag) krijgen geen handmatige Bambu-regel: Bambu heeft er zelf een, die koppelen we via het serienummer.
        const fresh = spools.filter((x) => !x.archived && !linked.has(x.id) && !normalizeTag(x.rfid) && x.remainingWeight != null && x.remainingWeight > 0).slice(0, 5);
        for (const sp of fresh) {
          try { await this.createBambuFor(sp.id); result.created = (result.created || 0) + 1; }
          catch (e) { result.failed++; this.store.log('error', `Automatisch aanmaken Spoolman #${sp.id}: ${e.message}`); }
        }
      }
      for (const l of removed) {
        this.s.links = this.s.links.filter((x) => x.id !== l.id);
        this.store.log('info', `Spoolman #${l.spoolmanId} is verwijderd: ${l.lead === 'bambu' ? `koppeling met Bambu's eigen regel ${l.bambuId} opgeheven (die blijft staan)` : `Bambu-rol ${l.bambuId} verwijderd en koppeling opgeheven`}`);
        result.unlinked = (result.unlinked || 0) + 1;
      }
    } finally {
      this.running = false;
      this.lastRound = { at: new Date().toISOString(), ...result };
      await this.store.save().catch(() => {});
      await this.publishToHa(lastSpools);
    }
    return result;
  }
  async publishToHa(spools) {
    if (!this.ha.enabled) return;
    try {
      const list = spools || await this.spoolman().listSpools().catch(() => null);
      if (!list) { // Spoolman onbereikbaar: alleen de status bijwerken, rolsensoren niet opruimen
        const st = buildStates({ spools: [], links: this.s.links, bambuStatus: this.s.bambu.status, lastRound: this.lastRound, running: this.running });
        await this.ha.publish({ [STATUS_ID]: st[STATUS_ID] }, { cleanup: false });
        return;
      }
      const states = buildStates({ spools: list, links: this.s.links, lowStockGrams: this.s.settings.lowStockGrams, bambuStatus: this.s.bambu.status, lastRound: this.lastRound, running: this.running });
      await this.updateHistory(list).catch((e) => this.logOnce('history', `Printgeschiedenis bijwerken mislukt: ${e.message}`));
      states['sensor.printgeschiedenis'] = historyState(this.s.history);
      // Verwijderde/gearchiveerde rollen worden door publish() opgeruimd; ze staan niet meer in 'states'.
      await this.ha.publish(states);
      await this.publishPending();
      this.lastPublishError = '';
    } catch (e) {
      if (this.lastPublishError !== e.message) this.store.log('warn', `Publiceren naar Home Assistant mislukt: ${e.message}`);
      this.lastPublishError = e.message;
    }
  }
  logOnce(key, msg) {
    this.logged ??= {};
    if (this.logged[key] !== msg) this.store.log('warn', msg);
    this.logged[key] = msg;
  }
  // Printnaam/status/voortgang van nu, via de officiële Bambu-integratie in HA.
  async printContext() {
    const pre = this.s.settings.printerPrefix;
    if (!pre) return null;
    const get = async (id) => { try { const r = await this.ha.getState(id); return r?.state; } catch { return undefined; } };
    const [naam, status, voortgang, gepland] = await Promise.all([
      get(`sensor.${pre}_taaknaam`), get(`sensor.${pre}_printstatus`), get(`sensor.${pre}_printvoortgang`), get(`sensor.${pre}_gewicht_van_print`)]);
    const num = (v) => (v == null || v === 'unknown' || v === 'unavailable' || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return { naam: naam && !['unknown', 'unavailable'].includes(naam) ? naam : '', status: status || '', voortgang: num(voortgang), gepland: num(gepland) };
  }
  async updateHistory(spools) {
    const url = this.s.settings.spoolmansyncUrl;
    if (!url) return 0;
    const logs = await fetchUsageLogs(url, this.fetchImpl);
    if (!logs.some((l) => !this.s.history.seen.includes(l.id))) { this.logged && (this.logged.history = ''); return 0; }
    const n = ingest(this.s.history, logs, { spools, context: await this.printContext() });
    this.logged && (this.logged.history = '');
    if (n) { this.store.log('info', `Printgeschiedenis: ${n} nieuwe afboeking(en) uit SpoolmanSync`); await this.store.save(); }
    return n;
  }
  pause(link, reason) {
    if (!link.paused || link.pauseReason !== reason) this.store.log('warn', `Koppeling Spoolman #${link.spoolmanId} gepauzeerd: ${reason}`);
    link.paused = true; link.pauseReason = reason;
  }

  // Originele Bambu-rollen (RFID) in de AMS die nog niet in Spoolman staan, toevoegen. Eén ronde tegelijk.
  // Een rol wordt herkend aan extra.tag; gearchiveerde rollen tellen mee, zodat een bewust gearchiveerde rol niet terugkomt.
  async rfidRound() {
    const set = this.s.settings;
    if (!set.rfidAutoAdd || !set.spoolmanUrl || !this.ha.enabled || this.rfidRunning) return { skipped: true };
    this.rfidRunning = true;
    const result = { added: 0, known: 0, failed: 0, assigned: 0 };
    try {
      const trays = rfidTrays(await this.ha.listStates(), set.printerPrefix);
      if (!trays.length) return result;
      const sm = this.spoolman();
      const spools = await sm.listSpools();
      const known = new Set(spools.map((x) => normalizeTag(x.rfid)).filter(Boolean));
      for (const t of trays) {
        if (known.has(t.uuid)) { result.known++; continue; }
        try {
          const r = await addRfidSpool(sm, t);
          known.add(t.uuid); result.added++;
          spools.push({ id: r.spoolId, archived: false, rfid: JSON.stringify(t.uuid), tray: '' });
          this.store.log('info', `Bambu-rol uit de AMS toegevoegd: Spoolman #${r.spoolId} ${r.name} ${r.weight} g (${t.entityId})`);
        } catch (e) {
          result.failed++; this.logOnce(`rfid-${t.uuid}`, `RFID-rol ${t.name} (${t.entityId}) toevoegen mislukt: ${e.message}`);
        }
      }
      try {
        for (const a of await assignTrays(sm, this.ha, trays, spools)) {
          result.assigned++; this.store.log('info', `Spoolman #${a.spoolId} gekoppeld aan AMS-vak ${a.entityId}`);
        }
      } catch (e) { this.logOnce('rfid-assign', `Rol aan AMS-vak koppelen mislukt: ${e.message}`); }
      if (result.added || result.assigned) {
        await this.store.save();
        if (result.added && set.autoCreate && this.s.bambu.token) this.syncOnce('nieuwe rol').catch(() => {});
      }
    } catch (e) {
      this.logOnce('rfid-round', `RFID-controle mislukt: ${e.message}`);
      result.error = e.message;
    } finally { this.rfidRunning = false; }
    return result;
  }

  schedule() {
    clearInterval(this.rfidTimer); clearTimeout(this.rfidFirst); this.rfidTimer = null;
    if (this.s.settings.rfidAutoAdd && this.s.settings.spoolmanUrl && this.ha.enabled) {
      this.rfidFirst = setTimeout(() => this.rfidRound().catch(() => {}), 5000);
      this.rfidTimer = setInterval(() => this.rfidRound().catch(() => {}), RFID_INTERVAL * 1000);
      this.rfidFirst.unref?.(); this.rfidTimer.unref?.();
    }
    clearInterval(this.timer); this.timer = null;
    if (!this.s.settings.autoSync || !this.s.settings.spoolmanUrl) return;
    this.timer = setInterval(() => { if (this.s.bambu.token) this.syncOnce('automatisch').catch(() => {}); }, this.s.settings.intervalSeconds * 1000);
    this.timer.unref?.();
  }
  status() {
    return {
      version: VERSION,
      settings: { ...this.s.settings, lanTokenHash: undefined, lanTokenSet: !!this.s.settings.lanTokenHash },
      bambu: { status: this.s.bambu.status, email: this.s.bambu.email ? this.s.bambu.email.replace(/^(.).*(@.*)$/, '$1***$2') : '' },
      links: this.s.links, pendingCreates: this.s.pendingCreates, pendingAssigns: this.s.pendingAssigns,
      history: this.s.history.prints.slice(0, 20), lastRound: this.lastRound, running: this.running, activity: this.s.activity.slice(0, 50),
    };
  }
}
