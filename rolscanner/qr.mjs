// Kleine QR-code generator (byte-modus, foutcorrectie M, versie 1 t/m 10). Geen afhankelijkheden.
// Bewust één zelfstandige functie, zodat de bron ook in de webpagina kan worden ingevoegd (makeQr.toString()).
// Geeft een matrix van booleans terug (true = donker), zonder stille rand.
export function makeQr(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const DATA = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
  const ECN = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const BLK = [0, [[1, 16]], [[1, 28]], [[1, 44]], [[2, 32]], [[2, 43]], [[4, 27]], [[4, 31]], [[2, 38], [2, 39]], [[3, 36], [2, 37]], [[4, 43], [1, 44]]];
  const ALIGN = [0, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  let ver = 0;
  for (let v = 1; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= DATA[v] * 8) { ver = v; break; }
  if (!ver) throw new Error('Tekst is te lang voor de QR-code');

  // 1. Gegevensbits
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  const cap = DATA[ver] * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; cw.length < DATA[ver]; p++) cw.push(p % 2 ? 17 : 236);

  // 2. Reed-Solomon over GF(256)
  const exp = new Array(512); const log = new Array(256); let x = 1;
  for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  const mul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
  const rs = (data, n) => {
    let g = [1];
    for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], exp[i]); } g = ng; }
    const res = new Array(n).fill(0);
    for (const d of data) { const f = d ^ res[0]; res.shift(); res.push(0); for (let j = 0; j < n; j++) res[j] ^= mul(g[j + 1], f); }
    return res;
  };
  const blocks = []; let off = 0;
  for (const [count, len] of BLK[ver]) for (let i = 0; i < count; i++) { const d = cw.slice(off, off + len); off += len; blocks.push({ d, e: rs(d, ECN[ver]) }); }
  const all = [];
  for (let i = 0; i < Math.max(...blocks.map((b) => b.d.length)); i++) blocks.forEach((b) => { if (i < b.d.length) all.push(b.d[i]); });
  for (let i = 0; i < ECN[ver]; i++) blocks.forEach((b) => all.push(b.e[i]));
  const stream = []; all.forEach((c) => put2(c)); function put2(c) { for (let i = 7; i >= 0; i--) stream.push((c >>> i) & 1); }

  // 3. Matrix met functiepatronen
  const size = 17 + 4 * ver;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (col, row, dark) => { if (col < 0 || row < 0 || col >= size || row >= size) return; mod[row][col] = dark; fn[row][col] = true; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const inside = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6;
      setF(c0 + dx, r0 + dy, inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4)));
    }
  }
  const ap = ALIGN[ver];
  for (const r of ap) for (const c of ap) {
    if ((r === ap[0] && c === ap[0]) || (r === ap[0] && c === ap[ap.length - 1]) || (r === ap[ap.length - 1] && c === ap[0])) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(c + dx, r + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask) => {
    const data = (0 << 3) | mask; // foutcorrectie M = 0
    let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((data << 10) | rem) ^ 0x5412; const bit = (i) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const d = ((v >>> i) & 1) !== 0; const a = size - 11 + (i % 3); const b = Math.floor(i / 3); setF(a, b, d); setF(b, a, d); }
  }

  // 4. Gegevens plaatsen (zigzag van rechtsonder)
  const raw = Array.from({ length: size }, () => new Array(size).fill(false));
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const col = right - j; const up = ((right + 1) & 2) === 0; const row = up ? size - 1 - vert : vert;
      if (!fn[row][col] && k < stream.length) raw[row][col] = stream[k++] === 1;
    }
  }

  // 5. Beste masker kiezen
  const maskFn = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0];
  const build = (m) => Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => (fn[r][c] ? mod[r][c] : raw[r][c] !== maskFn[m](r, c))));
  const penalty = (g) => {
    let p = 0;
    const lines = [...g, ...Array.from({ length: size }, (_, c) => g.map((row) => row[c]))];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) { if (i < size && line[i] === line[i - 1]) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; } }
      const s = line.map((v) => (v ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) { let at = s.indexOf(pat); while (at >= 0) { p += 40; at = s.indexOf(pat, at + 1); } }
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) p += 3;
    const dark = g.flat().filter(Boolean).length; const total = size * size;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  };
  let best = 0; let bestP = Infinity;
  for (let m = 0; m < 8; m++) { const p = penalty(build(m)); if (p < bestP) { bestP = p; best = m; } }
  drawFormat(best);
  return build(best);
}
