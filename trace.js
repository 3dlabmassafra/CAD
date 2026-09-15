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
    let minX = w, minY = h, maxX = 0, maxY = 0;
    const L = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = lum(data[i], data[i + 1], data[i + 2]);
        L[y * w + x] = v;
        if (v > 18) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
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

  function round1(v) { return Math.round(v * 10) / 10; }

  function entitiesFromTrace(tr) {
    if (!tr) return null;
    const leafPxW = tr.inner.r - tr.inner.l;
    const leafPxH = tr.inner.b - tr.inner.t;
    let mmPerPx, leafW, leafH, note;
    if (tr.kind === "door") {
      leafH = 2100;
      mmPerPx = leafH / Math.max(1, leafPxH);
      leafW = round1(leafPxW * mmPerPx);
      if (Math.abs(leafW - 800) < 40) leafW = 800;
      else if (Math.abs(leafW - 700) < 40) leafW = 700;
      else if (Math.abs(leafW - 900) < 40) leafW = 900;
      else if (Math.abs(leafW - 600) < 40) leafW = 600;
      mmPerPx = leafW / Math.max(1, leafPxW);
      leafH = round1(leafPxH * mmPerPx);
      if (Math.abs(leafH - 2100) < 40) leafH = 2100;
      note = `Porta interna: anta ${leafW}×${leafH} mm (da foto, altezza UNI 2100)`;
    } else {
      const maxPx = Math.max(tr.outer.w, tr.outer.h);
      mmPerPx = 100 / maxPx;
      leafW = round1(leafPxW * mmPerPx);
      leafH = round1(leafPxH * mmPerPx);
      note = `Profilo da foto, scala automatica (max 100 mm). Scala se le misure sono diverse.`;
    }

    const left = round1(tr.inner.l * mmPerPx);
    const right = round1((tr.outer.w - tr.inner.r) * mmPerPx);
    const top = round1(tr.inner.t * mmPerPx);
    const bottom = round1((tr.outer.h - tr.inner.b) * mmPerPx);
    const OW = round1(left + leafW + right);
    const OH = round1(bottom + leafH + top);

    const E = [];
    const L0 = "0", FOTO = "foto", FER = "ferramenta", Q = "quote";
    E.push({
      type: "image",
      x: 0, y: 0, w: OW, h: OH,
      opacity: 0.38,
      layer: FOTO,
      lockedHit: true
    });
    E.push({
      type: "polyline", closed: true, layer: L0,
      points: [{ x: 0, y: 0 }, { x: OW, y: 0 }, { x: OW, y: OH }, { x: 0, y: OH }]
    });
    E.push({
      type: "rect", x: left, y: bottom, w: leafW, h: leafH, rot: 0, layer: L0
    });

    const toCad = (px, py) => ({
      x: round1((px - tr.px.minX) * mmPerPx),
      y: round1((tr.px.maxY - py) * mmPerPx)
    });

    if (tr.kind === "door" && tr.hardware.length) {
      const hs = tr.hardware.slice().sort((a, b) => a.y - b.y);
      const handle = hs[0];
      const lock = hs.length > 1 ? hs[1] : null;
      const hc = toCad(handle.x, handle.y);
      E.push({ type: "circle", cx: hc.x, cy: hc.y, r: 18, layer: FER });
      const leverW = Math.max(90, round1(handle.w * mmPerPx));
      const leverH = Math.max(16, round1(handle.h * mmPerPx));
      const dir = hc.x < left + leafW / 2 ? 1 : -1;
      const lx = dir > 0 ? hc.x : hc.x - leverW;
      E.push({ type: "rect", x: lx, y: hc.y - leverH / 2, w: leverW, h: leverH, rot: 0, layer: FER });
      if (lock) {
        const lc = toCad(lock.x, lock.y);
        E.push({ type: "rect", x: lc.x - 13, y: lc.y - 16, w: 26, h: 32, rot: 0, layer: FER });
        E.push({ type: "circle", cx: lc.x, cy: lc.y, r: 6, layer: FER });
      }
      const hingeX = hc.x < left + leafW / 2 ? left + leafW - 4 : left - 16;
      [0.12, 0.5, 0.88].forEach((t) => {
        const y = bottom + leafH * t;
        E.push({ type: "rect", x: hingeX, y: y - 15, w: 20, h: 30, rot: 0, layer: FER });
      });
      E.push({ type: "dimension", x1: left, y1: bottom, x2: left, y2: hc.y, offset: -28, layer: Q });
    } else {
      tr.hardware.slice(0, 4).forEach((hw) => {
        const p = toCad(hw.x, hw.y);
        E.push({ type: "circle", cx: p.x, cy: p.y, r: Math.max(4, round1(Math.max(hw.w, hw.h) * mmPerPx / 2)), layer: FER });
      });
    }

    E.push({ type: "dimension", x1: 0, y1: 0, x2: OW, y2: 0, offset: -40, layer: Q });
    E.push({ type: "dimension", x1: 0, y1: 0, x2: 0, y2: OH, offset: -40, layer: Q });
    E.push({ type: "dimension", x1: left, y1: bottom, x2: left + leafW, y2: bottom, offset: 24, layer: Q });
    E.push({ type: "dimension", x1: left + leafW, y1: bottom, x2: left + leafW, y2: bottom + leafH, offset: 24, layer: Q });
    E.push({
      type: "text", x: OW / 2 - 40, y: OH + 18, text: note, height: 14, rot: 0, layer: Q
    });
    return { entities: E, width: OW, height: OH, leafW, leafH, note, kind: tr.kind };
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
    E.push({ type: "circle", cx: hx, cy: hy, r: 18, layer: FER });
    E.push({ type: "rect", x: hx, y: hy - 10, w: 128, h: 20, rot: 0, layer: FER });
    E.push({ type: "rect", x: lx - 13, y: ly - 16, w: 26, h: 32, rot: 0, layer: FER });
    E.push({ type: "circle", cx: lx, cy: ly, r: 6, layer: FER });
    [250, 1050, 1850].forEach((yy) => {
      E.push({ type: "rect", x: left + leafW - 4, y: bottom + yy - 15, w: 20, h: 30, rot: 0, layer: FER });
    });
    E.push({ type: "dimension", x1: 0, y1: 0, x2: OW, y2: 0, offset: -50, layer: Q });
    E.push({ type: "dimension", x1: 0, y1: 0, x2: 0, y2: OH, offset: -50, layer: Q });
    E.push({ type: "dimension", x1: left, y1: bottom, x2: left + leafW, y2: bottom, offset: 30, layer: Q });
    E.push({ type: "dimension", x1: left + leafW, y1: bottom, x2: left + leafW, y2: bottom + leafH, offset: 30, layer: Q });
    E.push({ type: "dimension", x1: left, y1: bottom, x2: left, y2: hy, offset: -30, layer: Q });
    E.push({ type: "text", x: 20, y: OH + 22, text: "Porta interna a battente · anta 800×2100 · maniglia H 1019 · backset 47", height: 16, rot: 0, layer: Q });
    return { entities: E, width: OW, height: OH, name: "porta-interna" };
  }

  function parsePrompt(text) {
    const raw = String(text || "");
    const t = raw.toLowerCase().replace(/,/g, ".");
    const spec = { raw };
    let m = t.match(/(\d+(?:\.\d+)?)\s*[x×\*]\s*(\d+(?:\.\d+)?)/);
    if (m) { spec.w = parseFloat(m[1]); spec.h = parseFloat(m[2]); }
    m = t.match(/spess(?:ore)?\s*[:=]?\s*(\d+(?:\.\d+)?)|\bsp\.?\s*(\d+(?:\.\d+)?)|thick(?:ness)?\s*[:=]?\s*(\d+(?:\.\d+)?)/);
    if (m) spec.thickness = parseFloat(m[1] || m[2] || m[3]);
    m = t.match(/[ø⌀]\s*(\d+(?:\.\d+)?)|diam(?:etro)?\s*(\d+(?:\.\d+)?)/i);
    if (m) spec.hole = parseFloat(m[1] || m[2]);
    m = t.match(/(\d+)\s*for[oi]/);
    if (m) spec.holeN = parseInt(m[1], 10);
    m = t.match(/\br\s*[=:]?\s*(\d+(?:\.\d+)?)|raccord\w*\s*(\d+(?:\.\d+)?)/);
    if (m) spec.radius = parseFloat(m[1] || m[2]);
    m = t.match(/manigl\w*\s*(?:a\s*|h\s*|ad\s*)?(\d+(?:\.\d+)?)/);
    if (m) spec.handleH = parseFloat(m[1]);
    if (/porta|door|anta|battente/.test(t)) spec.kind = "door";
    if (/piastr|plate|flangia|staffa|gasket|guarniz/.test(t)) spec.kind = spec.kind || "rect";
    if (/schizzo a mano|sketch|disegno tecnico|blueprint|napkin/.test(t)) spec.kind = spec.kind || "sketch";
    if (spec.kind === "door" && spec.w && spec.w <= 120 && spec.h && spec.h <= 300) {
      spec.w *= 10; spec.h *= 10;
    }
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
    const targetH = (spec && spec.h) || 100;
    const mm = targetH / h;
    const E = [];
    keep.forEach((cnt) => {
      const simp = rdp(cnt, 1.8);
      if (simp.length < 3) return;
      const pts = simp.map((p) => ({ x: round1(p.x * mm), y: round1((h - p.y) * mm) }));
      const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 2 * mm;
      if (closed && pts.length > 2) pts.pop();
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const rw = Math.max(...xs) - Math.min(...xs), rh = Math.max(...ys) - Math.min(...ys);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
      const rAvg = rs.reduce((a, b) => a + b, 0) / rs.length;
      const rDev = Math.sqrt(rs.reduce((a, b) => a + (b - rAvg) * (b - rAvg), 0) / rs.length) / (rAvg || 1);
      if (closed && rDev < 0.12 && rAvg > 2) {
        E.push({ type: "circle", cx: round1(cx), cy: round1(cy), r: round1(rAvg), layer: "0" });
      } else {
        E.push({ type: "polyline", points: pts, closed: closed && pts.length >= 3, layer: "0" });
      }
    });
    const note = `Vettorializzato dallo schizzo (${E.length} profili), scala H=${round1(h * mm)} mm`;
    E.push({ type: "text", x: 0, y: -12, text: note, height: 4, rot: 0, layer: "quote" });
    return {
      entities: E, kind: "sketch", note,
      thickness: (spec && spec.thickness) || 5,
      width: w * mm, height: h * mm
    };
  }

  function applySpec(built, spec) {
    if (!built || !spec) return built;
    if (spec.thickness) built.thickness = spec.thickness;
    const ents = built.entities || [];
    const leaf = ents.find((e) => e.type === "rect" && e.layer === "0" && (e.h || 0) >= (e.w || 0));
    if (leaf && spec.w && spec.h) {
      const fx = spec.w / (leaf.w || spec.w), fy = spec.h / (leaf.h || spec.h);
      const ox = leaf.x, oy = leaf.y;
      ents.forEach((e) => {
        const scp = (p) => ({ x: ox + (p.x - ox) * fx, y: oy + (p.y - oy) * fy });
        if (e.type === "rect" || e.type === "image") {
          const c = scp({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
          e.w *= fx; e.h *= fy; e.x = c.x - e.w / 2; e.y = c.y - e.h / 2;
        } else if (e.type === "circle") {
          const c = scp({ x: e.cx, y: e.cy }); e.cx = c.x; e.cy = c.y; e.r *= (fx + fy) / 2;
        } else if (e.points) e.points = e.points.map(scp);
        else if (e.type === "dimension" || e.type === "line") {
          const a = scp({ x: e.x1, y: e.y1 }), b = scp({ x: e.x2, y: e.y2 });
          e.x1 = a.x; e.y1 = a.y; e.x2 = b.x; e.y2 = b.y;
        } else if (e.type === "text") {
          const p = scp({ x: e.x, y: e.y }); e.x = p.x; e.y = p.y;
        }
      });
      built.leafW = spec.w; built.leafH = spec.h;
    }
    if (leaf && spec.handleH) {
      const target = leaf.y + spec.handleH;
      const hs = ents.filter((e) => e.layer === "ferramenta" && e.type === "circle");
      if (hs.length) {
        const hy = Math.max(...hs.map((e) => e.cy));
        const dy = target - hy;
        ents.forEach((e) => {
          if (e.layer !== "ferramenta" && !(e.type === "dimension" && Math.abs((e.y2 || 0) - hy) < 8)) return;
          if (e.cx != null) e.cy += dy;
          if (e.y != null && e.type === "rect") e.y += dy;
          if (e.y1 != null) { e.y1 += dy; e.y2 += dy; }
        });
      }
    }
    if (spec.raw) {
      const txt = ents.find((e) => e.type === "text");
      if (txt) txt.text = (built.note || "") + " · " + spec.raw;
    }
    return built;
  }

  function generateFromImage(img, promptText) {
    const spec = parsePrompt(promptText);
    const meanCanvas = document.createElement("canvas");
    const mw = 64, mh = 64;
    meanCanvas.width = mw; meanCanvas.height = mh;
    const mg = meanCanvas.getContext("2d");
    mg.drawImage(img, 0, 0, mw, mh);
    const d = mg.getImageData(0, 0, mw, mh).data;
    let mean = 0, edge = 0;
    for (let i = 0; i < d.length; i += 4) mean += lum(d[i], d[i + 1], d[i + 2]);
    mean /= (d.length / 4);
    const sketchy = spec.kind === "sketch" || (mean > 150 && spec.kind !== "door");
    if (sketchy && spec.kind !== "door") {
      return applySpec(vectorizeSketch(img, spec), spec);
    }
    const tr = tracePhoto(img);
    if (!tr) return applySpec(vectorizeSketch(img, spec), spec);
    if (spec.kind && spec.kind !== "sketch") tr.kind = spec.kind;
    const built = entitiesFromTrace(tr);
    if (!built) return applySpec(vectorizeSketch(img, spec), spec);
    built.thickness = spec.thickness || (built.kind === "door" ? 40 : 5);
    return applySpec(built, spec);
  }

  global.SchizzoTrace = {
    tracePhoto, entitiesFromTrace, doorElevation,
    parsePrompt, applySpec, generateFromImage, vectorizeSketch
  };
})(typeof window !== "undefined" ? window : globalThis);
