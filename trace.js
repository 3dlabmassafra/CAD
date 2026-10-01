/* Schizzo — import foto e generazione schizzo 2D */
(function (global) {
  function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  function profileJumps(profile, minGap) {
    const n = profile.length;
    if (n < 8) return [];
    const d = new Array(n - 1);
    const abs = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      d[i] = profile[i + 1] - profile[i];
      abs[i] = Math.abs(d[i]);
    }
    const sorted = abs.slice().sort((a, b) => a - b);
    const thr = Math.max(3.5, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || 3.5);
    const idx = [];
    for (let i = 0; i < d.length; i++) if (abs[i] > thr) idx.push(i);
    const clusters = [];
    for (const i of idx) {
      if (!clusters.length || i - clusters[clusters.length - 1][clusters[clusters.length - 1].length - 1] > minGap) {
        clusters.push([i]);
      } else clusters[clusters.length - 1].push(i);
    }
    return clusters.map((c) => Math.round(c.reduce((a, b) => a + b, 0) / c.length));
  }

  function tracePhoto(img) {
    const maxW = 800;
    const s = Math.min(1, maxW / Math.max(1, img.naturalWidth || img.width));
    const w = Math.max(8, Math.round((img.naturalWidth || img.width) * s));
    const h = Math.max(8, Math.round((img.naturalHeight || img.height) * s));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    const border = [[], [], []];
    const edge = Math.max(2, Math.min(5, Math.floor(Math.min(w, h) * 0.01)));
    const addBorder = (x, y) => {
      const i = (y * w + x) * 4;
      border[0].push(data[i]); border[1].push(data[i + 1]); border[2].push(data[i + 2]);
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < edge || x >= w - edge || y < edge || y >= h - edge) addBorder(x, y);
    }
    const median = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] || 0;
    };
    const bg = border.map(median);
    const colCount = new Uint16Array(w), rowCount = new Uint16Array(h);
    const threshold2 = 42 * 42;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = lum(data[i], data[i + 1], data[i + 2]);
        L[y * w + x] = v;
        const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        if (dr * dr + dg * dg + db * db > threshold2) {
          colCount[x]++; rowCount[y]++;
        }
      }
    }
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const minMarks = 2;
    for (let x = 0; x < w; x++) if (colCount[x] >= minMarks) { minX = x; break; }
    for (let x = w - 1; x >= 0; x--) if (colCount[x] >= minMarks) { maxX = x; break; }
    for (let y = 0; y < h; y++) if (rowCount[y] >= minMarks) { minY = y; break; }
    for (let y = h - 1; y >= 0; y--) if (rowCount[y] >= minMarks) { maxY = y; break; }
    /* Uniform backgrounds and dark studio photos are both supported. */
    if (maxX - minX < 12 || maxY - minY < 12) {
      minX = w; minY = h; maxX = -1; maxY = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (L[y * w + x] <= 18) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX - minX < 12 || maxY - minY < 12) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const col = new Float32Array(bw);
    const row = new Float32Array(bh);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const v = L[y * w + x];
        col[x - minX] += v;
        row[y - minY] += v;
      }
    }
    for (let i = 0; i < bw; i++) col[i] /= bh;
    for (let i = 0; i < bh; i++) row[i] /= bw;

    const jx = profileJumps(col, 6);
    const jy = profileJumps(row, 6);
    const leftJ = jx.filter((j) => j > 4 && j < bw * 0.28);
    const rightJ = jx.filter((j) => j > bw * 0.72 && j < bw - 4);
    const topJ = jy.filter((j) => j > 4 && j < bh * 0.22);
    const botJ = jy.filter((j) => j > bh * 0.78 && j < bh - 4);
    let iL = leftJ.length ? leftJ[leftJ.length - 1] : Math.round(bw * 0.1);
    let iR = rightJ.length ? rightJ[0] : Math.round(bw * 0.9);
    let iT = topJ.length ? topJ[topJ.length - 1] : Math.round(bh * 0.08);
    let iB = botJ.length ? botJ[0] : Math.round(bh * 0.97);
    if (iR - iL < bw * 0.4) { iL = Math.round(bw * 0.1); iR = Math.round(bw * 0.9); }
    if (iB - iT < bh * 0.45) { iT = Math.round(bh * 0.08); iB = Math.round(bh * 0.96); }

    const hardware = [];
    for (let y = minY + iT; y <= minY + iB; y++) {
      for (let x = minX + iL; x <= minX + iR; x++) {
        const i = (y * w + x) * 4;
        const r = data[i], gv = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, gv, b), mn = Math.min(r, gv, b);
        const sat = mx ? (mx - mn) / mx : 0;
        if (mx > 165 && sat < 0.22) hardware.push({ x, y });
      }
    }
    let hw = [];
    if (hardware.length) {
      const visited = new Uint8Array(w * h);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const set = new Set(hardware.map((p) => p.y * w + p.x));
      for (const p of hardware) {
        const start = p.y * w + p.x;
        if (visited[start]) continue;
        const q = [p];
        visited[start] = 1;
        let sx = 0, sy = 0, n = 0, x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
        while (q.length) {
          const c0 = q.pop();
          sx += c0.x; sy += c0.y; n++;
          if (c0.x < x0) x0 = c0.x; if (c0.y < y0) y0 = c0.y;
          if (c0.x > x1) x1 = c0.x; if (c0.y > y1) y1 = c0.y;
          for (const [dx, dy] of dirs) {
            const nx = c0.x + dx, ny = c0.y + dy;
            const k = ny * w + nx;
            if (!set.has(k) || visited[k]) continue;
            visited[k] = 1;
            q.push({ x: nx, y: ny });
          }
        }
        if (n >= 18) hw.push({ x: sx / n, y: sy / n, w: x1 - x0 + 1, h: y1 - y0 + 1, n });
      }
      hw.sort((a, b) => b.n - a.n);
      hw = hw.slice(0, 6);
    }

    const aspect = bh / bw;
    const kind = aspect >= 1.75 && aspect <= 3.6 ? "door" : "rect";
    return {
      kind,
      imgW: img.naturalWidth || img.width,
      imgH: img.naturalHeight || img.height,
      px: { minX, minY, maxX, maxY, w, h, s },
      inner: { l: iL, r: iR, t: iT, b: iB },
      outer: { w: bw, h: bh },
      hardware: hw,
      aspect
    };
  }

  function round2(v) { return Math.round(v * 100) / 100; }
  function validMeasure(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function entitiesFromTrace(tr, spec) {
    if (!tr) return null;
    spec = spec || {};
    const isDoor = tr.kind === "door";
    const outerWpx = Math.max(1, tr.outer.w);
    const outerHpx = Math.max(1, tr.outer.h);
    const leafL = isDoor ? tr.inner.l : 0;
    const leafR = isDoor ? tr.inner.r : tr.outer.w;
    const leafT = isDoor ? tr.inner.t : 0;
    const leafB = isDoor ? tr.inner.b : tr.outer.h;
    const leafPxW = Math.max(1, leafR - leafL);
    const leafPxH = Math.max(1, leafB - leafT);
    let knownW = validMeasure(spec.w);
    let knownH = validMeasure(spec.h);
    const inputW = knownW, inputH = knownH;
    let scaleX, scaleY, estimated = false;
    const warnings = [];

    if (knownW && knownH) {
      scaleX = knownW / leafPxW;
      scaleY = knownH / leafPxH;
      const photoRatio = leafPxW / leafPxH;
      const givenRatio = knownW / knownH;
      if (Math.abs(givenRatio / photoRatio - 1) > 0.03) {
        warnings.push("Le due misure inserite non hanno lo stesso rapporto della foto: larghezza e altezza sono state rispettate separatamente.");
      }
    } else if (knownW) {
      scaleX = scaleY = knownW / leafPxW;
      knownH = leafPxH * scaleY;
    } else if (knownH) {
      scaleX = scaleY = knownH / leafPxH;
      knownW = leafPxW * scaleX;
    } else {
      estimated = true;
      if (isDoor) {
        scaleX = scaleY = 2100 / leafPxH;
        knownH = 2100;
        knownW = leafPxW * scaleX;
        warnings.push("Scala indicativa: per la porta è stata usata un'altezza convenzionale di 2100 mm. Verifica una misura reale prima dell'esportazione.");
      } else {
        scaleX = scaleY = 100 / Math.max(outerWpx, outerHpx);
        knownW = leafPxW * scaleX;
        knownH = leafPxH * scaleY;
        warnings.push("Scala indicativa: l'oggetto è stato dimensionato a 100 mm sul lato maggiore. Imposta una misura reale prima di usare il file per produzione.");
      }
    }
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
      throw new Error("Misure non valide: larghezza e altezza devono essere numeri positivi in millimetri.");
    }

    const left = round2(leafL * scaleX);
    const bottom = round2((outerHpx - leafB) * scaleY);
    const leafW = inputW ? inputW : round2(leafPxW * scaleX);
    const leafH = inputH ? inputH : round2(leafPxH * scaleY);
    const OW = round2(outerWpx * scaleX);
    const OH = round2(outerHpx * scaleY);
    const E = [];
    const L0 = "0", FOTO = "foto", FER = "ferramenta", Q = "quote";
    E.push({ type: "image", x: 0, y: 0, w: OW, h: OH, opacity: 0.38, layer: FOTO, lockedHit: true });
    E.push({ type: "polyline", closed: true, layer: L0,
      points: [{ x: 0, y: 0 }, { x: OW, y: 0 }, { x: OW, y: OH }, { x: 0, y: OH }] });
    if (isDoor) E.push({ type: "rect", x: left, y: bottom, w: leafW, h: leafH, rot: 0, layer: L0 });

    const toCad = (px, py) => ({
      x: round2((px - tr.px.minX) * scaleX),
      y: round2((tr.px.maxY - py) * scaleY)
    });
    let handleCenter = null;
    if (isDoor && tr.hardware && tr.hardware.length) {
      const hs = tr.hardware.slice().sort((a, b) => a.y - b.y);
      const handle = hs[0];
      const lock = hs.length > 1 ? hs[1] : null;
      handleCenter = toCad(handle.x, handle.y);
      E.push({ type: "circle", cx: handleCenter.x, cy: handleCenter.y, r: 18, layer: FER, role: "door-hardware" });
      const leverW = Math.max(80, Math.min(180, round2(handle.w * scaleX)));
      const leverH = Math.max(10, Math.min(28, round2(handle.h * scaleY)));
      const dir = handleCenter.x < left + leafW / 2 ? 1 : -1;
      const lx = dir > 0 ? handleCenter.x : handleCenter.x - leverW;
      E.push({ type: "rect", x: lx, y: handleCenter.y - leverH / 2, w: leverW, h: leverH, rot: 0, layer: FER, role: "door-hardware" });
      if (lock) {
        const lc = toCad(lock.x, lock.y);
        E.push({ type: "rect", x: lc.x - 13, y: lc.y - 16, w: 26, h: 32, rot: 0, layer: FER, role: "door-hardware" });
        E.push({ type: "circle", cx: lc.x, cy: lc.y, r: 6, layer: FER, role: "door-hardware" });
      }
      const hingeX = handleCenter.x < left + leafW / 2 ? left + leafW - 4 : left - 16;
      [0.12, 0.5, 0.88].forEach((t) => {
        const y = bottom + leafH * t;
        E.push({ type: "rect", x: hingeX, y: y - 15, w: 20, h: 30, rot: 0, layer: FER, role: "hinge" });
      });
      E.push({ type: "dimension", x1: left, y1: bottom, x2: left, y2: handleCenter.y, offset: -28, layer: Q, role: "handle-dim" });
    } else if (tr.hardware) {
      tr.hardware.slice(0, 4).forEach((hw) => {
        const p = toCad(hw.x, hw.y);
        E.push({ type: "circle", cx: p.x, cy: p.y, r: Math.max(2, round2(Math.max(hw.w * scaleX, hw.h * scaleY) / 2)), layer: FER });
      });
    }

    E.push({ type: "dimension", x1: 0, y1: 0, x2: OW, y2: 0, offset: -40, layer: Q });
    E.push({ type: "dimension", x1: 0, y1: 0, x2: 0, y2: OH, offset: -40, layer: Q });
    if (isDoor) {
      E.push({ type: "dimension", x1: left, y1: bottom, x2: left + leafW, y2: bottom, offset: 24, layer: Q });
      E.push({ type: "dimension", x1: left + leafW, y1: bottom, x2: left + leafW, y2: bottom + leafH, offset: 24, layer: Q });
    }

    const calibration = estimated ? "scala indicativa" : (validMeasure(spec.w) && validMeasure(spec.h) ? "due quote inserite" : "una quota inserita; proporzioni dalla foto");
    const featureName = isDoor ? "anta" : "ingombro";
    const note = `${isDoor ? "Porta" : "Oggetto"}: ${featureName} ${round2(validMeasure(spec.w) || leafW)}×${round2(validMeasure(spec.h) || leafH)} mm · ${calibration}`;
    E.push({ type: "text", x: Math.max(0, OW / 2 - 90), y: OH + 18, text: note, height: 14, rot: 0, layer: Q });
    warnings.push("Da una sola immagine non si ricavano profondità, prospettiva o parti nascoste: controlla il disegno prima dell'uso tecnico.");
    if (isDoor && (!tr.hardware || tr.hardware.length < 2)) {
      warnings.push("Ferramenta non rilevata con sufficiente confidenza; verifica maniglia e serratura.");
    }

    return {
      entities: E, width: OW, height: OH, leafW, leafH, note, kind: tr.kind,
      thickness: validMeasure(spec.thickness) || (isDoor ? 40 : 5), warnings,
      quality: {
        estimated,
        feature: featureName,
        inputWidth: validMeasure(spec.w),
        inputHeight: validMeasure(spec.h),
        featureWidth: leafW,
        featureHeight: leafH,
        overallWidth: OW,
        overallHeight: OH,
        scaleX, scaleY
      }
    };
  }

  /** Porta interna misurata dalla foto ComprePorte (anta 800×2100). */
  function doorElevation() {
    const leafW = 800, leafH = 2100;
    const left = 110, right = 114, bottom = 33, top = 128;
    const OW = left + leafW + right, OH = bottom + leafH + top;
    const hx = left + 47, hy = bottom + 1019;
    const lx = left + 47, ly = bottom + 929;
    const E = [];
    const L0 = "0", FER = "ferramenta", Q = "quote", FOTO = "foto";
    E.push({
      type: "image", x: 0, y: 0, w: OW, h: OH,
      src: "porta.jpg", opacity: 0.4, layer: FOTO
    });
    E.push({
      type: "polyline", closed: true, layer: L0,
      points: [{ x: 0, y: 0 }, { x: OW, y: 0 }, { x: OW, y: OH }, { x: 0, y: OH }]
    });
    E.push({ type: "rect", x: left, y: bottom, w: leafW, h: leafH, rot: 0, layer: L0 });
    E.push({ type: "circle", cx: hx, cy: hy, r: 18, layer: FER, role: "door-hardware" });
    E.push({ type: "rect", x: hx, y: hy - 10, w: 128, h: 20, rot: 0, layer: FER, role: "door-hardware" });
    E.push({ type: "rect", x: lx - 13, y: ly - 16, w: 26, h: 32, rot: 0, layer: FER, role: "door-hardware" });
    E.push({ type: "circle", cx: lx, cy: ly, r: 6, layer: FER, role: "door-hardware" });
    [250, 1050, 1850].forEach((yy) => {
      E.push({ type: "rect", x: left + leafW - 4, y: bottom + yy - 15, w: 20, h: 30, rot: 0, layer: FER, role: "hinge" });
    });
    E.push({ type: "dimension", x1: 0, y1: 0, x2: OW, y2: 0, offset: -50, layer: Q });
    E.push({ type: "dimension", x1: 0, y1: 0, x2: 0, y2: OH, offset: -50, layer: Q });
    E.push({ type: "dimension", x1: left, y1: bottom, x2: left + leafW, y2: bottom, offset: 30, layer: Q });
    E.push({ type: "dimension", x1: left + leafW, y1: bottom, x2: left + leafW, y2: bottom + leafH, offset: 30, layer: Q });
    E.push({ type: "dimension", x1: left, y1: bottom, x2: left, y2: hy, offset: -30, layer: Q, role: "handle-dim" });
    E.push({ type: "text", x: 20, y: OH + 22, text: "Porta interna a battente · anta 800×2100 · maniglia H 1019 · backset 47", height: 16, rot: 0, layer: Q });
    return { entities: E, width: OW, height: OH, name: "porta-interna" };
  }

  function parsePrompt(text) {
    const raw = String(text || "");
    const t = raw.toLowerCase().replace(/\u00a0/g, " ");
    const spec = { raw };
    const number = "(\\d+(?:[.,]\\d+)?)";
    const unit = "(mm|millimetri?|cm|centimetri?|m|metri?|inch(?:es)?|in|pollici?)";
    const toMm = (value, u) => {
      const n = parseFloat(String(value).replace(",", "."));
      if (!Number.isFinite(n)) return null;
      const v = String(u || "mm").toLowerCase();
      if (/^(cm|centimetri?)$/.test(v)) return n * 10;
      if (/^(m|metri?)$/.test(v)) return n * 1000;
      if (/^(in|inch(?:es)?|pollici?)$/.test(v)) return n * 25.4;
      return n;
    };
    let m = t.match(new RegExp(`${number}\\s*${unit}?\\s*[x×*]\\s*${number}\\s*${unit}?`, "i"));
    if (m) {
      const shared = m[4] || m[2] || "mm";
      spec.w = toMm(m[1], m[2] || shared);
      spec.h = toMm(m[3], m[4] || shared);
    }
    const readNamed = (pattern) => {
      const hit = t.match(pattern);
      return hit ? toMm(hit[1], hit[2]) : null;
    };
    if (!spec.w) spec.w = readNamed(new RegExp(`(?:larghezza|width)\\s*[:=]?\\s*${number}\\s*${unit}?`, "i"));
    if (!spec.h) spec.h = readNamed(new RegExp(`(?:altezza|height)\\s*[:=]?\\s*${number}\\s*${unit}?`, "i"));
    m = t.match(new RegExp(`(?:spess(?:ore)?|\\bsp\\.?|thick(?:ness)?)\\s*[:=]?\\s*${number}\\s*${unit}?`, "i"));
    if (m) spec.thickness = toMm(m[1], m[2]);
    m = t.match(new RegExp(`[ø⌀]\\s*${number}\\s*${unit}?|diam(?:etro)?\\s*${number}\\s*${unit}?`, "i"));
    if (m) spec.hole = toMm(m[1] || m[3], m[2] || m[4]);
    m = t.match(/(\d+)\s*for[oi]/i);
    if (m) spec.holeN = parseInt(m[1], 10);
    m = t.match(/\br\s*[=:]?\s*(\d+(?:[.,]\d+)?)|raccord\w*\s*(\d+(?:[.,]\d+)?)/i);
    if (m) spec.radius = parseFloat(String(m[1] || m[2]).replace(",", "."));
    m = t.match(new RegExp(`manigl\\w*\\s*(?:a\\s*|h\\s*|ad\\s*)?${number}\\s*${unit}?`, "i"));
    if (m) spec.handleH = toMm(m[1], m[2]);
    if (/porta|door|anta|battente/i.test(t)) spec.kind = "door";
    else if (/piastr|plate|flangia|staffa|gasket|guarniz/i.test(t)) spec.kind = "rect";
    if (/schizzo a mano|sketch|disegno tecnico|blueprint|napkin/i.test(t)) spec.kind = spec.kind || "sketch";
    return spec;
  }

  function rdp(pts, eps) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    const sq = eps * eps;
    function d2(a, b, p) {
      const abx = b.x - a.x, aby = b.y - a.y;
      const len = abx * abx + aby * aby || 1e-12;
      let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len;
      t = Math.max(0, Math.min(1, t));
      const x = a.x + t * abx, y = a.y + t * aby;
      const dx = p.x - x, dy = p.y - y;
      return dx * dx + dy * dy;
    }
    function rec(a, b) {
      let max = -1, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = d2(pts[a], pts[b], pts[i]);
        if (d > max) { max = d; idx = i; }
      }
      if (max > sq && idx > 0) return rec(a, idx).concat(rec(idx, b).slice(1));
      return [pts[a], pts[b]];
    }
    return rec(0, pts.length - 1);
  }

  function vectorizeSketch(img, spec) {
    const maxW = 900;
    const s = Math.min(1, maxW / Math.max(1, img.naturalWidth || img.width));
    const w = Math.max(8, Math.round((img.naturalWidth || img.width) * s));
    const h = Math.max(8, Math.round((img.naturalHeight || img.height) * s));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    let mean = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      L[p] = lum(data[i], data[i + 1], data[i + 2]);
      mean += L[p];
    }
    mean /= w * h;
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gx = L[y * w + x + 1] - L[y * w + x - 1];
        const gy = L[(y + 1) * w + x] - L[(y - 1) * w + x];
        mag[y * w + x] = Math.hypot(gx, gy);
      }
    }
    const inkDark = mean > 110;
    const bin = new Uint8Array(w * h);
    const thr = inkDark ? 28 : 22;
    for (let i = 0; i < mag.length; i++) {
      if (mag[i] > thr) bin[i] = 1;
      else if (inkDark && L[i] < mean * 0.55) bin[i] = 1;
    }
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const seen = new Uint8Array(w * h);
    const contours = [];
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!inside(x, y) || seen[y * w + x] || inside(x - 1, y)) continue;
        const cnt = [];
        let cx = x, cy = y, dir = 0, guard = 0;
        do {
          seen[cy * w + cx] = 1;
          cnt.push({ x: cx, y: cy });
          let found = false;
          for (let k = 0; k < 8; k++) {
            const nd = (dir + 6 + k) % 8;
            const nx = cx + dirs[nd][0], ny = cy + dirs[nd][1];
            if (inside(nx, ny)) { cx = nx; cy = ny; dir = nd; found = true; break; }
          }
          if (!found) break;
        } while ((cx !== x || cy !== y) && ++guard < w * h);
        if (cnt.length >= 18) contours.push(cnt);
      }
    }
    contours.sort((a, b) => b.length - a.length);
    const keep = contours.slice(0, 12);
    const knownW = validMeasure(spec && spec.w);
    const knownH = validMeasure(spec && spec.h);
    let sx, sy;
    if (knownW && knownH) { sx = knownW / w; sy = knownH / h; }
    else if (knownW) { sx = sy = knownW / w; }
    else if (knownH) { sx = sy = knownH / h; }
    else { sx = sy = 100 / Math.max(w, h); }
    const E = [];
    keep.forEach((cnt) => {
      const simp = rdp(cnt, 1.8);
      if (simp.length < 3) return;
      const pts = simp.map((p) => ({ x: round2(p.x * sx), y: round2((h - p.y) * sy) }));
      const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 2 * Math.max(sx, sy);
      if (closed && pts.length > 2) pts.pop();
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const rw = Math.max(...xs) - Math.min(...xs), rh = Math.max(...ys) - Math.min(...ys);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
      const rAvg = rs.reduce((a, b) => a + b, 0) / rs.length;
      const rDev = Math.sqrt(rs.reduce((a, b) => a + (b - rAvg) * (b - rAvg), 0) / rs.length) / (rAvg || 1);
      const uniformScale = Math.abs(sx - sy) / Math.max(sx, sy) < 0.005;
      if (closed && rDev < 0.12 && rAvg > 2 && uniformScale) {
        E.push({ type: "circle", cx: round2(cx), cy: round2(cy), r: round2(rAvg), layer: "0" });
      } else {
        E.push({ type: "polyline", points: pts, closed: closed && pts.length >= 3, layer: "0" });
      }
    });
    const width = round2(w * sx), height = round2(h * sy);
    const note = `Vettorializzato dallo schizzo (${E.length} profili) · ${width}×${height} mm`;
    E.push({ type: "text", x: 0, y: -12, text: note, height: 4, rot: 0, layer: "quote" });
    const warnings = [];
    if (!knownW && !knownH) warnings.push("Scala indicativa: il lato maggiore è stato impostato a 100 mm. Inserisci una misura reale prima dell'uso tecnico.");
    else if (!(knownW && knownH)) warnings.push("Una sola quota è stata inserita; le altre proporzioni dipendono dalla foto.");
    else if (Math.abs((knownW / knownH) / (w / h) - 1) > 0.03) warnings.push("Le quote inserite non hanno lo stesso rapporto della foto; il disegno è stato adattato ai due valori.");
    warnings.push("Verifica i contorni vettorializzati: sfondo, ombre e tratti sovrapposti possono creare segmenti non desiderati.");
    return {
      entities: E, kind: "sketch", note, warnings,
      thickness: validMeasure(spec && spec.thickness) || 5,
      width, height,
      quality: { estimated: !knownW && !knownH, inputWidth: knownW, inputHeight: knownH, overallWidth: width, overallHeight: height, scaleX: sx, scaleY: sy }
    };
  }

  function applySpec(built, spec) {
    if (!built || !spec) return built;
    const thickness = validMeasure(spec.thickness);
    if (thickness) built.thickness = thickness;
    const ents = built.entities || [];
    let leaf = ents.find((e) => e.type === "rect" && e.layer === "0" && (e.h || 0) >= (e.w || 0));
    const targetW = validMeasure(spec.w), targetH = validMeasure(spec.h);
    const fallbackProfile = !leaf && ents.find((e) => (e.type === "polyline" || e.type === "polygon") && e.closed && e.layer === "0" && e.points && e.points.length >= 3);
    let refX = leaf ? leaf.x : 0, refY = leaf ? leaf.y : 0;
    let refW = leaf ? leaf.w : 0, refH = leaf ? leaf.h : 0;
    if (fallbackProfile) {
      const xs = fallbackProfile.points.map((p) => p.x), ys = fallbackProfile.points.map((p) => p.y);
      refX = Math.min(...xs); refY = Math.min(...ys);
      refW = Math.max(...xs) - refX; refH = Math.max(...ys) - refY;
    }
    if ((leaf || fallbackProfile) && (targetW || targetH)) {
      const fx = targetW ? targetW / Math.max(refW, 1e-9) : targetH / Math.max(refH, 1e-9);
      const fy = targetH ? targetH / Math.max(refH, 1e-9) : fx;
      const anchor = { x: refX, y: refY };
      const map = (p) => ({ x: anchor.x + (p.x - anchor.x) * fx, y: anchor.y + (p.y - anchor.y) * fy });
      ents.forEach((e) => {
        if (e.type === "rect" || e.type === "image") {
          const p0 = map({ x: e.x, y: e.y });
          const p1 = map({ x: e.x + e.w, y: e.y + e.h });
          e.x = p0.x; e.y = p0.y; e.w = p1.x - p0.x; e.h = p1.y - p0.y;
        } else if (e.type === "circle") {
          const c = map({ x: e.cx, y: e.cy });
          e.cx = c.x; e.cy = c.y;
          if (Math.abs(fx - fy) < 1e-9) e.r *= fx;
          else { e.type = "ellipse"; e.rx = e.r * fx; e.ry = e.r * fy; e.rot = 0; delete e.r; }
        } else if (e.type === "ellipse") {
          const c = map({ x: e.cx, y: e.cy });
          e.cx = c.x; e.cy = c.y; e.rx *= fx; e.ry *= fy;
        } else if (e.type === "polyline" || e.type === "polygon" || e.type === "spline") {
          e.points = (e.points || []).map(map);
        } else if (e.type === "line" || e.type === "dimension") {
          const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
          const p0 = map({ x: e.x1, y: e.y1 }), p1 = map({ x: e.x2, y: e.y2 });
          e.x1 = p0.x; e.y1 = p0.y; e.x2 = p1.x; e.y2 = p1.y;
          if (e.type === "dimension") {
            const len = Math.hypot(dx, dy) || 1;
            e.offset = (e.offset || 0) * Math.hypot((-dy / len) * fx, (dx / len) * fy);
          }
        } else if (e.type === "text") {
          const p = map({ x: e.x, y: e.y });
          e.x = p.x; e.y = p.y; e.height = (e.height || 4) * Math.sqrt(fx * fy);
        }
      });
      built.leafW = targetW || round2(refW * fx);
      built.leafH = targetH || round2(refH * fy);
      if (!leaf) {
        built.width = targetW || round2((built.width || refW) * fx);
        built.height = targetH || round2((built.height || refH) * fy);
      }
    }

    leaf = ents.find((e) => e.type === "rect" && e.layer === "0" && (e.h || 0) >= (e.w || 0));
    const handleHeight = validMeasure(spec.handleH);
    if (leaf && handleHeight) {
      const handles = ents.filter((e) => e.layer === "ferramenta" && e.type === "circle" && e.role === "door-hardware");
      const fallback = handles.length ? handles : ents.filter((e) => e.layer === "ferramenta" && e.type === "circle");
      const primary = fallback.sort((a, b) => b.cy - a.cy)[0];
      if (primary) {
        const oldY = primary.cy;
        const dy = leaf.y + handleHeight - oldY;
        ents.forEach((e) => {
          const isHardware = e.role === "door-hardware" || (!e.role && e.layer === "ferramenta" && e.type !== "rect");
          if (isHardware) {
            if (e.cy != null) e.cy += dy;
            if (e.y != null) e.y += dy;
            if (e.y1 != null) { e.y1 += dy; e.y2 += dy; }
          }
          if (e.type === "dimension" && (e.role === "handle-dim" || (Math.abs((e.y2 || 0) - oldY) < 8 && Math.abs(e.x1 - leaf.x) < 2))) e.y2 += dy;
        });
      }
    }
    if (spec.raw) {
      const txt = ents.find((e) => e.type === "text");
      if (txt) txt.text = `${built.note || ""} · ${String(spec.raw).slice(0, 100)}`;
    }
    return built;
  }

  function validateGenerated(built) {
    if (!built || !Array.isArray(built.entities)) throw new Error("Non è stato possibile generare un disegno dalla foto.");
    const numericKeys = ["x", "y", "w", "h", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "offset", "height"];
    for (const e of built.entities) {
      for (const k of numericKeys) if (e[k] != null && !Number.isFinite(e[k])) throw new Error("Il disegno contiene una coordinata non valida; nessun file è stato creato.");
      if (e.points && e.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Il contorno contiene coordinate non valide.");
      if (e.type === "rect" && (e.w <= 0 || e.h <= 0)) throw new Error("È stato rilevato un rettangolo con misure nulle.");
    }
    const hasGeometry = built.entities.some((e) => ["line", "rect", "circle", "ellipse", "polyline", "polygon", "spline"].includes(e.type));
    if (!hasGeometry) throw new Error("Nessun contorno riconoscibile. Prova con una foto più nitida o un disegno tecnico frontale.");
    const hasClosedProfile = built.entities.some((e) => e.type === "rect" || e.type === "circle" || e.type === "ellipse" || ((e.type === "polyline" || e.type === "polygon") && e.closed));
    if (!hasClosedProfile) built.warnings = (built.warnings || []).concat("Nessun profilo chiuso rilevato: Onshape importerà lo schizzo, ma non potrà estrudere i tratti aperti.");
    return built;
  }

  function generateFromImage(img, promptText, options) {
    const spec = parsePrompt(promptText);
    options = options || {};
    const w = validMeasure(options.width != null ? options.width : options.w);
    const h = validMeasure(options.height != null ? options.height : options.h);
    if (w) spec.w = w;
    if (h) spec.h = h;
    if (["door", "rect", "sketch"].includes(options.kind)) spec.kind = options.kind;
    const thickness = validMeasure(options.thickness);
    if (thickness) spec.thickness = thickness;
    const allowEstimate = !!options.allowEstimate;
    if (!validMeasure(spec.w) && !validMeasure(spec.h) && !allowEstimate) {
      throw new Error("Per mantenere la scala corretta, inserisci almeno una misura reale in millimetri. Una sola quota mantiene le proporzioni della foto.");
    }

    let built;
    if (spec.kind === "sketch") {
      built = vectorizeSketch(img, spec);
    } else {
      const tr = tracePhoto(img);
      if (!tr) throw new Error("Non riesco a trovare un contorno nell'immagine. Usa una foto frontale, ben illuminata, con il pezzo separato dallo sfondo.");
      if (spec.kind && spec.kind !== "sketch") tr.kind = spec.kind;
      built = entitiesFromTrace(tr, spec);
    }
    if (!built) throw new Error("Nessun disegno generato dall'immagine.");
    if (spec.handleH) applySpec(built, { handleH: spec.handleH });
    built.thickness = thickness || built.thickness || (built.kind === "door" ? 40 : 5);
    built = validateGenerated(built);
    return built;
  }

  global.SchizzoTrace = {
    tracePhoto, entitiesFromTrace, doorElevation,
    parsePrompt, applySpec, generateFromImage, vectorizeSketch
  };
})(typeof window !== "undefined" ? window : globalThis);
