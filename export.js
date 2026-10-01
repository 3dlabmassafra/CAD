/* Schizzo — esportazione DXF R2000, SVG, PNG */
(function (global) {
  const ACI = [
    [0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255],
    [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]
  ];

  function hexToRgb(hex) {
    const h = (hex || "#ffffff").replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function nearestAci(hex) {
    const [r, g, b] = hexToRgb(hex);
    let best = 7, dmin = 1e9;
    for (let i = 1; i < ACI.length; i++) {
      const d = (ACI[i][0] - r) ** 2 + (ACI[i][1] - g) ** 2 + (ACI[i][2] - b) ** 2;
      if (d < dmin) { dmin = d; best = i; }
    }
    return best;
  }
  function n(v) {
    if (!Number.isFinite(v)) return "0.0";
    const x = Math.round(v * 1e8) / 1e8;
    let s = String(x);
    if (!s.includes("e") && !s.includes("E") && !s.includes(".")) s += ".0";
    return s;
  }
  function pair(code, value) {
    return `${code}\n${value}`;
  }
  function pairs(list) {
    return list.map(([c, v]) => pair(c, v)).join("\n");
  }
  function escText(s) {
    return String(s ?? "").replace(/\r?\n/g, " ").slice(0, 250);
  }

  const INSUNITS = { mm: 4, cm: 5, m: 6, in: 1, inch: 1, inches: 1 };

  function layerName(ent, layers) {
    const ly = layers.find((l) => l.id === ent.layer) || layers[0];
    if (!ly || ly.id === "0") return "0";
    return sanitizeLayer(ly.name);
  }
  function sanitizeLayer(name) {
    const s = String(name || "0").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
    return s || "0";
  }
  function aciOf(ent, layers) {
    if (ent.color) return nearestAci(ent.color);
    const ly = layers.find((l) => l.id === ent.layer);
    return nearestAci((ly && ly.color) || "#ffffff");
  }

  function handleGen() {
    let h = 100;
    return () => {
      h += 1;
      return h.toString(16).toUpperCase();
    };
  }

  function ellipseEntity(cx, cy, rx, ry, rot, layer, aci, handle) {
    const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    let mx, my, ratio;
    if (Math.abs(rx) >= Math.abs(ry)) {
      mx = rx * c; my = rx * s; ratio = Math.abs(ry) / Math.max(Math.abs(rx), 1e-12);
    } else {
      mx = -ry * s; my = ry * c; ratio = Math.abs(rx) / Math.max(Math.abs(ry), 1e-12);
    }
    return pairs([
      [0, "ELLIPSE"], [5, handle()], [8, layer], [62, aci],
      [10, n(cx)], [20, n(cy)], [30, "0.0"],
      [11, n(mx)], [21, n(my)], [31, "0.0"],
      [40, n(ratio)], [41, "0.0"], [42, n(Math.PI * 2)]
    ]);
  }

  function lwpoly(pts, closed, layer, aci, handle) {
    if (!pts || pts.length < 2) return "";
    const flags = closed ? 1 : 0;
    const head = pairs([
      [0, "LWPOLYLINE"], [5, handle()], [8, layer], [62, aci],
      [90, pts.length], [70, flags], [43, "0.0"]
    ]);
    const verts = pts.map((p) => {
      let s = pair(10, n(p.x)) + "\n" + pair(20, n(p.y));
      if (p.bulge && Math.abs(p.bulge) > 1e-10) s += "\n" + pair(42, n(p.bulge));
      return s;
    }).join("\n");
    return head + "\n" + verts;
  }

  function bulgeToArc(p1, p2, bulge) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-12 || Math.abs(bulge) < 1e-12) return null;
    const included = 4 * Math.atan(bulge);
    const radius = Math.abs(chord / (2 * Math.sin(included / 2)));
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const nx = -dy / chord, ny = dx / chord;
    const d = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
    const sign = bulge > 0 ? 1 : -1;
    const flip = Math.abs(included) > Math.PI ? -1 : 1;
    const cx = mx + nx * d * sign * flip;
    const cy = my + ny * d * sign * flip;
    const a0 = Math.atan2(p1.y - cy, p1.x - cx);
    const a1 = Math.atan2(p2.y - cy, p2.x - cx);
    return { cx, cy, r: radius, a0, a1, ccw: bulge > 0, included };
  }

  function sampleBulge(p1, p2, bulge, steps) {
    const arc = bulgeToArc(p1, p2, bulge);
    if (!arc) return [];
    let delta = arc.a1 - arc.a0;
    if (arc.ccw) { while (delta <= 0) delta += Math.PI * 2; while (delta > Math.PI * 2) delta -= Math.PI * 2; }
    else { while (delta >= 0) delta -= Math.PI * 2; while (delta < -Math.PI * 2) delta += Math.PI * 2; }
    const n = Math.max(4, steps || 12);
    const out = [];
    for (let i = 1; i < n; i++) {
      const a = arc.a0 + delta * (i / n);
      out.push({ x: arc.cx + Math.cos(a) * arc.r, y: arc.cy + Math.sin(a) * arc.r });
    }
    return out;
  }

  function polylineDrawPts(e) {
    const pts = e.points || [];
    const n = pts.length;
    if (n < 2) return pts.slice();
    const closed = e.type === "polygon" || !!e.closed;
    const out = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push({ x: a.x, y: a.y });
      if (a.bulge && Math.abs(a.bulge) > 1e-10) {
        sampleBulge(a, b, a.bulge, 16).forEach((p) => out.push(p));
      }
    }
    if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    return out;
  }

  function sampleSpline(pts, closed, stepsPer) {
    if (!pts || pts.length < 2) return [];
    const p = pts.slice();
    if (closed) {
      p.push(pts[0], pts[1]);
      p.unshift(pts[pts.length - 1]);
    } else {
      p.unshift(pts[0]);
      p.push(pts[pts.length - 1]);
    }
    const out = [];
    const segs = p.length - 3;
    const sp = Math.max(6, stepsPer || 12);
    for (let i = 0; i < segs; i++) {
      const a = p[i], b = p[i + 1], c = p[i + 2], d = p[i + 3];
      const start = i === 0 ? 0 : 1;
      for (let s = start; s <= sp; s++) {
        const t = s / sp, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * b.x) + (-a.x + c.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * t3),
          y: 0.5 * ((2 * b.y) + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * t3)
        });
      }
    }
    return out;
  }

  function dimensionPrimitives(e) {
    const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
    const offset = e.offset || 8;
    const p1 = { x: a.x + nx * offset, y: a.y + ny * offset };
    const p2 = { x: b.x + nx * offset, y: b.y + ny * offset };
    const arrowLength = Math.max(1.5, Math.min(4, length * 0.08));
    const arrowWidth = arrowLength * 0.45;
    const arrow = (tip, direction) => [
      { x: tip.x, y: tip.y },
      { x: tip.x + ux * arrowLength * direction + nx * arrowWidth, y: tip.y + uy * arrowLength * direction + ny * arrowWidth },
      { x: tip.x + ux * arrowLength * direction - nx * arrowWidth, y: tip.y + uy * arrowLength * direction - ny * arrowWidth }
    ];
    const labelX = (p1.x + p2.x) / 2 + nx * 3.5;
    const labelY = (p1.y + p2.y) / 2 + ny * 3.5;
    let textAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (textAngle > 90) textAngle -= 180;
    if (textAngle < -90) textAngle += 180;
    return {
      a, b, p1, p2, length, arrow1: arrow(p1, 1), arrow2: arrow(p2, -1),
      label: (e.prefix || "") + length.toFixed(2), labelX, labelY, textAngle
    };
  }

  function entityBlocks(entities, layers, opts, handle) {
    const includeDim = !!(opts && opts.includeDimensions);
    const onlySel = opts && opts.selectionIds ? new Set(opts.selectionIds) : null;
    const visible = new Set((layers || []).filter((l) => l.visible !== false).map((l) => l.id));
    const chunks = [];

    for (const e of entities) {
      if (onlySel && !onlySel.has(e.id)) continue;
      if (e.layer && visible.size && !visible.has(e.layer)) continue;
      if ((e.type === "dimension" || e.type === "text") && !includeDim) continue;
      const layer = layerName(e, layers);
      const aci = aciOf(e, layers);
      switch (e.type) {
        case "line":
          chunks.push(pairs([
            [0, "LINE"], [5, handle()], [8, layer], [62, aci],
            [10, n(e.x1)], [20, n(e.y1)], [30, "0.0"],
            [11, n(e.x2)], [21, n(e.y2)], [31, "0.0"]
          ]));
          break;
        case "circle":
          chunks.push(pairs([
            [0, "CIRCLE"], [5, handle()], [8, layer], [62, aci],
            [10, n(e.cx)], [20, n(e.cy)], [30, "0.0"], [40, n(e.r)]
          ]));
          break;
        case "arc": {
          let a0 = (e.a0 * 180) / Math.PI;
          let a1 = (e.a1 * 180) / Math.PI;
          chunks.push(pairs([
            [0, "ARC"], [5, handle()], [8, layer], [62, aci],
            [10, n(e.cx)], [20, n(e.cy)], [30, "0.0"], [40, n(e.r)],
            [50, n(a0)], [51, n(a1)]
          ]));
          break;
        }
        case "rect": {
          const pts = rectPoints(e);
          chunks.push(lwpoly(pts, true, layer, aci, handle));
          break;
        }
        case "ellipse":
          chunks.push(ellipseEntity(e.cx, e.cy, e.rx, e.ry, e.rot || 0, layer, aci, handle));
          break;
        case "polyline":
        case "polygon": {
          const closed = e.type === "polygon" || !!e.closed;
          chunks.push(lwpoly(e.points, closed, layer, aci, handle));
          break;
        }
        case "spline": {
          const pts = sampleSpline(e.points, !!e.closed, 16);
          chunks.push(lwpoly(pts, !!e.closed, layer, aci, handle));
          break;
        }
        case "text":
          chunks.push(pairs([
            [0, "TEXT"], [5, handle()], [8, layer], [62, aci],
            [10, n(e.x)], [20, n(e.y)], [30, "0.0"],
            [40, n(e.height || 3)], [1, escText(e.text)],
            [50, n(((e.rot || 0) * 180) / Math.PI)], [7, "STANDARD"]
          ]));
          break;
        case "dimension": {
          if (!includeDim) break;
          const d = dimensionPrimitives(e);
          chunks.push(lwpoly([d.a, d.p1], false, layer, aci, handle));
          chunks.push(lwpoly([d.b, d.p2], false, layer, aci, handle));
          chunks.push(lwpoly([d.p1, d.p2], false, layer, aci, handle));
          chunks.push(lwpoly(d.arrow1, true, layer, aci, handle));
          chunks.push(lwpoly(d.arrow2, true, layer, aci, handle));
          chunks.push(pairs([
            [0, "TEXT"], [5, handle()], [8, layer], [62, aci],
            [10, n(d.labelX)], [20, n(d.labelY)], [30, "0.0"],
            [40, "3.5"], [1, d.label + " " + ((opts && opts.units) || "mm")], [50, n(d.textAngle)], [7, "STANDARD"]
          ]));
          break;
        }
        default:
          break;
      }
    }
    return chunks.filter(Boolean);
  }

  function rectPoints(e) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const rot = e.rot || 0;
    const cx = x + w / 2, cy = y + h / 2;
    const raw = [
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h }
    ];
    if (!rot) return raw;
    const c = Math.cos(rot), s = Math.sin(rot);
    return raw.map((p) => ({
      x: cx + (p.x - cx) * c - (p.y - cy) * s,
      y: cy + (p.x - cx) * s + (p.y - cy) * c
    }));
  }

  function bboxOf(entities) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    };
    const addPts = (pts) => pts && pts.forEach((p) => add(p.x, p.y));
    for (const e of entities) {
      switch (e.type) {
        case "line": add(e.x1, e.y1); add(e.x2, e.y2); break;
        case "circle": add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
        case "arc": add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
        case "ellipse": add(e.cx - e.rx, e.cy - e.ry); add(e.cx + e.rx, e.cy + e.ry); break;
        case "rect": addPts(rectPoints(e)); break;
        case "polyline":
        case "polygon":
        case "spline": addPts(e.points); break;
        case "text": add(e.x, e.y); add(e.x + 20, e.y + (e.height || 3)); break;
        case "dimension": {
          const d = dimensionPrimitives(e);
          add(d.a.x, d.a.y); add(d.b.x, d.b.y); add(d.p1.x, d.p1.y); add(d.p2.x, d.p2.y);
          [...d.arrow1, ...d.arrow2].forEach((p) => add(p.x, p.y));
          add(d.labelX, d.labelY); add(d.labelX + 4, d.labelY + 3.5);
          break;
        }
        case "image": add(e.x, e.y); add(e.x + (e.w || 0), e.y + (e.h || 0)); break;
        default: break;
      }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    return { minX, minY, maxX, maxY };
  }

  function toDXF(state, opts) {
    const units = (opts && opts.units) || state.units || "mm";
    const ins = INSUNITS[units] || 4;
    const layers = state.layers || [{ id: "0", name: "0", color: "#ffffff", visible: true }];
    const handle = handleGen();
    const ents = entityBlocks(state.entities || [], layers, opts || {}, handle);
    const bb = bboxOf(state.entities || []);
    const pad = 10;

    const layerTable = [];
    layerTable.push(pairs([[0, "TABLE"], [2, "LAYER"], [5, handle()], [70, layers.length]]));
    for (const ly of layers) {
      const lname = ly.id === "0" ? "0" : sanitizeLayer(ly.name);
      layerTable.push(pairs([
        [0, "LAYER"], [5, handle()], [2, lname], [70, 0],
        [62, nearestAci(ly.color || "#ffffff")], [6, "CONTINUOUS"]
      ]));
    }
    layerTable.push(pair(0, "ENDTAB"));

    const parts = [
      pair(0, "SECTION"),
      pair(2, "HEADER"),
      pair(9, "$ACADVER"), pair(1, "AC1015"),
      pair(9, "$INSUNITS"), pair(70, ins),
      pair(9, "$MEASUREMENT"), pair(70, units === "in" || units === "inch" || units === "inches" ? 0 : 1),
      pair(9, "$LUNITS"), pair(70, 2),
      pair(9, "$LUPREC"), pair(70, 4),
      pair(9, "$AUNITS"), pair(70, 0),
      pair(9, "$AUPREC"), pair(70, 4),
      pair(9, "$EXTMIN"), pair(10, n(bb.minX - pad)), pair(20, n(bb.minY - pad)), pair(30, "0.0"),
      pair(9, "$EXTMAX"), pair(10, n(bb.maxX + pad)), pair(20, n(bb.maxY + pad)), pair(30, "0.0"),
      pair(0, "ENDSEC"),

      pair(0, "SECTION"),
      pair(2, "TABLES"),
      pairs([[0, "TABLE"], [2, "LTYPE"], [5, handle()], [70, 1]]),
      pairs([
        [0, "LTYPE"], [5, handle()], [2, "CONTINUOUS"], [70, 0],
        [3, "Solid line"], [72, 65], [73, 0], [40, "0.0"]
      ]),
      pair(0, "ENDTAB"),
      layerTable.join("\n"),
      pairs([[0, "TABLE"], [2, "STYLE"], [5, handle()], [70, 1]]),
      pairs([
        [0, "STYLE"], [5, handle()], [2, "STANDARD"], [70, 0],
        [40, "0.0"], [41, "1.0"], [50, "0.0"], [71, 0], [42, "2.5"],
        [3, "txt"], [4, ""]
      ]),
      pair(0, "ENDTAB"),
      pair(0, "ENDSEC"),

      pair(0, "SECTION"),
      pair(2, "ENTITIES"),
      ents.join("\n"),
      pair(0, "ENDSEC"),
      pair(0, "EOF")
    ];
    return parts.filter(Boolean).join("\n") + "\n";
  }

  function svgEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function toSVG(state, opts) {
    const entities = state.entities || [];
    const layers = state.layers || [];
    const visible = new Set(layers.filter((l) => l.visible !== false).map((l) => l.id));
    const onlySel = opts && opts.selectionIds ? new Set(opts.selectionIds) : null;
    const includeDim = !!(opts && opts.includeDimensions);
    const filtered = entities.filter((e) => {
      if (onlySel && !onlySel.has(e.id)) return false;
      if (e.layer && visible.size && !visible.has(e.layer)) return false;
      if ((e.type === "dimension" || e.type === "text") && !includeDim) return false;
      return true;
    });
    const bb = bboxOf(filtered.length ? filtered : entities);
    const pad = 4;
    const minX = bb.minX - pad, minY = bb.minY - pad;
    const w = Math.max(1, bb.maxX - bb.minX + pad * 2);
    const h = Math.max(1, bb.maxY - bb.minY + pad * 2);
    const units = (opts && opts.units) || state.units || "mm";
    const svgUnit = units === "in" || units === "inch" || units === "inches" ? "in" : units === "cm" ? "cm" : units === "m" ? "m" : "mm";

    const colorOf = (e) => {
      if (e.color) return e.color;
      const ly = layers.find((l) => l.id === e.layer);
      return (ly && ly.color) || "#111111";
    };

    const paths = [];
    const stroke = (e) => `stroke="${colorOf(e)}" fill="none" stroke-width="0.25" stroke-linecap="round" stroke-linejoin="round"`;

    for (const e of filtered) {
      switch (e.type) {
        case "line":
          paths.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" ${stroke(e)} />`);
          break;
        case "circle":
          paths.push(`<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" ${stroke(e)} />`);
          break;
        case "arc": {
          const p0x = e.cx + Math.cos(e.a0) * e.r, p0y = e.cy + Math.sin(e.a0) * e.r;
          const p1x = e.cx + Math.cos(e.a1) * e.r, p1y = e.cy + Math.sin(e.a1) * e.r;
          let delta = e.a1 - e.a0;
          while (delta < 0) delta += Math.PI * 2;
          while (delta > Math.PI * 2) delta -= Math.PI * 2;
          const large = delta > Math.PI ? 1 : 0;
          paths.push(`<path d="M ${p0x} ${p0y} A ${e.r} ${e.r} 0 ${large} 1 ${p1x} ${p1y}" ${stroke(e)} />`);
          break;
        }
        case "ellipse": {
          const rot = ((e.rot || 0) * 180) / Math.PI;
          paths.push(`<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" transform="rotate(${rot} ${e.cx} ${e.cy})" ${stroke(e)} />`);
          break;
        }
        case "rect": {
          const pts = rectPoints(e);
          paths.push(`<polygon points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" ${stroke(e)} />`);
          break;
        }
        case "polyline":
        case "polygon": {
          const pts = polylineDrawPts(e);
          const tag = e.type === "polygon" || e.closed ? "polygon" : "polyline";
          paths.push(`<${tag} points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" ${stroke(e)} />`);
          break;
        }
        case "spline": {
          const pts = sampleSpline(e.points, !!e.closed, 16);
          const tag = e.closed ? "polygon" : "polyline";
          paths.push(`<${tag} points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" ${stroke(e)} />`);
          break;
        }
        case "text": {
          const rot = -((e.rot || 0) * 180) / Math.PI;
          paths.push(`<text transform="translate(${e.x} ${e.y}) scale(1,-1) rotate(${rot})" x="0" y="0" font-size="${e.height || 3}" fill="${colorOf(e)}" font-family="IBM Plex Sans, sans-serif">${svgEsc(e.text || "")}</text>`);
          break;
        }
        case "dimension": {
          const d = dimensionPrimitives(e);
          const style = `stroke="${colorOf(e)}" fill="none" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round"`;
          const line = (a, b) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${style} />`;
          const poly = (pts) => `<polygon points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" ${style} />`;
          paths.push(line(d.a, d.p1), line(d.b, d.p2), line(d.p1, d.p2), poly(d.arrow1), poly(d.arrow2));
          const angle = -d.textAngle;
          paths.push(`<text transform="translate(${d.labelX} ${d.labelY}) scale(1,-1) rotate(${angle})" x="0" y="0" text-anchor="middle" font-size="3.5" fill="${colorOf(e)}" font-family="IBM Plex Mono, monospace">${svgEsc(d.label + " " + units)}</text>`);
          break;
        }
        default:
          break;
      }
    }

    /* SVG Y is down: flip around X so CAD Y-up matches the file */
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}${svgUnit}" height="${h}${svgUnit}" viewBox="0 0 ${w} ${h}">
  <title>Schizzo</title>
  <g transform="translate(${-minX}, ${h + minY}) scale(1,-1)">
    ${paths.join("\n    ")}
  </g>
</svg>
`;
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function parseDxfPairs(text) {
    const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const pairs = [];
    let i = 0;
    while (i < lines.length) {
      const c = parseInt(String(lines[i]).trim(), 10);
      i++;
      if (!Number.isFinite(c)) continue;
      const v = i < lines.length ? String(lines[i]) : "";
      i++;
      pairs.push([c, v.replace(/^\s+/, "").replace(/\s+$/, "")]);
    }
    return pairs;
  }

  function fromDXF(text) {
    const pairs = parseDxfPairs(text);
    let section = "";
    let units = "mm";
    const entities = [];
    const extraLayers = [];
    function mapDxfLayer(ly) {
      const raw = String(ly || "0").trim() || "0";
      if (/^fori$/i.test(raw)) return "fori";
      if (/quote/i.test(raw)) return "quote";
      if (raw === "0") return "0";
      let found = extraLayers.find((l) => l.name === raw);
      if (!found) {
        const colors = ["#3ecf8e", "#e05656", "#c084fc", "#f5a623", "#4db2ff", "#e8eaef"];
        found = { id: "ly" + extraLayers.length, name: raw, color: colors[extraLayers.length % colors.length], visible: true, locked: false };
        extraLayers.push(found);
      }
      return found.id;
    }
    let i = 0;

    function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

    while (i < pairs.length) {
      const [code, val] = pairs[i];
      if (code === 0 && val === "SECTION") {
        const name = pairs[i + 1] && pairs[i + 1][0] === 2 ? pairs[i + 1][1] : "";
        section = name;
        i += 2;
        continue;
      }
      if (code === 0 && val === "ENDSEC") { section = ""; i++; continue; }
      if (code === 9 && val === "$INSUNITS" && pairs[i + 1] && pairs[i + 1][0] === 70) {
        const u = parseInt(pairs[i + 1][1], 10);
        units = u === 1 ? "in" : u === 5 ? "cm" : u === 6 ? "m" : "mm";
        i += 2;
        continue;
      }
      if (section === "ENTITIES" && code === 0) {
        const type = val;
        if (type === "ENDSEC" || type === "EOF") { i++; continue; }
        const e = { _type: type, pts: [], flags: 0 };
        i++;
        let cur = null;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          const n = num(v);
          if (c === 8) e.layer = v;
          else if (c === 10) {
            if (type === "LWPOLYLINE") {
              if (cur) e.pts.push(cur);
              cur = { x: n, y: 0, bulge: 0 };
            } else e.x = n;
          } else if (c === 20) {
            if (type === "LWPOLYLINE") { if (cur) cur.y = n; }
            else e.y = n;
          } else if (c === 11) e.x2 = n;
          else if (c === 21) e.y2 = n;
          else if (c === 30) { /* z ignore */ }
          else if (c === 40) e.r = n;
          else if (c === 41) e.r2 = n;
          else if (c === 42) {
            if (type === "LWPOLYLINE" && cur) cur.bulge = n;
            else e.ratio = n;
          } else if (c === 50) e.a0 = n * Math.PI / 180;
          else if (c === 51) e.a1 = n * Math.PI / 180;
          else if (c === 70) e.flags = parseInt(v, 10) || 0;
          else if (c === 1) e.text = v;
          i++;
        }
        if (cur) e.pts.push(cur);

        /* old POLYLINE: following VERTEX until SEQEND */
        if (type === "POLYLINE") {
          const pts = [];
          while (i < pairs.length) {
            if (pairs[i][0] === 0 && pairs[i][1] === "SEQEND") { i++; break; }
            if (pairs[i][0] === 0 && pairs[i][1] === "VERTEX") {
              i++;
              let vx = 0, vy = 0, vb = 0;
              while (i < pairs.length && pairs[i][0] !== 0) {
                const [c, v] = pairs[i];
                if (c === 10) vx = num(v);
                else if (c === 20) vy = num(v);
                else if (c === 42) vb = num(v);
                i++;
              }
              pts.push({ x: vx, y: vy, bulge: vb });
              continue;
            }
            i++;
          }
          e.pts = pts;
        }

        const ly = e.layer || "0";
        const layerId = mapDxfLayer(ly);
        if (type === "LINE") {
          entities.push({ type: "line", x1: e.x, y1: e.y, x2: e.x2, y2: e.y2, layer: layerId });
        } else if (type === "CIRCLE") {
          entities.push({ type: "circle", cx: e.x, cy: e.y, r: e.r, layer: layerId });
        } else if (type === "ARC") {
          entities.push({ type: "arc", cx: e.x, cy: e.y, r: e.r, a0: e.a0 || 0, a1: e.a1 || 0, layer: layerId });
        } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
          entities.push({
            type: "polyline",
            points: e.pts.map((p) => ({ x: p.x, y: p.y, bulge: p.bulge || 0 })),
            closed: !!(e.flags & 1),
            layer: layerId
          });
        } else if (type === "ELLIPSE") {
          const mx = e.x2 || 0, my = e.y2 || 0;
          const rx = Math.hypot(mx, my);
          const ry = rx * (e.r || e.ratio || 1);
          const rot = Math.atan2(my, mx);
          entities.push({ type: "ellipse", cx: e.x, cy: e.y, rx, ry, rot, layer: layerId });
        } else if (type === "TEXT" && e.text) {
          entities.push({ type: "text", x: e.x, y: e.y, text: e.text, height: e.r || 3, rot: e.a0 || 0, layer: layerId });
        }
        continue;
      }
      i++;
    }

    const layers = [
      { id: "0", name: "0 Contorno", color: "#e8eaef", visible: true, locked: false },
      { id: "fori", name: "Fori", color: "#4db2ff", visible: true, locked: false },
      { id: "quote", name: "Quote", color: "#f0c040", visible: true, locked: false }
    ];
    return { entities, units, layers: layers.concat(extraLayers) };
  }

  function profileRing(e) {
    if (e.type === "rect") return rectPoints(e);
    if (e.type === "circle") {
      const n = 32, pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: e.cx + Math.cos(a) * e.r, y: e.cy + Math.sin(a) * e.r });
      }
      return pts;
    }
    if (e.type === "ellipse") {
      const n = 32, pts = [], rot = e.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const lx = Math.cos(a) * e.rx, ly = Math.sin(a) * e.ry;
        pts.push({ x: e.cx + lx * c - ly * s, y: e.cy + lx * s + ly * c });
      }
      return pts;
    }
    if (e.type === "polyline" || e.type === "polygon") {
      const pts = polylineDrawPts(e).map((p) => ({ x: p.x, y: p.y }));
      if (pts.length > 2) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) pts.pop();
      }
      return pts.length >= 3 ? pts : null;
    }
    return null;
  }

  function toSTL(state, opts) {
    const T = Math.max(0.2, (opts && opts.thickness) || 40);
    const layers = state.layers || [];
    const visible = new Set(layers.filter((l) => l.visible !== false).map((l) => l.id));
    const skip = new Set(["quote", "foto"]);
    const tris = [];
    const nrm = (a, b, c) => {
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const L = Math.hypot(nx, ny, nz) || 1;
      return { x: nx / L, y: ny / L, z: nz / L };
    };
    const tri = (a, b, c) => {
      const n = nrm(a, b, c);
      tris.push({ n, a, b, c });
    };
    for (const e of state.entities || []) {
      if (e.layer && visible.size && !visible.has(e.layer)) continue;
      if (skip.has(e.layer) || e.type === "dimension" || e.type === "text" || e.type === "image") continue;
      const ring = profileRing(e);
      if (!ring || ring.length < 3) continue;
      const bot = ring.map((p) => ({ x: p.x, y: p.y, z: 0 }));
      const top = ring.map((p) => ({ x: p.x, y: p.y, z: T }));
      const n = ring.length;
      for (let i = 1; i < n - 1; i++) {
        tri(bot[0], bot[i], bot[i + 1]);
        tri(top[0], top[i + 1], top[i]);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tri(bot[i], bot[j], top[j]);
        tri(bot[i], top[j], top[i]);
      }
    }
    const f = (v) => (Math.round(v * 1e5) / 1e5);
    const lines = ["solid schizzo"];
    for (const t of tris) {
      lines.push(`  facet normal ${f(t.n.x)} ${f(t.n.y)} ${f(t.n.z)}`);
      lines.push("    outer loop");
      lines.push(`      vertex ${f(t.a.x)} ${f(t.a.y)} ${f(t.a.z)}`);
      lines.push(`      vertex ${f(t.b.x)} ${f(t.b.y)} ${f(t.b.z)}`);
      lines.push(`      vertex ${f(t.c.x)} ${f(t.c.y)} ${f(t.c.z)}`);
      lines.push("    endloop");
      lines.push("  endfacet");
    }
    lines.push("endsolid schizzo");
    return lines.join("\n") + "\n";
  }

  global.SchizzoExport = {
    toDXF,
    fromDXF,
    toSVG,
    toSTL,
    bboxOf,
    rectPoints,
    sampleSpline,
    dimensionPrimitives,
    bulgeToArc,
    sampleBulge,
    polylineDrawPts,
    profileRing,
    download
  };
})(window);
