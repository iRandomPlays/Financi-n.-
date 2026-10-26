// G-code-analyse voor verbruiksvoorstellen. Boekt NOOIT zelf af; levert alleen een voorstel met bron en onzekerheid.
// Let op: laden/ontladen en firmware-spoelacties staan niet (volledig) in model-G-code; die zijn hier niet meegeteld.

const DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2, PVA: 1.23 };

export function gramsFromMm(mm, { diameter = 1.75, density = 1.24 } = {}) {
  const r = diameter / 2;
  return (Math.PI * r * r * mm * density) / 1000; // mm³ → cm³ × g/cm³
}

// Retour: { filaments: {n: {mm}}, layers: [{layer, line, mm:{n:mm}}], totalLayers }
// Absolute (M82) en relatieve (M83) extrusie, G92 E-reset, retracties (terugvoer wordt niet dubbel geteld),
// toolwissel via T<n> en Bambu's M620 S<n>A.
export function analyzeGcode(text) {
  let relative = false, lastE = 0, current = 0, retracted = 0;
  const mm = {}; const layers = []; let totalLayers = null;
  let layer = { layer: 0, line: 0, mm: {} };
  const add = (amount) => {
    mm[current] = (mm[current] || 0) + amount;
    layer.mm[current] = (layer.mm[current] || 0) + amount;
  };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const comment = raw.indexOf(';');
    const code = (comment >= 0 ? raw.slice(0, comment) : raw).trim();
    if (comment >= 0) {
      const c = raw.slice(comment + 1).trim();
      const lm = c.match(/^layer num\/total_layer_count:\s*(\d+)\/(\d+)/i);
      if (lm) { layers.push(layer); layer = { layer: Number(lm[1]), line: i + 1, mm: {} }; totalLayers = Number(lm[2]); }
      else if (/^LAYER_CHANGE$/.test(c) && totalLayers === null) { layers.push(layer); layer = { layer: layers.length, line: i + 1, mm: {} }; }
    }
    if (!code) continue;
    if (code === 'M82') { relative = false; continue; }
    if (code === 'M83') { relative = true; continue; }
    let m = code.match(/^M620\s+S(\d+)A/); // AMS-wissel
    if (m) { current = Number(m[1]); continue; }
    m = code.match(/^T(\d+)\b/);
    if (m && Number(m[1]) < 255) { current = Number(m[1]); lastE = relative ? 0 : lastE; continue; }
    if (/^G92\b/.test(code)) { const e = code.match(/\bE(-?[\d.]+)/); if (e) lastE = Number(e[1]); continue; }
    if (/^G[01]\b/.test(code)) {
      const e = code.match(/\bE(-?[\d.]+)/);
      if (!e) continue;
      const val = Number(e[1]);
      const delta = relative ? val : val - lastE;
      lastE = relative ? 0 : val;
      if (delta < 0) retracted += -delta;
      else if (delta > 0) {
        const recovered = Math.min(retracted, delta); // terugvoeren na retractie is geen nieuw verbruik
        retracted -= recovered;
        if (delta - recovered > 0) add(delta - recovered);
      }
    }
  }
  layers.push(layer);
  return { filaments: Object.fromEntries(Object.entries(mm).map(([k, v]) => [k, { mm: v }])), layers: layers.filter((l) => l.layer > 0 || Object.keys(l.mm).length), totalLayers };
}

export function summarize(analysis, materials = {}, diameter = 1.75) {
  const out = {};
  for (const [n, { mm }] of Object.entries(analysis.filaments)) {
    const mat = (materials[n] || 'PLA').toUpperCase();
    out[n] = { mm, grams: gramsFromMm(mm, { diameter, density: DENSITY[mat] || 1.24 }), material: mat };
  }
  return out;
}

// Voorstel voor een afgebroken print op basis van laatst bevestigde laag.
// Bron: 'G-code tot laatst bevestigde laag'. Onzekerheid = de (mogelijk deels uitgevoerde) volgende laag.
export function proposeAbort(analysis, lastConfirmedLayer, materials = {}, diameter = 1.75) {
  const done = {}; const next = {};
  for (const l of analysis.layers) {
    const bucket = l.layer <= lastConfirmedLayer ? done : l.layer === lastConfirmedLayer + 1 ? next : null;
    if (!bucket) continue;
    for (const [n, mm] of Object.entries(l.mm)) bucket[n] = (bucket[n] || 0) + mm;
  }
  const result = [];
  for (const n of new Set([...Object.keys(done), ...Object.keys(next)])) {
    const mat = (materials[n] || 'PLA').toUpperCase();
    const o = { diameter, density: DENSITY[mat] || 1.24 };
    result.push({
      filament: Number(n),
      estimatedGrams: round1(gramsFromMm(done[n] || 0, o)),
      uncertaintyGrams: round1(gramsFromMm(next[n] || 0, o)),
    });
  }
  return {
    kind: 'schatting',
    source: `G-code tot laatst bevestigde laag (${lastConfirmedLayer})`,
    uncertainty: 'laatste laag mogelijk gedeeltelijk uitgevoerd; spoelen/laden/ontladen niet meegeteld',
    requiresConfirmation: true,
    filaments: result.sort((a, b) => a.filament - b.filament),
  };
}
const round1 = (x) => Math.round(x * 10) / 10;
