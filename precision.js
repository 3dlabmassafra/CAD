/* Schizzo Precision — misure 2D da foto, deterministiche e verificabili
 *
 * Pipeline:
 *   1. luminanza
 *   2. contorno dell'oggetto (bounding box sub-pixel, con raffinamento ad isteresi)
 *   3. linee assiali persistenti (mediana del gradiente colonna/riga) → posizione sub-pixel
 *   4. bordi + cerchi (Hough) e blob metallici (ferramenta)
 *   5. simmetria, ortogonalizzazione, snap
 *   6. controllo qualità (QA) con esiti verificabili
 *
 * Nessuna dipendenza: gira nel browser (ImageData) e in Node (test).
 */
(function (global) {
  "use strict";

  const EPS = 1e-9;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function median(arr) {
    if (!arr.length) return NaN;
    const a = arr.slice().sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(arr) {
    if (!arr.length) return NaN;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }
  function stdev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / (arr.length - 1));
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }

  /* ---------------------------------------------------------------- 1. immagine */

  /** ImageData-like ({width,height,data}) → { w, h, L: Float32Array } */
  function toGray(img) {
    const w = img.width, h = img.height;
    const src = img.data;
    const L = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
      const a = src[i + 3];
      const l = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      L[p] = a === 255 || a === undefined ? l : l * (a / 255) + 255 * (1 - a / 255);
    }
    return { w, h, L };
  }

  /** Downscale (box filter) per portare l'immagine sotto maxDim. */
  function downscale(img, maxDim) {
    const w = img.width, h = img.height;
    const k = Math.max(w, h) / maxDim;
    if (k <= 1) return img;
    const nw = Math.max(8, Math.round(w / k)), nh = Math.max(8, Math.round(h / k));
    const out = { width: nw, height: nh, data: new Uint8ClampedArray(nw * nh * 4) };
    const src = img.data;
    for (let y = 0; y < nh; y++) {
      const y0 = Math.floor((y * h) / nh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
      for (let x = 0; x < nw; x++) {
        const x0 = Math.floor((x * w) / nw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * w + xx) * 4;
            r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
          }
        }
        const o = (y * nw + x) * 4;
        out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n;
      }
    }
    return out;
  }

  /* ------------------------------------------------------- 2. contorno oggetto */

  /**
   * Regione dell'oggetto: crescita di regione dal centro dell'immagine con
   * tolleranza sul singolo passo. Segue le sfumature morbide (ombre, riflessi)
   * e si ferma sui salti netti: è il modo più affidabile per isolare un pezzo
   * fotografato su uno sfondo, anche con cornici e aloni attorno alla foto.
   */
  function objectRegion(g) {
    const { w, h, L } = g;
    const n = w * h;
    /* rumore della superficie: differenze fra pixel vicini nella zona centrale */
    const diffs = [];
    const cx = (w / 2) | 0, cy = (h / 2) | 0;
    const half = Math.round(Math.min(w, h) * 0.18);
    for (let y = Math.max(1, cy - half); y < Math.min(h - 1, cy + half); y += 2) {
      for (let x = Math.max(1, cx - half); x < Math.min(w - 1, cx + half); x += 2) {
        diffs.push(Math.abs(L[y * w + x + 1] - L[y * w + x]));
      }
    }
    const base = median(diffs);
    const absDev = diffs.map((d) => Math.abs(d - base));
    const mad = median(absDev);
    const step = clamp(Math.max(5, 4 * mad + base), 5, 26);

    const mask = new Uint8Array(n);
    const seed = cy * w + cx;
    const stack = [seed];
    mask[seed] = 1;
    let count = 1;
    let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
    while (stack.length) {
      const c = stack.pop();
      const x = c % w, y = (c / w) | 0;
      const lc = L[c];
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nc = ny * w + nx;
        if (mask[nc]) continue;
        if (Math.abs(L[nc] - lc) > step) continue;
        mask[nc] = 1; count++;
        if (nx < x0) x0 = nx; if (nx > x1) x1 = nx;
        if (ny < y0) y0 = ny; if (ny > y1) y1 = ny;
        stack.push(nc);
      }
    }
    /* componente connessa principale del risultato (riempie buchi interni) */
    return { mask, box: { x0, y0, x1, y1 }, count, step, frac: count / n };
  }

  /** Raffina un lato del contorno con l'attraversamento sub-pixel fra livello interno ed esterno. */
  function refineSide(g, mask, side, box) {
    const { w, h, L } = g;
    const horiz = side === "left" || side === "right";
    /* direzione di marcia verso l'interno */
    const dx = horiz ? (side === "left" ? 1 : -1) : 0;
    const dy = horiz ? 0 : (side === "top" ? 1 : -1);
    const samples = [];
    const N = 64;
    for (let i = 0; i < N; i++) {
      const t = 0.1 + 0.8 * (i / (N - 1));
      let px, py;
      if (horiz) {
        py = Math.round(box.y0 + (box.y1 - box.y0) * t);
        px = Math.round(side === "left" ? box.x0 : box.x1);
      } else {
        px = Math.round(box.x0 + (box.x1 - box.x0) * t);
        py = Math.round(side === "top" ? box.y0 : box.y1);
      }
      const inside = [], outside = [];
      const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : L[y * w + x]);
      for (let k = 0; k < 6; k++) { const v = get(px + dx * k, py + dy * k); if (v != null) inside.push(v); }
      for (let k = 1; k <= 6; k++) { const v = get(px - dx * k, py - dy * k); if (v != null) outside.push(v); }
      if (inside.length < 3 || outside.length < 3) continue;
      const lIn = median(inside), lOut = median(outside);
      if (Math.abs(lIn - lOut) < 5) continue;
      const lv = (lIn + lOut) / 2;
      const rising = lIn > lOut;
      let prevV = get(px, py), prevK = 0, hitK = -1, hitV = null;
      for (let k = 1; k <= 8; k++) {
        const v = get(px - dx * k, py - dy * k);
        if (v == null) break;
        const out = rising ? v <= lv : v >= lv;
        if (out) { hitK = k; hitV = v; break; }
        prevV = v; prevK = k;
      }
      if (hitK < 0) continue;
      const d = clamp((lv - prevV) / ((hitV - prevV) || EPS), 0, 1);
      const pos = horiz ? (px - dx * (prevK + d)) : (py - dy * (prevK + d));
      samples.push(pos);
    }
    if (samples.length < 8) return null;
    const med = median(samples);
    const keep = samples.filter((v) => Math.abs(v - med) <= Math.max(2, stdev(samples) * 2));
    return { value: median(keep.length >= 4 ? keep : samples), spread: stdev(keep.length >= 4 ? keep : samples), n: keep.length };
  }

  /**
   * Bordo dell'oggetto lungo una linea di scansione.
   * Il livello "materiale" è la mediana della zona centrale della scansione.
   * Dal bordo verso l'interno si cerca il primo tratto che resta compatibile con
   * quel livello: quello è il pezzo. Il punto di bordo è l'intersezione sub-pixel
   * fra il livello esterno e quello interno, quindi robusto a bordi morbidi,
   * cornici bianche e aloni luminosi.
   */
  function scanEdge(vals, from, to, step, run) {
    const n = vals.length;
    const inside = (i) => i >= 0 && i < n;
    const span = Math.abs(to - from);
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const cs = Math.round(lo + span * 0.35), ce = Math.round(lo + span * 0.65);
    const coreSamples = [];
    for (let i = cs; i <= ce; i++) if (inside(i)) coreSamples.push(vals[i]);
    if (coreSamples.length < 4) return null;
    const deep = median(coreSamples);
    /* tolleranza adattiva: 3.2 × scarto assoluto mediano del materiale */
    const devs = coreSamples.map((v) => Math.abs(v - deep));
    const tol = Math.max(4, 3.2 * median(devs));

    let start = -1;
    for (let i = from; step > 0 ? i < to : i > to; i += step) {
      const last = i + step * (run - 1);
      if (!inside(last) || (step > 0 ? last >= to : last <= to)) break;
      let ok = true;
      for (let k = 0; k < run; k++) {
        if (Math.abs(vals[i + k * step] - deep) > tol) { ok = false; break; }
      }
      if (ok) { start = i; break; }
    }
    if (start < 0) return null;

    const outSamples = [];
    for (let k = 1; k <= 4; k++) {
      const j = start - k * step;
      if (inside(j)) outSamples.push(vals[j]);
    }
    const lOut = median(outSamples.length ? outSamples : [vals[start]]);
    const lIn = deep;
    if (Math.abs(lIn - lOut) < 4) return null;
    const lv = (lOut + lIn) / 2;
    const rising = lIn > lOut;

    let edge = start, prev = vals[start];
    for (let i = start, k = 0; k < 60 && inside(i); i -= step, k++) {
      const v = vals[i];
      const outside = rising ? v <= lv : v >= lv;
      if (outside && k > 0) {
        const d = (lv - v) / ((prev - v) || EPS);
        edge = i + clamp(d, 0, 1) * step;
        break;
      }
      prev = v;
    }
    return { at: edge, inner: lIn, outer: lOut, contrast: Math.abs(lIn - lOut) };
  }

  function objectBox(g) {
    const { w, h, L } = g;
    const at = (x, y) => L[y * w + x];
    const run = Math.max(4, Math.min(22, Math.round(Math.min(w, h) * 0.032)));
    const core = 0.16;                       /* banda centrale usata per le statistiche */
    const xA = Math.round(w * core), xB = Math.round(w * (1 - core));
    const yA = Math.round(h * core), yB = Math.round(h * (1 - core));

    /* contrasto tipico: escursione fra il 10° e il 90° percentile nella banda centrale */
    function rangeOf(vals) {
      const s = vals.slice().sort((a, b) => a - b);
      const a = s[Math.floor(s.length * 0.1)], b = s[Math.floor(s.length * 0.9)];
      return b - a;
    }
    const midRow = [], midCol = [];
    for (let x = xA; x < xB; x += 2) midRow.push(at(x, (h / 2) | 0));
    for (let y = yA; y < yB; y += 2) midCol.push(at((w / 2) | 0, y));
    const range = Math.max(rangeOf(midRow), rangeOf(midCol));

    const lefts = [], rights = [], tops = [], bots = [];
    const rowsN = 21, colsN = 21;
    const rowStep = Math.max(1, Math.floor(h / (rowsN + 1)));
    for (let y = Math.round(h * 0.06); y < h; y += rowStep) {
      const row = new Float32Array(w);
      for (let x = 0; x < w; x++) row[x] = at(x, y);
      const l = scanEdge(row, 0, w, 1, run);
      const r = scanEdge(row, w - 1, -1, -1, run);
      if (l) lefts.push(l.at);
      if (r) rights.push(r.at);
    }
    const colStep = Math.max(1, Math.floor(w / (colsN + 1)));
    for (let x = Math.round(w * 0.06); x < w; x += colStep) {
      const col = new Float32Array(h);
      for (let y = 0; y < h; y++) col[y] = at(x, y);
      const t = scanEdge(col, 0, h, 1, run);
      const b = scanEdge(col, h - 1, -1, -1, run);
      if (t) tops.push(t.at);
      if (b) bots.push(b.at);
    }
    if (lefts.length < 3 || rights.length < 3 || tops.length < 3 || bots.length < 3) return null;

    /* mediana + scarto: scarta le scansioni che hanno agganciato un'altra struttura */
    function robust(list) {
      let m = median(list);
      const dev = stdev(list);
      const keep = list.filter((v) => Math.abs(v - m) <= Math.max(2, dev * 2));
      return { value: median(keep.length ? keep : list), n: keep.length, spread: stdev(keep.length ? keep : list) };
    }
    const lx = robust(lefts), rx = robust(rights), ty = robust(tops), by = robust(bots);
    const x0 = lx.value, x1 = rx.value, y0 = ty.value, y1 = by.value;
    if (x1 - x0 < 12 || y1 - y0 < 12) return null;

    /* livelli interni/esterni per riferimento */
    const inSamples = [];
    for (let y = y0 + (y1 - y0) * 0.3; y < y0 + (y1 - y0) * 0.7; y += 3) {
      for (let x = x0 + (x1 - x0) * 0.3; x < x0 + (x1 - x0) * 0.7; x += 3) inSamples.push(at(x | 0, y | 0));
    }
    return {
      x0, y0, x1, y1, w: x1 - x0, h: y1 - y0,
      bgLevel: 0, objLevel: median(inSamples),
      spreadX: Math.max(lx.spread, rx.spread), spreadY: Math.max(ty.spread, by.spread),
      scans: { lefts: lefts.length, rights: rights.length, tops: tops.length, bots: bots.length },
      contrast: range
    };
  }

  /* ------------------------------------------------- 3. linee assiali persistenti */

  /**
   * Linee verticali/orizzontali dentro un box.
   * Profilo = gradiente mediano (robusto al testo/venatura), posizione sub-pixel con
   * fit parabolico sui tre campioni attorno al picco. Ritorna anche l'estensione
   * (dove il bordo esiste davvero) così da avere segmenti e non rette infinite.
   */
  function axisLines(g, box, opts) {
    opts = opts || {};
    const { w, h, L } = g;
    const minScore = opts.minScore == null ? 3.0 : opts.minScore;
    const minRun = opts.minRun == null ? 0.25 : opts.minRun;
    const x0 = clamp(Math.floor(box.x0), 0, w - 1), x1 = clamp(Math.ceil(box.x1), 0, w - 1);
    const y0 = clamp(Math.floor(box.y0), 0, h - 1), y1 = clamp(Math.ceil(box.y1), 0, h - 1);
    const mY = Math.max(2, Math.round((y1 - y0) * 0.16));
    const mX = Math.max(2, Math.round((x1 - x0) * 0.16));
    const yA = Math.max(1, y0 + mY), yB = Math.min(h - 2, y1 - mY);
    const xA = Math.max(1, x0 + mX), xB = Math.min(w - 2, x1 - mX);

    /* ---- verticali ---- */
    const vProf = [];             /* indice = x, valore = gradiente mediano */
    for (let x = Math.max(1, x0); x <= Math.min(w - 2, x1); x++) {
      const d = [];
      for (let y = yA; y <= yB; y++) d.push((L[y * w + x + 1] - L[y * w + x - 1]) / 2);
      vProf.push({ x, g: median(d) });
    }
    /* ---- orizzontali ---- */
    const hProf = [];
    for (let y = Math.max(1, y0); y <= Math.min(h - 2, y1); y++) {
      const d = [];
      for (let x = xA; x <= xB; x++) d.push((L[(y + 1) * w + x] - L[(y - 1) * w + x]) / 2);
      hProf.push({ y, g: median(d) });
    }

    function peaks(prof, key) {
      const n = prof.length;
      const out = [];
      const absg = prof.map((p) => Math.abs(p.g));
      for (let i = 1; i < n - 1; i++) {
        const a = absg[i - 1], b = absg[i], c = absg[i + 1];
        if (b < minScore || b < a || b < c) continue;
        if (b === a && b === c) continue;
        const denom = a - 2 * b + c;
        const d = Math.abs(denom) < 1e-6 ? 0 : (0.5 * (a - c)) / denom;
        const at = prof[i][key] + clamp(d, -1, 1);
        const sgn = prof[i].g >= 0 ? 1 : -1;
        out.push({ pos: at, score: b, sign: sgn, raw: prof[i][key] });
      }
      return out;
    }

    const vRaw = peaks(vProf, "x").filter((p) => p.pos > x0 - 2 && p.pos < x1 + 2);
    const hRaw = peaks(hProf, "y").filter((p) => p.pos > y0 - 2 && p.pos < y1 + 2);

    /* estensione dei segmenti: dove il gradiente locale è concorde e forte */
    function extentV(line) {
      const xs = Math.round(line.pos);
      let a = yA, b = yB;
      const step = 2;
      const thr = Math.max(1.2, line.score * 0.35);
      let cnt = 0, tot = 0;
      for (let y = y0 + 2; y <= y1 - 2; y += step) {
        tot++;
        const gi = (L[y * w + clamp(xs + 1, 0, w - 1)] - L[y * w + clamp(xs - 1, 0, w - 1)]) / 2;
        if (Math.abs(gi) > thr && Math.sign(gi) === line.sign) cnt++;
      }
      return tot ? (cnt * step) / (y1 - y0) : 1;
    }
    function extentH(line) {
      const ys = Math.round(line.pos);
      const step = 2;
      const thr = Math.max(1.2, line.score * 0.35);
      let cnt = 0, tot = 0;
      for (let x = x0 + 2; x <= x1 - 2; x += step) {
        tot++;
        const gi = (L[clamp(ys + 1, 0, h - 1) * w + x] - L[clamp(ys - 1, 0, h - 1) * w + x]) / 2;
        if (Math.abs(gi) > thr && Math.sign(gi) === line.sign) cnt++;
      }
      return tot ? (cnt * step) / (x1 - x0) : 1;
    }

    const vLines = vRaw.map((p) => ({
      pos: p.pos, score: r2(p.score), sign: p.sign,
      coverage: r2(extentV(p)), kind: "v"
    })).filter((p) => p.coverage >= minRun).sort((a, b) => a.pos - b.pos);

    const hLines = hRaw.map((p) => ({
      pos: p.pos, score: r2(p.score), sign: p.sign,
      coverage: r2(extentH(p)), kind: "h"
    })).filter((p) => p.coverage >= minRun).sort((a, b) => a.pos - b.pos);

    return { v: vLines, h: hLines };
  }

  /** Fonde linee più vicine di `tol` px in una sola (media pesata sull'intensità). */
  function mergeLines(lines, tol) {
    const out = [];
    for (const l of lines) {
      const last = out[out.length - 1];
      if (last && l.pos - last.pos <= tol) {
        const wsum = last.score + l.score;
        last.pos = (last.pos * last.score + l.pos * l.score) / (wsum || 1);
        last.score = Math.max(last.score, l.score);
        last.merged = (last.merged || 1) + 1;
      } else out.push({ ...l });
    }
    return out;
  }

  /* ------------------------------------------------------------- 4. blob metallici */

  /**
   * Ferramenta (maniglie, rosette, bocchette, cerniere): pixel chiari e poco saturi
   * dentro l'oggetto. Ritorna bounding box e centro, ordinati per area.
   */
  function hardwareBlobs(img, box, opts) {
    opts = opts || {};
    const w = img.width, h = img.height, data = img.data;
    const minPix = opts.minPix || Math.max(24, Math.round((w * h) / 20000));
    const x0 = clamp(Math.floor(box.x0 + 2), 0, w - 1), x1 = clamp(Math.ceil(box.x1 - 2), 0, w - 1);
    const y0 = clamp(Math.floor(box.y0 + 2), 0, h - 1), y1 = clamp(Math.ceil(box.y1 - 2), 0, h - 1);
    const BW = x1 - x0 + 1, BH = y1 - y0 + 1;

    /* soglia adattiva: luminanza alta rispetto al legno circostante */
    const Ls = [];
    for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) {
      const i = (y * w + x) * 4;
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      Ls.push({ l: (data[i] + data[i + 1] + data[i + 2]) / 3, sat: mx ? (mx - mn) / mx : 0 });
    }
    const lMed = median(Ls.map((p) => p.l));
    const thr = Math.max(150, lMed + 45);

    const mask = new Uint8Array(BW * BH);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        const r = data[i], gg = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        const sat = mx ? (mx - mn) / mx : 0;
        const l = (r + gg + b) / 3;
        if (l > thr && sat < 0.25) mask[(y - y0) * BW + (x - x0)] = 1;
      }
    }
    /* chiusura morfologica leggera per unire parti lucide frammentate */
    const tmp = new Uint8Array(mask);
    for (let y = 1; y < BH - 1; y++) for (let x = 1; x < BW - 1; x++) {
      if (!tmp[y * BW + x]) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += tmp[(y + dy) * BW + (x + dx)];
        if (n >= 6) mask[y * BW + x] = 1;
      }
    }

    const seen = new Uint8Array(BW * BH);
    const blobs = [];
    const stack = [];
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        const k = y * BW + x;
        if (!mask[k] || seen[k]) continue;
        stack.length = 0; stack.push(k); seen[k] = 1;
        let n = 0, sx = 0, sy = 0, ax0 = 1e9, ay0 = 1e9, ax1 = -1e9, ay1 = -1e9;
        while (stack.length) {
          const c = stack.pop();
          const cx = c % BW, cy = (c / BW) | 0;
          n++; sx += cx; sy += cy;
          if (cx < ax0) ax0 = cx; if (cy < ay0) ay0 = cy;
          if (cx > ax1) ax1 = cx; if (cy > ay1) ay1 = cy;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= BW || ny >= BH) continue;
            const kk = ny * BW + nx;
            if (mask[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
          }
        }
        if (n < minPix) continue;
        blobs.push({
          x: x0 + sx / n, y: y0 + sy / n, n,
          bx0: x0 + ax0, by0: y0 + ay0, bx1: x0 + ax1 + 1, by1: y0 + ay1 + 1,
          w: ax1 - ax0 + 1, h: ay1 - ay0 + 1,
          fill: n / Math.max(1, (ax1 - ax0 + 1) * (ay1 - ay0 + 1))
        });
      }
    }
    blobs.sort((a, b) => b.n - a.n);
    return blobs;
  }

  /* ------------------------------------------------------------------- 5. cerchi */

  /** Rilevazione cerchi (Hough per raggio): fori, rosette tonde, pomelli. */
  function findCircles(g, box, opts) {
    opts = opts || {};
    const { w, h, L } = g;
    const x0 = clamp(Math.floor(box.x0), 1, w - 2), x1 = clamp(Math.ceil(box.x1), 1, w - 2);
    const y0 = clamp(Math.floor(box.y0), 1, h - 2), y1 = clamp(Math.ceil(box.y1), 1, h - 2);
    const rMax = Math.min(opts.rMax || Math.min(x1 - x0, y1 - y0) * 0.35, Math.min(w, h) * 0.35);
    const rMin = opts.rMin || 3;
    if (rMax <= rMin) return [];

    /* punti di bordo con soppressione dei non-massimi */
    const pts = [];
    for (let y = y0 + 1; y < y1 - 1; y++) {
      for (let x = x0 + 1; x < x1 - 1; x++) {
        const gx = (L[y * w + x + 1] - L[y * w + x - 1]) / 2;
        const gy = (L[(y + 1) * w + x] - L[(y - 1) * w + x]) / 2;
        const m = Math.hypot(gx, gy);
        if (m < (opts.minMag || 7)) continue;
        const g2 = Math.abs((L[y * w + Math.min(w - 1, x + 2)] - L[y * w + Math.max(0, x - 2)]) / 4);
        const g3 = Math.abs((L[Math.min(h - 1, y + 2) * w + x] - L[Math.max(0, y - 2) * w + x]) / 4);
        if (m < g2 || m < g3) continue;
        pts.push({ x, y, gx, gy });
      }
    }
    if (pts.length < 30) return [];

    const radii = [];
    for (let r = rMin; r <= rMax; r *= 1.25) radii.push(Math.max(rMin, Math.round(r)));
    if (radii[radii.length - 1] < rMax * 0.92) radii.push(Math.round(rMax));

    const vote = [];
    for (const r of radii) {
      const accW = (x1 - x0) + 2 * r + 1, accH = (y1 - y0) + 2 * r + 1;
      const ox = x0 - r, oy = y0 - r;
      const acc = new Int32Array(accW * accH);
      for (const p of pts) {
        const nn = Math.hypot(p.gx, p.gy) || 1;
        const ux = p.gx / nn, uy = p.gy / nn;
        for (const s of [-1, 1]) {
          const cx = Math.round(p.x - ux * r * s) - ox, cy = Math.round(p.y - uy * r * s) - oy;
          if (cx < 0 || cy < 0 || cx >= accW || cy >= accH) continue;
          acc[cy * accW + cx]++;
        }
      }
      const need = Math.max(opts.minVotes || 10, Math.round(2 * Math.PI * r * (opts.coverage || 0.4)));
      const cand = [];
      for (let cy = 1; cy < accH - 1; cy++) {
        for (let cx = 1; cx < accW - 1; cx++) {
          const v = acc[cy * accW + cx];
          if (v < need) continue;
          if (v < acc[cy * accW + cx - 1] || v < acc[cy * accW + cx + 1] ||
              v < acc[(cy - 1) * accW + cx] || v < acc[(cy + 1) * accW + cx]) continue;
          cand.push({ cx: cx + ox, cy: cy + oy, r, votes: v });
        }
      }
      cand.sort((a, b) => b.votes - a.votes);
      for (const c of cand.slice(0, 6)) vote.push(c);
    }
    vote.sort((a, b) => b.votes - a.votes);

    const out = [];
    for (const c of vote) {
      if (out.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < Math.max(4, o.r * 0.7))) continue;
      /* verifica: frazione di circonferenza con bordo forte */
      let hit = 0, tot = 0;
      const N = Math.max(32, Math.round(2 * Math.PI * c.r));
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const px = Math.round(c.cx + Math.cos(a) * c.r), py = Math.round(c.cy + Math.sin(a) * c.r);
        if (px < 2 || py < 2 || px > w - 3 || py > h - 3) continue;
        tot++;
        const m = Math.hypot((L[py * w + px + 1] - L[py * w + px - 1]) / 2, (L[(py + 1) * w + px] - L[(py - 1) * w + px]) / 2);
        if (m > (opts.minMag || 7)) hit++;
      }
      const cov = tot ? hit / tot : 0;
      if (cov < (opts.minCov || 0.55)) continue;
      out.push({ cx: r2(c.cx), cy: r2(c.cy), r: r2(c.r), votes: c.votes, coverage: r2(cov) });
      if (out.length >= (opts.max || 16)) break;
    }
    return out;
  }

  /* ------------------------------------------------- 6. simmetria e regolarità */

  /**
   * Individua l'asse di simmetria verticale di un insieme di linee verticali
   * e regolarizza le coppie speculari.
   */
  function detectSymmetry(vLines, x0, x1) {
    if (vLines.length < 2) return { axis: (x0 + x1) / 2, pairs: [], ok: false };
    const center = (x0 + x1) / 2;
    const pairs = [];
    const used = new Set();
    for (let i = 0; i < vLines.length; i++) {
      if (used.has(i)) continue;
      let best = -1, bestScore = Infinity;
      for (let j = 0; j < vLines.length; j++) {
        if (i === j || used.has(j)) continue;
        const mirror = Math.abs(x1 - (vLines[j].pos - x0) + x0 * 0 - 0) * 0; /* noop, chiarezza */
        const m = x0 + x1 - vLines[j].pos;
        const d = Math.abs(m - vLines[i].pos);
        const pen = d / Math.max(1, (x1 - x0));
        if (pen < bestScore) { bestScore = pen; best = j; }
      }
      if (best >= 0 && bestScore < 0.04) {
        used.add(i); used.add(best);
        const a = vLines[i].pos, b = vLines[best].pos;
        pairs.push({ a, b, axis: (a + b) / 2, dev: Math.abs(x0 + x1 - a - b) / 2 });
      }
    }
    const axes = pairs.map((p) => p.axis);
    const axis = axes.length ? mean(axes) : center;
    const dev = axes.length ? stdev(axes) : 0;
    return { axis, pairs, ok: pairs.length >= 1 && dev < 1.5, dev: r2(dev) };
  }

  /** Regolarizza: allinea coppie speculari all'asse comune, senza spostare le linee esterne. */
  function regularizeSymmetry(lines, axis) {
    const out = lines.map((l) => ({ ...l }));
    const used = new Set();
    for (let i = 0; i < out.length; i++) {
      if (used.has(i)) continue;
      const m = 2 * axis - out[i].pos;
      let best = -1, bd = Infinity;
      for (let j = 0; j < out.length; j++) {
        if (i === j || used.has(j)) continue;
        const d = Math.abs(out[j].pos - m);
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0 && bd <= 1.6) {
        const avg = Math.abs(out[i].pos - axis) < Math.abs(out[best].pos - axis) ? out[i].pos : out[best].pos;
        const h = Math.abs(avg - axis);
        out[i].pos = axis - h; out[best].pos = axis + h;
        out[i].sym = true; out[best].sym = true;
        used.add(i); used.add(best);
      }
    }
    return out.sort((a, b) => a.pos - b.pos);
  }

  /* ------------------------------------------------------------------ 7. QA */

  /**
   * Metriche di verifica: quante linee sono davvero assiali, quanto è simmetrico,
   * quanto è pulito il contorno, quanto è coerente la scala.
   */
  function quality(analysis, refined) {
    const q = [];
    const t = analysis;
    q.push({
      id: "contorno", ok: !!t.box,
      label: "Contorno rilevato",
      detail: t.box ? `${r1(t.box.w)}×${r1(t.box.h)} px · ${t.box.source || "regione"}` + (t.box.snapped ? ` · ${t.box.snapped}/4 lati agganciati a linee` : "") : "oggetto non riconosciuto"
    });
    if (refined) {
      const worst = Math.max(...["left", "right", "top", "bottom"].map((k) => (refined[k] ? refined[k].spread : 0)));
      q.push({
        id: "bordo", ok: worst < 2.5,
        label: "Bordi stabili",
        detail: `scarto massimo ${r2(worst)} px sulle 4 fiancate`
      });
    }
    const vN = t.lines ? t.lines.v.length : 0, hN = t.lines ? t.lines.h.length : 0;
    q.push({
      id: "assi", ok: vN + hN >= 3,
      label: "Linee assiali persistenti",
      detail: `${vN} verticali · ${hN} orizzontali`
    });
    const sym = t.symmetry;
    q.push({
      id: "simmetria", ok: !!(sym && sym.ok),
      label: "Simmetria verticale",
      detail: sym ? `asse x=${r1(sym.axis)} · ${sym.pairs.length} coppie · scarto ${sym.dev} px` : "non valutata"
    });
    const hw = t.blobs || [];
    q.push({
      id: "ferramenta", ok: hw.length > 0,
      label: "Ferramenta riconosciuta",
      detail: hw.length ? hw.slice(0, 3).map((b) => `${Math.round(b.w)}×${Math.round(b.h)}px`).join(", ") : "nessun elemento metallico"
    });
    if (t.scale) {
      const s = t.scale;
      const errW = Math.abs(s.mmPerPxW - s.mmPerPx) / s.mmPerPx;
      const errH = Math.abs(s.mmPerPxH - s.mmPerPx) / s.mmPerPx;
      q.push({
        id: "scala", ok: Math.max(errW, errH) < 0.02,
        label: "Scala coerente su X e Y",
        detail: `${s.mmPerPx.toFixed(4)} mm/px · scarto X ${(errW * 100).toFixed(2)}% · Y ${(errH * 100).toFixed(2)}%`
      });
    }
    const errs = q.filter((x) => !x.ok).length;
    return { checks: q, errors: errs, ok: errs === 0 };
  }

  /* -------------------------------------------------------------------- API */

  /**
   * Contorno dalle linee persistenti più esterne.
   * Scarta gli "aloni" (bordini chiari/scuri di 2-4 px attorno alla foto) che
   * altrimenti gonfierebbero la misura di qualche millimetro.
   */
  function boxFromLines(lines, imgW, imgH, opts) {
    opts = opts || {};
    const usable = (l, lim) => l.pos > lim * 0.005 && l.pos < lim * 0.995 && l.coverage >= 0.4;
    const v = lines.v.filter((l) => usable(l, imgW)).sort((a, b) => a.pos - b.pos);
    const h = lines.h.filter((l) => usable(l, imgH)).sort((a, b) => a.pos - b.pos);
    if (v.length < 2 || h.length < 2) return null;
    const maxScore = Math.max(...v.map((l) => l.score), ...h.map((l) => l.score));
    const minScore = Math.max(3.2, maxScore * (opts.boxScoreRatio || 0.16));
    const vv = v.filter((l) => l.score >= minScore);
    const hh = h.filter((l) => l.score >= minScore);
    if (vv.length < 2 || hh.length < 2) return null;

    function lineBox(listV, listH) {
      const x0 = listV[0].pos, x1 = listV[listV.length - 1].pos;
      const y0 = listH[0].pos, y1 = listH[listH.length - 1].pos;
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
    }
    return { v: vv, h: hh, box: lineBox(vv, hh) };
  }

  function levelAt(g, x, y) {
    const xx = clamp(Math.round(x), 0, g.w - 1), yy = clamp(Math.round(y), 0, g.h - 1);
    return g.L[yy * g.w + xx];
  }

  /** Mediana dei livelli in una fascia (tra due linee), su tutta la lunghezza utile. */
  function bandLevel(g, a, b, horizontal) {
    const vals = [];
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi - lo < 0.5) return null;
    if (horizontal) {
      for (let y = Math.round(lo); y <= Math.round(hi); y++) {
        for (let t = 0.08; t <= 0.92; t += 0.02) vals.push(levelAt(g, g.w * t, y));
      }
    } else {
      for (let x = Math.round(lo); x <= Math.round(hi); x++) {
        for (let t = 0.08; t <= 0.92; t += 0.02) vals.push(levelAt(g, x, g.h * t));
      }
    }
    return vals.length ? median(vals) : null;
  }

  /** Toglie gli aloni esterni: fascia sottile, più chiara (o più scura) di entrambi i lati. */
  function haloTrim(g, edges, side) {
    const dim = side === "left" || side === "right" ? g.w : g.h;
    for (let pass = 0; pass < 2; pass++) {
      const outer = edges[0], inner = edges[1];
      if (!outer || !inner) return edges;
      const gap = Math.abs(inner - outer);
      if (gap > dim * 0.01) return edges;
      const horizontal = side === "top" || side === "bottom";
      const band = bandLevel(g, outer, inner, horizontal);
      const dir = side === "left" || side === "top" ? -1 : 1;   /* verso l'esterno */
      const outVals = [], inVals = [];
      for (let k = 2; k <= 7; k++) {
        const o = outer + dir * k;
        const ii = inner - dir * k;
        outVals.push(horizontal ? levelAt(g, g.w * 0.5, o) : levelAt(g, o, g.h * 0.5));
        inVals.push(horizontal ? levelAt(g, g.w * 0.5, ii) : levelAt(g, ii, g.h * 0.5));
      }
      const lOut = median(outVals), lIn = median(inVals);
      const brighter = band != null && band > lOut + 18 && band > lIn + 18;
      const darker = band != null && band < lOut - 18 && band < lIn - 18;
      if (brighter || darker) edges.shift();
      else return edges;
    }
    return edges;
  }

  function analyze(img, opts) {
    opts = opts || {};
    const work = opts.maxDim ? downscale(img, opts.maxDim) : img;
    const scaleDown = work === img ? 1 : img.width / work.width;
    const g = toGray(work);
    const W = work.width, H = work.height;

    /* 1. regione dell'oggetto (crescita dal centro) */
    const region = objectRegion(g);
    let box = null, refined = null;
    if (region && region.frac < 0.995 && region.box.x1 - region.box.x0 > 8 && region.box.y1 - region.box.y0 > 8) {
      const rl = refineSide(g, region.mask, "left", region.box);
      const rr = refineSide(g, region.mask, "right", region.box);
      const rt = refineSide(g, region.mask, "top", region.box);
      const rb = refineSide(g, region.mask, "bottom", region.box);
      if (rl && rr && rt && rb) {
        box = { x0: rl.value, y0: rt.value, x1: rr.value, y1: rb.value, source: "regione" };
        refined = { left: rl, right: rr, top: rt, bottom: rb };
      } else {
        box = { x0: region.box.x0, y0: region.box.y0, x1: region.box.x1, y1: region.box.y1, source: "regione" };
      }
      box.w = box.x1 - box.x0; box.h = box.y1 - box.y0;
    }

    /* 2. linee persistenti su tutta l'immagine */
    const margin = Math.max(2, Math.round(Math.min(W, H) * 0.012));
    const coarse = axisLines(g, { x0: margin, y0: margin, x1: W - margin, y1: H - margin }, opts);
    const linesAll = { v: mergeLines(coarse.v, opts.mergeTol || 2.2), h: mergeLines(coarse.h, opts.mergeTol || 2.2) };
    let boxLines = null;
    const lb = boxFromLines(linesAll, W, H, opts);
    if (lb) {
      /* toglie eventuali aloni esterni e ricostruisce il box */
      const vv = haloTrim(g, lb.v.map((l) => l.pos).slice(0, 2), "left");   /* lato sinistro: le prime due */
      const lv = lb.v.map((l) => l.pos);
      const lefts = haloTrim(g, lv, "left");
      const rights = haloTrim(g, lv.slice().reverse(), "right");
      const hhAll = lb.h.map((l) => l.pos);
      const tops = haloTrim(g, hhAll, "top");
      const bots = haloTrim(g, hhAll.slice().reverse(), "bottom");
      const x0 = lefts[0], x1 = rights[0], y0 = tops[0], y1 = bots[0];
      if (x1 - x0 > 10 && y1 - y0 > 10) {
        boxLines = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, source: "linee" };
      }
    }
    /* priorità: le linee sub-pixel sono la misura più fine; la regione conferma o integra */
    if (boxLines) {
      const agree = box && Math.abs(boxLines.x1 - boxLines.x0 - (box.x1 - box.x0)) < Math.min(W, H) * 0.08 &&
                            Math.abs(boxLines.y1 - boxLines.y0 - (box.y1 - box.y0)) < Math.min(W, H) * 0.08;
      box = boxLines;
      box.confirmed = agree;
    } else if (box) {
      box.w = box.x1 - box.x0; box.h = box.y1 - box.y0;
    }

    const res = {
      image: { w: W, h: H, scaleDown },
      box: box || null, boxLines, region: region ? { box: region.box, frac: region.frac, step: region.step } : null,
      lines: { v: [], h: [] }, linesAll, blobs: [], circles: [],
      symmetry: null, quality: null
    };
    if (!box) {
      res.quality = { checks: [{ id: "contorno", ok: false, label: "Contorno rilevato", detail: "oggetto non riconosciuto" }], errors: 1, ok: false };
      return res;
    }

    /* 3. linee interne all'oggetto */
    const inset = Math.max(3, Math.min(W, H) * 0.006);
    const inner = { x0: box.x0 + inset, y0: box.y0 + inset, x1: box.x1 - inset, y1: box.y1 - inset };
    const fine = axisLines(g, inner, opts);
    let v = mergeLines(fine.v, opts.mergeTol || 2.2);
    let h = mergeLines(fine.h, opts.mergeTol || 2.2);
    v = mergeLines([{ pos: box.x0, score: 60, sign: 0, coverage: 1, kind: "v", edge: true }, ...v,
                    { pos: box.x1, score: 60, sign: 0, coverage: 1, kind: "v", edge: true }], opts.mergeTol || 2.2);
    h = mergeLines([{ pos: box.y0, score: 60, sign: 0, coverage: 1, kind: "h", edge: true }, ...h,
                    { pos: box.y1, score: 60, sign: 0, coverage: 1, kind: "h", edge: true }], opts.mergeTol || 2.2);
    res.lines = { v, h };
    res.symmetry = detectSymmetry(v.filter((l) => !l.edge), box.x0, box.x1);
    if (res.symmetry.ok) res.lines.v = regularizeSymmetry(v, res.symmetry.axis);

    /* 4. ferramenta e cerchi */
    res.blobs = hardwareBlobs(work, box, opts);
    if (opts.circles !== false) res.circles = findCircles(g, box, opts);

    /* 5. QA */
    res.quality = quality(res, refined);
    return res;
  }

  /** Scala px → mm per un oggetto con larghezza/altezza note (mm). */
  function setScale(analysis, refWNominal, refHNominal, refWpx, refHpx) {
    const mmPerPxW = refWNominal / refWpx;
    const mmPerPxH = refHNominal / refHpx;
    analysis.scale = {
      refW: refWNominal, refH: refHNominal, refWpx, refHpx,
      mmPerPxW, mmPerPxH,
      mmPerPx: (mmPerPxW + mmPerPxH) / 2,
      aspectPx: refWpx / refHpx,
      aspectMm: refWNominal / refHNominal
    };
    analysis.quality = quality(analysis);
    return analysis.scale;
  }

  global.SchizzoPrecision = {
    toGray, downscale, objectBox, objectRegion, refineSide, boxFromLines, bandLevel, haloTrim, levelAt, axisLines, mergeLines, hardwareBlobs, findCircles,
    detectSymmetry, regularizeSymmetry, quality, analyze, setScale,
    median, mean, stdev, clamp, r1, r2
  };
})(typeof window !== "undefined" ? window : globalThis);
