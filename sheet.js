/* Schizzo Sheet — disegno tecnico quotato su foglio (SVG in millimetri)
 *
 * Convenzioni:
 *   - foglio in mm, viewBox = foglio (stampa 1:1 a video, scala indicata nel cartiglio)
 *   - contorni 0.5 mm, spigoli 0.25, assi 0.18 tratto-punto, quote 0.18
 *   - quote con linee di riferimento, frecce, testo calcolato dalla geometria
 *   - cartiglio + distinta + note tecniche
 */
(function (global) {
  "use strict";

  const PAPER = {
    a4p: [210, 297], a4l: [297, 210],
    a3p: [297, 420], a3l: [420, 297],
    a2p: [420, 594], a2l: [594, 420]
  };
  const SCALES = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200];

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const fmt = (v, d) => {
    const p = Math.pow(10, d == null ? 1 : d);
    const x = Math.round(v * p) / p;
    return (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(d == null ? 1 : d));
  };

  /* --------------------------------------------------------------- geometria */

  function applyDim(d) {
    const x1 = d.x1, y1 = d.y1, x2 = d.x2, y2 = d.y2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const off = d.offset || 0;
    return {
      a: { x: x1, y: y1 }, b: { x: x2, y: y2 },
      p1: { x: x1 + nx * off, y: y1 + ny * off },
      p2: { x: x2 + nx * off, y: y2 + ny * off },
      len, n: { x: nx, y: ny }, off
    };
  }

  function dimSVG(d, cfg, T) {
    const g = applyDim(d);
    const out = [];
    const label = d.text != null ? d.text : (d.prefix || "") + fmt(g.len, cfg.dimDecimals == null ? 0 : cfg.dimDecimals);
    const arrowLen = cfg.arrow, arrowW = cfg.arrow * 0.32;
    const P1 = T(g.p1.x, g.p1.y), P2 = T(g.p2.x, g.p2.y);
    const A = T(g.a.x, g.a.y), B = T(g.b.x, g.b.y);
    const ang = Math.atan2(P2.y - P1.y, P2.x - P1.x);

    /* linee di riferimento: dal punto alla quota, con stacco iniziale e sporgenza finale */
    [[A, P1], [B, P2]].forEach(([p, q]) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      out.push(`<line x1="${fmt(p.x + ux * cfg.thin, 2)}" y1="${fmt(p.y + uy * cfg.thin, 2)}" x2="${fmt(q.x + ux * cfg.extGapOut, 2)}" y2="${fmt(q.y + uy * cfg.extGapOut, 2)}" stroke-width="${cfg.dimW}" />`);
    });
    out.push(`<line x1="${fmt(P1.x, 2)}" y1="${fmt(P1.y, 2)}" x2="${fmt(P2.x, 2)}" y2="${fmt(P2.y, 2)}" stroke-width="${cfg.dimW}" />`);
    const arr = (p, dir) => {
      const a2 = ang + (dir < 0 ? Math.PI : 0);
      const tipx = p.x + Math.cos(a2) * arrowLen, tipy = p.y + Math.sin(a2) * arrowLen;
      const nx2 = -Math.sin(a2) * arrowW, ny2 = Math.cos(a2) * arrowW;
      return `<path d="M ${fmt(p.x, 2)} ${fmt(p.y, 2)} L ${fmt(tipx + nx2, 2)} ${fmt(tipy + ny2, 2)} L ${fmt(tipx - nx2, 2)} ${fmt(tipy - ny2, 2)} Z" class="fill" />`;
    };
    out.push(arr(P1, 1), arr(P2, -1));
    const mx = (P1.x + P2.x) / 2, my = (P1.y + P2.y) / 2;
    let tAng = ang * 180 / Math.PI;
    if (tAng > 90 || tAng < -90) tAng += 180;
    const w = label.length * cfg.textH * 0.62 + 1.6;
    out.push(`<g transform="translate(${fmt(mx, 2)},${fmt(my, 2)}) rotate(${fmt(tAng, 2)})">`);
    out.push(`<rect x="${fmt(-w / 2, 2)}" y="${fmt(-cfg.textH * 1.15, 2)}" width="${fmt(w, 2)}" height="${fmt(cfg.textH * 1.3, 2)}" class="paper" rx="0.3" />`);
    out.push(`<text x="0" y="0" font-size="${fmt(cfg.textH, 2)}" text-anchor="middle">${esc(label)}</text>`);
    out.push(`</g>`);
    return out.join("\n");
  }

  /* ------------------------------------------------------ scala e inquadratura */

  function chooseScale(contentW, contentH, areaW, areaH) {
    for (const s of SCALES) {
      if (contentW / s <= areaW && contentH / s <= areaH) return s;
    }
    return SCALES[SCALES.length - 1];
  }

  /* --------------------------------------------------------------- cartiglio */

  function titleBlock(paper, info, cfg) {
    const [PW, PH] = paper;
    const m = cfg.margin;
    const bw = cfg.blockW, bh = cfg.blockH;
    const x0 = PW - m - bw, y0 = PH - m - bh;
    const rows = [
      ["Disegno", info.name || "—"],
      ["Materiale", info.material || "—"],
      ["Scala", "1:" + info.scale],
      ["Unità", "mm"],
      ["Spessore", (info.thickness != null ? fmt(info.thickness, 1) + " mm" : "—")],
      ["Data", info.date || ""]
    ];
    const lh = (bh - 8) / rows.length;
    const out = [];
    out.push(`<rect x="${fmt(x0, 2)}" y="${fmt(y0, 2)}" width="${fmt(bw, 2)}" height="${fmt(bh, 2)}" class="frame" stroke-width="${cfg.frameW * 1.7}" />`);
    rows.forEach((row, i) => {
      const y = y0 + lh * (i + 1) - 1.4;
      out.push(`<text x="${fmt(x0 + 3, 2)}" y="${fmt(y, 2)}" font-size="${cfg.textH * 0.9}" class="lbl">${esc(row[0])}</text>`);
      out.push(`<text x="${fmt(x0 + 26, 2)}" y="${fmt(y, 2)}" font-size="${cfg.textH}" class="val">${esc(row[1])}</text>`);
    });
    out.push(`<line x1="${fmt(x0, 2)}" y1="${fmt(y0 + bh - 7, 2)}" x2="${fmt(x0 + bw, 2)}" y2="${fmt(y0 + bh - 7, 2)}" class="frame" stroke-width="${cfg.frameW}" />`);
    out.push(`<text x="${fmt(x0 + bw / 2, 2)}" y="${fmt(y0 + bh - 2.4, 2)}" font-size="${cfg.textH * 1.15}" text-anchor="middle" class="brand">${esc(info.brand || "3D Lab Massafra")}</text>`);
    return out.join("\n");
  }

  function notesBlock(paper, notes, cfg, info) {
    if (!notes || !notes.length) return "";
    const [PW, PH] = paper;
    const m = cfg.margin;
    const w = cfg.blockW + 30, x0 = PW - m - w;
    /* impagina le note contando le righe reali dopo l'a-capo */
    const lines = [];
    const maxChars = Math.floor(w / (cfg.textH * 0.5));
    notes.forEach((n) => {
      let cur = "";
      String(n).split(" ").forEach((word) => {
        if ((cur + " " + word).trim().length > maxChars) { lines.push(cur.trim()); cur = word; }
        else cur += " " + word;
      });
      if (cur.trim()) lines.push(cur.trim());
      lines.push("");                       /* riga vuota fra le note */
    });
    if (lines[lines.length - 1] === "") lines.pop();
    const lh = cfg.textH * 1.45;
    const y0 = PH - m - cfg.blockH - 8 - lines.length * lh - 4;
    const out = [];
    out.push(`<text x="${fmt(x0, 2)}" y="${fmt(y0, 2)}" font-size="${cfg.textH * 1.02}" class="lbl">Note di lavorazione</text>`);
    lines.forEach((ln, i) => {
      if (!ln) return;
      out.push(`<text x="${fmt(x0, 2)}" y="${fmt(y0 + 5 + lh * (i + 1), 2)}" font-size="${fmt(cfg.textH * 0.92)}" class="note">${esc(ln)}</text>`);
    });
    return out.join("\n");
  }

  /* ------------------------------------------------------------------ render */

  const LAYER_STYLE = {
    contorno: { w: 0.5, cls: "out" },
    ferramenta: { w: 0.25, cls: "thin" },
    fori: { w: 0.4, cls: "out" },
    quote: { w: 0.18, cls: "thin" },
    foro: { w: 0.25, cls: "thin" }
  };

  function entitySVG(e, cfg, out, T) {
    const st = LAYER_STYLE[e.layer] || { w: 0.25, cls: "thin" };
    const sw = `stroke-width="${st.w}"`;
    switch (e.type) {
      case "line": {
        const a = T(e.x1, e.y1), b = T(e.x2, e.y2);
        out.push(`<line x1="${fmt(a.x, 2)}" y1="${fmt(a.y, 2)}" x2="${fmt(b.x, 2)}" y2="${fmt(b.y, 2)}" ${sw} />`);
        break;
      }
      case "rect": {
        const rot = e.rot || 0;
        const a = T(e.x, e.y + e.h);                 /* alto-sinistra in carta */
        const w = e.w / cfg.scale, h = e.h / cfg.scale;
        if (rot) {
          const c = T(e.x + e.w / 2, e.y + e.h / 2);
          out.push(`<rect x="${fmt(a.x, 2)}" y="${fmt(a.y, 2)}" width="${fmt(w, 2)}" height="${fmt(h, 2)}" ${sw} transform="rotate(${fmt(rot * 180 / Math.PI, 2)} ${fmt(c.x, 2)} ${fmt(c.y, 2)})" />`);
        } else {
          out.push(`<rect x="${fmt(a.x, 2)}" y="${fmt(a.y, 2)}" width="${fmt(w, 2)}" height="${fmt(h, 2)}" ${sw} />`);
        }
        break;
      }
      case "circle": {
        const c = T(e.cx, e.cy);
        out.push(`<circle cx="${fmt(c.x, 2)}" cy="${fmt(c.y, 2)}" r="${fmt(e.r / cfg.scale, 2)}" ${sw} />`);
        break;
      }
      case "arc": {
        const a0 = -e.a0, a1 = -e.a1;
        const p0 = { x: e.cx + Math.cos(e.a0) * e.r, y: e.cy + Math.sin(e.a0) * e.r };
        const p1 = { x: e.cx + Math.cos(e.a1) * e.r, y: e.cy + Math.sin(e.a1) * e.r };
        let delta = e.a1 - e.a0;
        while (delta < 0) delta += Math.PI * 2;
        while (delta > Math.PI * 2) delta -= Math.PI * 2;
        const large = delta > Math.PI ? 1 : 0;
        const A = T(p0.x, p0.y), B = T(p1.x, p1.y);
        out.push(`<path d="M ${fmt(A.x, 2)} ${fmt(A.y, 2)} A ${fmt(e.r / cfg.scale, 2)} ${fmt(e.r / cfg.scale, 2)} 0 ${large} 0 ${fmt(B.x, 2)} ${fmt(B.y, 2)}" ${sw} />`);
        break;
      }
      case "ellipse": {
        const c = T(e.cx, e.cy);
        const rot = -(e.rot || 0) * 180 / Math.PI;
        out.push(`<ellipse cx="${fmt(c.x, 2)}" cy="${fmt(c.y, 2)}" rx="${fmt(e.rx / cfg.scale, 2)}" ry="${fmt(e.ry / cfg.scale, 2)}" ${sw}${rot ? ` transform="rotate(${fmt(rot, 2)} ${fmt(c.x, 2)} ${fmt(c.y, 2)})"` : ""} />`);
        break;
      }
      case "polyline":
      case "polygon": {
        const pts = polylinePoints(e).map((p) => T(p.x, p.y));
        if (!pts.length) break;
        const tag = e.type === "polygon" || e.closed ? "polygon" : "polyline";
        out.push(`<${tag} points="${pts.map((p) => `${fmt(p.x, 2)},${fmt(p.y, 2)}`).join(" ")}" ${sw} />`);
        break;
      }
      case "text": {
        const p = T(e.x, e.y);
        out.push(`<text x="${fmt(p.x, 2)}" y="${fmt(p.y, 2)}" font-size="${fmt((e.height || 3) / cfg.scale, 2)}">${esc(e.text)}</text>`);
        break;
      }
      default: break;
    }
  }

  /** Ingombro (bounding box) di un'entità, in mm. */
  function entityBox(e) {
    const pts = [];
    switch (e.type) {
      case "line": pts.push({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }); break;
      case "rect": pts.push({ x: e.x, y: e.y }, { x: e.x + e.w, y: e.y + e.h }); break;
      case "circle": pts.push({ x: e.cx - e.r, y: e.cy - e.r }, { x: e.cx + e.r, y: e.cy + e.r }); break;
      case "arc": case "ellipse": pts.push({ x: e.cx - (e.r || e.rx), y: e.cy - (e.r || e.ry) }, { x: e.cx + (e.r || e.rx), y: e.cy + (e.r || e.ry) }); break;
      case "polyline": case "polygon": pts.push(...polylinePoints(e)); break;
      case "text": pts.push({ x: e.x, y: e.y }, { x: e.x + 20, y: e.y }); break;
      default: return null;
    }
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  function polylinePoints(e) {
    const pts = e.points || [];
    if (!pts.length) return [];
    const out = [];
    const closed = !!e.closed || e.type === "polygon";
    const n = pts.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push({ x: a.x, y: a.y });
      if (a.bulge && Math.abs(a.bulge) > 1e-9) {
        const arc = bulgeArc(a, b, a.bulge);
        if (arc) {
          const steps = 12;
          for (let k = 1; k < steps; k++) {
            const ang = arc.a0 + (arc.delta * k) / steps;
            out.push({ x: arc.cx + Math.cos(ang) * arc.r, y: arc.cy + Math.sin(ang) * arc.r });
          }
        }
      }
    }
    if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    return out;
  }

  function bulgeArc(p1, p2, bulge) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-9 || Math.abs(bulge) < 1e-12) return null;
    const included = 4 * Math.atan(bulge);
    const radius = Math.abs(chord / (2 * Math.sin(included / 2)));
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const nx = -dy / chord, ny = dx / chord;
    const d = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
    const sign = bulge > 0 ? 1 : -1;
    const flip = Math.abs(included) > Math.PI ? -1 : 1;
    const cx = mx + nx * d * sign * flip, cy = my + ny * d * sign * flip;
    const a0 = Math.atan2(p1.y - cy, p1.x - cx);
    let delta = included;
    return { cx, cy, r: radius, a0, delta };
  }

  /**
   * Foglio tecnico completo.
   * built: {entities, dims, notes, width, height, thickness, meta}
   */
  function render(built, params, opts) {
    opts = opts || {};
    const paper = PAPER[opts.paper || "a3p"] || PAPER.a3p;
    const [PW, PH] = paper;
    const cfg = {
      margin: 8, blockW: 94, blockH: 42,
      frameW: 0.35, dimW: 0.18, textH: 3.0, arrow: 2.4, extGapOut: 1.4,
      dimDecimals: opts.decimals == null ? 0 : opts.decimals, thin: 0.8, scale: 1
    };
    const areaX = cfg.margin + 3, areaY = cfg.margin + 11;
    const areaW = PW - 2 * cfg.margin - 6 - 104;
    const areaH = PH - cfg.margin - areaY - cfg.blockH - 8;

    const b = built.bounds || { minX: 0, minY: 0, maxX: built.width, maxY: built.height };
    const contentW = b.maxX - b.minX, contentH = b.maxY - b.minY;
    const scale = opts.scale || chooseScale(contentW, contentH, areaW, areaH);
    cfg.scale = scale;
    const drawW = contentW / scale, drawH = contentH / scale;
    const ox = areaX + (areaW - drawW) / 2 - b.minX / scale;
    const oy = areaY + (areaH - drawH) / 2 + b.maxY / scale;
    const T = (x, y) => ({ x: ox + x / scale, y: oy - y / scale });

    const body = [];
    const dims = [];
    (built.entities || []).forEach((e) => {
      if (e.type === "dimension") dims.push(e);
      else entitySVG(e, cfg, body, T);
    });
    (built.dims || []).forEach((d) => dims.push(d));
    const dimOut = (opts.dims === false ? [] : dims).map((d) => dimSVG(d, cfg, T));

    /* --- vista di dettaglio (ingrandimento della zona ferramenta) --- */
    let detailOut = "";
    let detailZone = "";
    if (opts.detail && opts.detail.box) {
      const z = opts.detail.box;
      const dScale = opts.detail.scale || 5;
      const dw = (z.x1 - z.x0) / dScale, dh = (z.y1 - z.y0) / dScale;
      const place = opts.detail.place || { x: PW - cfg.margin - 8 - dw, y: areaY + 12 };
      const T2 = (x, y) => ({ x: place.x + (x - z.x0) / dScale, y: place.y + (z.y1 - y) / dScale });
      const cfg2 = { ...cfg, scale: dScale, textH: cfg.textH, arrow: cfg.arrow * 0.8, extGapOut: cfg.extGapOut };
      const body2 = [];
      (built.entities || []).forEach((e) => {
        if (e.type === "dimension" || e.layer === "quote") return;
        const bb = entityBox(e);
        if (!bb) return;
        if (bb.x0 < z.x0 - 1 || bb.x1 > z.x1 + 1 || bb.y0 < z.y0 - 1 || bb.y1 > z.y1 + 1) return;
        entitySVG(e, cfg2, body2, T2);
      });
      const dims2 = dims.filter((d) => {
        const inz = (x, y) => x >= z.x0 - 1 && x <= z.x1 + 1 && y >= z.y0 - 1 && y <= z.y1 + 1;
        return inz(d.x1, d.y1) && inz(d.x2, d.y2);
      });
      const dimOut2 = (opts.dims === false ? [] : dims2).map((d) => dimSVG(d, cfg2, T2));
      /* cornice del dettaglio sul disegno principale */
      const zx = T(z.x0, z.y1).x, zy = T(z.x0, z.y1).y, zw = (z.x1 - z.x0) / scale, zh = (z.y1 - z.y0) / scale;
      const letter = opts.detail.letter || "A";
      detailZone = `<rect x="${fmt(zx, 2)}" y="${fmt(zy, 2)}" width="${fmt(zw, 2)}" height="${fmt(zh, 2)}" class="thin" stroke-width="${cfg.dimW}" stroke-dasharray="2 1.4" />`
        + `<circle cx="${fmt(zx + zw - 2.4, 2)}" cy="${fmt(zy + zh - 2.4, 2)}" r="3" class="frame" stroke-width="${cfg.dimW}" />`
        + `<text x="${fmt(zx + zw - 2.4, 2)}" y="${fmt(zy + zh - 1.4, 2)}" font-size="${fmt(cfg.textH, 2)}" text-anchor="middle" class="val">${esc(letter)}</text>`;
      detailOut = `<g class="out">${body2.join("\n")}</g><g class="thin">${dimOut2.join("\n")}</g>
        <text x="${fmt(place.x, 2)}" y="${fmt(place.y - 3.2, 2)}" font-size="${cfg.textH * 1.05}" class="val">Dettaglio ${esc(letter)} — ferramenta · scala 1:${dScale}</text>`;
    }

    const info = {
      name: (built.meta && built.meta.name) || "disegno",
      material: (built.meta && built.meta.material) || "—",
      thickness: built.thickness,
      scale, brand: opts.brand || "3D Lab Massafra",
      date: opts.date || new Date().toLocaleDateString("it-IT")
    };

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PW}mm" height="${PH}mm" viewBox="0 0 ${PW} ${PH}">
  <style>
    .out, .thin { fill: none; stroke: #111; stroke-linecap: round; stroke-linejoin: round; }
    text { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; fill: #111; stroke: none; font-weight: 400; }
    text.lbl { fill: #555; }
    text.val { font-weight: 600; }
    text.brand { font-weight: 700; letter-spacing: 0.4px; }
    .frame { fill: none; stroke: #111; }
    .fill { fill: #111; stroke: none; }
    .paper { fill: #fff; stroke: none; }
  </style>
  <rect x="0" y="0" width="${PW}" height="${PH}" fill="#fff"/>
  <rect x="${cfg.margin - 2}" y="${cfg.margin - 2}" width="${PW - 2 * cfg.margin + 4}" height="${PH - 2 * cfg.margin + 4}" class="frame" stroke-width="${cfg.frameW}" />
  <g class="out">${body.join("\n")}</g>
  <g class="thin">${dimOut.join("\n")}</g>
  ${detailZone}
  ${detailOut}
  ${titleBlock(paper, info, cfg)}
  ${notesBlock(paper, built.notes || [], cfg, info)}
  <text x="${fmt(cfg.margin + 2, 2)}" y="${fmt(cfg.margin + 5, 2)}" font-size="${cfg.textH * 1.25}" class="val">${esc(opts.title || info.name)}</text>
  <text x="${fmt(cfg.margin + 2, 2)}" y="${fmt(cfg.margin + 9, 2)}" font-size="${cfg.textH * 0.9}" class="lbl">Scala 1:${info.scale} — quote in millimetri — vista frontale</text>
</svg>
`;
    return { svg, scale, paper, stats: { entities: (built.entities || []).length, dims: dims.length } };
  }

  /** PNG dal foglio SVG (solo browser): rasterizzazione vettoriale fedele. */
  function toPNG(svg, paper, dpi, cb) {
    const [PW, PH] = paper;
    const k = dpi / 25.4;
    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(PW * k);
      c.height = Math.round(PH * k);
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => cb(b), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  global.SchizzoSheet = { render, toPNG, PAPER, SCALES, chooseScale, applyDim, fmt, polylinePoints, bulgeArc, entityBox };
})(typeof window !== "undefined" ? window : globalThis);
