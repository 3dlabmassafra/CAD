/* Schizzo — CAD 2D di precisione per Onshape */
(() => {
  const TAU = Math.PI * 2;
  const EPS = 1e-6;
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const hintEl = document.getElementById("hint");
  const measureEl = document.getElementById("measure");
  const cmdEl = document.getElementById("cmd");
  const overlay = document.getElementById("overlay");
  const modal = document.getElementById("modal");
  const ctxMenu = document.getElementById("ctx");

  const $ = (id) => document.getElementById(id);
  const imgCache = new Map();
  function imageOf(e) {
    const src = e && e.src;
    if (!src) return null;
    if (imgCache.has(src)) return imgCache.get(src);
    const im = new Image();
    im.onload = () => draw();
    im.src = src;
    imgCache.set(src, im);
    return im;
  }
  function ensureLayer(id, name, color, locked) {
    if (state.layers.some((l) => l.id === id)) return;
    state.layers.push({ id, name: name || id, color: color || "#8b93a7", visible: true, locked: !!locked });
  }

  function uid() {
    return "e" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function ang(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  function polar(o, a, r) { return { x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r }; }
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmt(v, d = 2) { return (Math.round(v * 10 ** d) / 10 ** d).toFixed(d); }
  function deg(a) { return a * 180 / Math.PI; }
  function normAng(a) { a = a % TAU; if (a < 0) a += TAU; return a; }
  function deep(o) { return JSON.parse(JSON.stringify(o)); }

  function angleInArc(a, a0, a1) {
    const na = normAng(a), n0 = normAng(a0), n1 = normAng(a1);
    if (n0 <= n1) return na + 1e-8 >= n0 && na - 1e-8 <= n1;
    return na + 1e-8 >= n0 || na - 1e-8 <= n1;
  }

  function circumcircle(p1, p2, p3) {
    const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { cx: ux, cy: uy, r: Math.hypot(ux - ax, uy - ay) };
  }

  function arcFrom3(p1, p2, p3) {
    const c = circumcircle(p1, p2, p3);
    if (!c || c.r < EPS) return null;
    const a1 = Math.atan2(p1.y - c.cy, p1.x - c.cx);
    const a2 = Math.atan2(p2.y - c.cy, p2.x - c.cx);
    const a3 = Math.atan2(p3.y - c.cy, p3.x - c.cx);
    if (angleInArc(a2, a1, a3)) return { cx: c.cx, cy: c.cy, r: c.r, a0: a1, a1: a3 };
    return { cx: c.cx, cy: c.cy, r: c.r, a0: a1, a1: a3 + TAU };
  }

  function segIntersect(a, b, c, d) {
    const d1x = b.x - a.x, d1y = b.y - a.y;
    const d2x = d.x - c.x, d2y = d.y - c.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
    const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / den;
    if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8)
      return { x: a.x + t * d1x, y: a.y + t * d1y };
    return null;
  }

  function lineCircleHits(a, b, c, r, unbounded) {
    const d = { x: b.x - a.x, y: b.y - a.y };
    const f = { x: a.x - c.x, y: a.y - c.y };
    const A = d.x * d.x + d.y * d.y;
    if (A < EPS) return [];
    const B = 2 * (f.x * d.x + f.y * d.y);
    const C = f.x * f.x + f.y * f.y - r * r;
    let disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    disc = Math.sqrt(disc);
    const pts = [];
    for (const t of [(-B - disc) / (2 * A), (-B + disc) / (2 * A)]) {
      if (unbounded || (t >= -1e-8 && t <= 1 + 1e-8)) pts.push({ x: a.x + t * d.x, y: a.y + t * d.y });
    }
    return pts;
  }

  function circleCircleHits(c1, r1, c2, r2) {
    const dx = c2.x - c1.x, dy = c2.y - c1.y;
    const d = Math.hypot(dx, dy);
    if (d < EPS || d > r1 + r2 + 1e-8 || d < Math.abs(r1 - r2) - 1e-8) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h2 = r1 * r1 - a * a;
    if (h2 < 0) return [];
    const h = Math.sqrt(Math.max(0, h2));
    const mx = c1.x + a * dx / d, my = c1.y + a * dy / d;
    const px = -dy * h / d, py = dx * h / d;
    const p = [{ x: mx + px, y: my + py }];
    if (h > 1e-8) p.push({ x: mx - px, y: my - py });
    return p;
  }

  function projectSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < EPS) return { ...a, t: 0 };
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
    return { x: a.x + t * dx, y: a.y + t * dy, t };
  }

  function signedOffset(a, b, p) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return ((p.x - a.x) * (-dy) + (p.y - a.y) * dx) / len;
  }

  function filletVertex(A, B, C, r) {
    const v1x = A.x - B.x, v1y = A.y - B.y;
    const v2x = C.x - B.x, v2y = C.y - B.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < EPS || l2 < EPS || r <= 0) return null;
    const u1x = v1x / l1, u1y = v1y / l1;
    const u2x = v2x / l2, u2y = v2y / l2;
    const dot = clamp(u1x * u2x + u1y * u2y, -1, 1);
    const alpha = Math.acos(dot);
    if (alpha < 0.03 || Math.abs(Math.PI - alpha) < 0.03) return null;
    const t = r / Math.tan(alpha / 2);
    if (t > l1 - 1e-6 || t > l2 - 1e-6) return null;
    const p1 = { x: B.x + u1x * t, y: B.y + u1y * t };
    const p2 = { x: B.x + u2x * t, y: B.y + u2y * t };
    const inx = -u1x, iny = -u1y;
    const cross = inx * u2y - iny * u2x;
    const sweep = Math.PI - alpha;
    let bulge = Math.tan(sweep / 4);
    if (cross < 0) bulge = -bulge;
    return { p1, p2, bulge };
  }

  function filletTwoLines(l1, l2, r) {
    const A = { x: l1.x1, y: l1.y1 }, B = { x: l1.x2, y: l1.y2 };
    const C = { x: l2.x1, y: l2.y1 }, D = { x: l2.x2, y: l2.y2 };
    const ip = lineIntersect(A, B, C, D);
    if (!ip) return false;
    const k1 = dist(ip, A) >= dist(ip, B) ? A : B;
    const k2 = dist(ip, C) >= dist(ip, D) ? C : D;
    const fil = filletVertex(k1, ip, k2, r);
    if (!fil) return false;
    l1.x1 = k1.x; l1.y1 = k1.y; l1.x2 = fil.p1.x; l1.y2 = fil.p1.y;
    l2.x1 = k2.x; l2.y1 = k2.y; l2.x2 = fil.p2.x; l2.y2 = fil.p2.y;
    const arc = SchizzoExport.bulgeToArc(fil.p1, fil.p2, fil.bulge);
    if (arc) {
      const ent = { id: uid(), type: "arc", cx: arc.cx, cy: arc.cy, r: arc.r, layer: l1.layer, color: l1.color };
      if (arc.ccw) { ent.a0 = arc.a0; ent.a1 = arc.a1; }
      else { ent.a0 = arc.a1; ent.a1 = arc.a0; }
      state.entities.push(ent);
    }
    return true;
  }

  function chamferTwoLines(l1, l2, d) {
    const A = { x: l1.x1, y: l1.y1 }, B = { x: l1.x2, y: l1.y2 };
    const C = { x: l2.x1, y: l2.y1 }, D = { x: l2.x2, y: l2.y2 };
    const ip = lineIntersect(A, B, C, D);
    if (!ip) return false;
    const k1 = dist(ip, A) >= dist(ip, B) ? A : B;
    const k2 = dist(ip, C) >= dist(ip, D) ? C : D;
    const len1 = dist(k1, ip), len2 = dist(k2, ip);
    if (d > len1 - 1e-6 || d > len2 - 1e-6 || len1 < EPS || len2 < EPS) return false;
    const p1 = { x: ip.x + (k1.x - ip.x) / len1 * d, y: ip.y + (k1.y - ip.y) / len1 * d };
    const p2 = { x: ip.x + (k2.x - ip.x) / len2 * d, y: ip.y + (k2.y - ip.y) / len2 * d };
    l1.x1 = k1.x; l1.y1 = k1.y; l1.x2 = p1.x; l1.y2 = p1.y;
    l2.x1 = k2.x; l2.y1 = k2.y; l2.x2 = p2.x; l2.y2 = p2.y;
    state.entities.push({ id: uid(), type: "line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, layer: l1.layer, color: l1.color });
    return true;
  }

  function filletEntity(e, r) {
    if (e.type === "rect") {
      const pts = rectPts(e).map((p) => ({ x: p.x, y: p.y }));
      e.type = "polyline";
      e.points = pts;
      e.closed = true;
    }
    if (e.type !== "polyline" && e.type !== "polygon") return false;
    const pts = (e.points || []).map((p) => ({ x: p.x, y: p.y }));
    const n = pts.length;
    const closed = e.type === "polygon" || e.closed;
    if (n < 3) return false;
    const out = [];
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        out.push({ x: pts[i].x, y: pts[i].y, bulge: 0 });
        continue;
      }
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const fil = filletVertex(prev, cur, next, r);
      if (!fil) out.push({ x: cur.x, y: cur.y, bulge: 0 });
      else {
        any = true;
        out.push({ x: fil.p1.x, y: fil.p1.y, bulge: fil.bulge });
        out.push({ x: fil.p2.x, y: fil.p2.y, bulge: 0 });
      }
    }
    if (!any) return false;
    e.type = "polyline";
    e.closed = closed;
    e.points = out;
    return true;
  }

  function chamferEntity(e, d) {
    if (e.type === "rect") {
      const pts = rectPts(e).map((p) => ({ x: p.x, y: p.y }));
      e.type = "polyline";
      e.points = pts;
      e.closed = true;
    }
    if (e.type !== "polyline" && e.type !== "polygon") return false;
    const pts = (e.points || []).map((pt) => ({ x: pt.x, y: pt.y }));
    const n = pts.length;
    const closed = e.type === "polygon" || e.closed;
    if (n < 3 || d <= 0) return false;
    const out = [];
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        out.push({ x: pts[i].x, y: pts[i].y, bulge: 0 });
        continue;
      }
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
      const v2x = next.x - cur.x, v2y = next.y - cur.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 < d + 1e-6 || l2 < d + 1e-6) {
        out.push({ x: cur.x, y: cur.y, bulge: 0 });
        continue;
      }
      any = true;
      out.push({ x: cur.x + (v1x / l1) * d, y: cur.y + (v1y / l1) * d, bulge: 0 });
      out.push({ x: cur.x + (v2x / l2) * d, y: cur.y + (v2y / l2) * d, bulge: 0 });
    }
    if (!any) return false;
    e.type = "polyline";
    e.closed = closed;
    e.points = out;
    return true;
  }

  function cloneTranslated(e, dx, dy) {
    const c = deep(e);
    c.id = uid();
    translateEntity(c, dx, dy);
    return c;
  }

  function lineIntersect(a, b, c, d) {
    const d1x = b.x - a.x, d1y = b.y - a.y;
    const d2x = d.x - c.x, d2y = d.y - c.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
    return { x: a.x + t * d1x, y: a.y + t * d1y };
  }

  function projectLine(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < EPS) return { ...a, t: 0 };
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    return { x: a.x + t * dx, y: a.y + t * dy, t };
  }

  function shoelace(pts) {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  }

  function ringPts(pts) {
    const out = [];
    for (const p of pts) {
      if (!out.length || dist(out[out.length - 1], p) > 1e-6) out.push({ x: p.x, y: p.y });
    }
    if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
    return out;
  }

  function entityArea(e) {
    if (e.type === "circle") return Math.PI * e.r * e.r;
    if (e.type === "ellipse") return Math.PI * Math.abs(e.rx * e.ry);
    if (e.type === "rect") return Math.abs(e.w * e.h);
    if ((e.type === "polyline" || e.type === "polygon") && isClosedEntity(e)) {
      return Math.abs(shoelace(ringPts(SchizzoExport.polylineDrawPts(e))));
    }
    return 0;
  }

  function offsetClosedPts(pts, d) {
    pts = ringPts(pts);
    const n = pts.length;
    if (n < 3 || !d) return null;
    const area = shoelace(pts);
    const outS = area >= 0 ? -1 : 1;
    const lines = [];
    for (let i = 0; i < n; i++) {
      const A = pts[i], B = pts[(i + 1) % n];
      const ex = B.x - A.x, ey = B.y - A.y;
      const len = Math.hypot(ex, ey);
      if (len < EPS) continue;
      const nx = -ey / len * outS, ny = ex / len * outS;
      lines.push({
        a: { x: A.x + nx * d, y: A.y + ny * d },
        b: { x: B.x + nx * d, y: B.y + ny * d }
      });
    }
    const m = lines.length;
    if (m < 3) return null;
    const result = [];
    const maxM = Math.abs(d) * 12 + 1;
    for (let i = 0; i < m; i++) {
      const L1 = lines[(i - 1 + m) % m], L2 = lines[i];
      const ip = lineIntersect(L1.a, L1.b, L2.a, L2.b);
      if (ip && dist(ip, L2.a) <= maxM) result.push(ip);
      else {
        result.push(L1.b);
        result.push(L2.a);
      }
    }
    const ring = ringPts(result);
    return ring.length >= 3 ? ring : null;
  }

  function offsetOpenPts(pts, d) {
    const n = pts.length;
    if (n < 2 || !d) return null;
    const lines = [];
    for (let i = 0; i < n - 1; i++) {
      const A = pts[i], B = pts[i + 1];
      const ex = B.x - A.x, ey = B.y - A.y;
      const len = Math.hypot(ex, ey);
      if (len < EPS) continue;
      const nx = -ey / len, ny = ex / len;
      lines.push({
        a: { x: A.x + nx * d, y: A.y + ny * d },
        b: { x: B.x + nx * d, y: B.y + ny * d }
      });
    }
    if (!lines.length) return null;
    const result = [lines[0].a];
    for (let i = 1; i < lines.length; i++) {
      const ip = lineIntersect(lines[i - 1].a, lines[i - 1].b, lines[i].a, lines[i].b);
      result.push(ip || lines[i].a);
    }
    result.push(lines[lines.length - 1].b);
    return result;
  }

  function offsetEntity(e, d) {
    if (e.type === "circle" || e.type === "arc") {
      const nr = e.r + d;
      if (nr <= 0.05) return false;
      e.r = nr;
      return true;
    }
    if (e.type === "ellipse") {
      const rx = e.rx + d, ry = e.ry + d;
      if (rx <= 0.05 || ry <= 0.05) return false;
      e.rx = rx; e.ry = ry;
      return true;
    }
    if (e.type === "line") {
      const len = dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
      if (len < EPS) return false;
      const nx = -(e.y2 - e.y1) / len, ny = (e.x2 - e.x1) / len;
      e.x1 += nx * d; e.y1 += ny * d;
      e.x2 += nx * d; e.y2 += ny * d;
      return true;
    }
    let pts;
    if (e.type === "rect") pts = rectPts(e);
    else if (e.type === "polyline" || e.type === "polygon") {
      pts = SchizzoExport.polylineDrawPts(e);
      if (!isClosedEntity(e)) {
        const off = offsetOpenPts(pts, d);
        if (!off || off.length < 2) return false;
        e.type = "polyline";
        e.closed = false;
        e.points = off.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
        return true;
      }
    } else return false;
    const off = offsetClosedPts(pts, d);
    if (!off) return false;
    e.type = "polyline";
    e.closed = true;
    e.points = off.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
    return true;
  }

  function offsetSelection(sign) {
    const inp = $("offset-d");
    const d = sign * Math.abs(parseFloat(inp && inp.value) || 2);
    if (!state.selection.length) {
      hintEl.textContent = "Seleziona profili o linee da offsettare.";
      return;
    }
    const news = [];
    selectedEntities().forEach((e) => {
      const c = deep(e);
      c.id = uid();
      if (offsetEntity(c, d)) {
        state.entities.push(c);
        news.push(c.id);
      }
    });
    if (news.length) {
      state.selection = news;
      pushHist();
      refreshUI();
      hintEl.textContent = `Offset ${news.length} · ${d > 0 ? "esterno" : "interno"} ${fmt(Math.abs(d), 2)} ${state.units}`;
    } else {
      hintEl.textContent = "Offset: nessuna geometria adatta (profili, cerchi, archi, linee).";
    }
    draw();
  }

  function offsetDistanceToward(e, p) {
    if (e.type === "circle" || e.type === "arc") {
      return dist(p, { x: e.cx, y: e.cy }) - e.r;
    }
    if (e.type === "line") {
      return signedOffset({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, p);
    }
    let pts;
    if (e.type === "rect") pts = rectPts(e);
    else if (e.type === "polyline" || e.type === "polygon") pts = SchizzoExport.polylineDrawPts(e);
    else if (e.type === "ellipse") {
      const rx = e.rx || 1, ry = e.ry || 1;
      const u = (p.x - e.cx) / rx, v = (p.y - e.cy) / ry;
      const nrm = Math.hypot(u, v) || 1;
      return (nrm - 1) * Math.max(rx, ry);
    } else return 0;
    const ring = ringPts(pts);
    const n = ring.length;
    if (n < 2) return 0;
    const area = shoelace(ring);
    const outS = area >= 0 ? -1 : 1;
    let best = Infinity, signed = 0;
    const segs = isClosedEntity(e) ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const A = ring[i], B = ring[(i + 1) % n];
      const foot = projectSeg(p, A, B);
      const d0 = dist(p, foot);
      if (d0 < best) {
        best = d0;
        const ex = B.x - A.x, ey = B.y - A.y, len = Math.hypot(ex, ey) || 1;
        const nx = -ey / len * outS, ny = ex / len * outS;
        signed = (p.x - A.x) * nx + (p.y - A.y) * ny;
      }
    }
    return signed;
  }

  function circleTangents(p, c, r) {
    const vx = p.x - c.x, vy = p.y - c.y;
    const dist2 = vx * vx + vy * vy;
    if (dist2 <= r * r + 1e-8) return [];
    const dd = Math.sqrt(dist2);
    const ang0 = Math.atan2(vy, vx);
    const phi = Math.acos(clamp(r / dd, -1, 1));
    return [
      { x: c.x + r * Math.cos(ang0 + phi), y: c.y + r * Math.sin(ang0 + phi) },
      { x: c.x + r * Math.cos(ang0 - phi), y: c.y + r * Math.sin(ang0 - phi) }
    ];
  }

  function explodeSelection() {
    if (!state.selection.length) {
      hintEl.textContent = "Seleziona rettangoli o polilinee da esplodere.";
      return;
    }
    const sel = new Set(state.selection);
    const keep = [];
    const news = [];
    for (const e of state.entities) {
      if (!sel.has(e.id)) { keep.push(e); continue; }
      const layer = e.layer, color = e.color;
      const pushLine = (a, b) => {
        const line = { id: uid(), type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, color };
        keep.push(line); news.push(line.id);
      };
      const pushArc = (a, b, bulge) => {
        const arc = SchizzoExport.bulgeToArc(a, b, bulge);
        if (!arc) { pushLine(a, b); return; }
        const ent = { id: uid(), type: "arc", cx: arc.cx, cy: arc.cy, r: arc.r, layer, color };
        if (arc.ccw) { ent.a0 = arc.a0; ent.a1 = arc.a1; }
        else { ent.a0 = arc.a1; ent.a1 = arc.a0; }
        keep.push(ent); news.push(ent.id);
      };
      if (e.type === "rect") {
        const rp = rectPts(e);
        for (let i = 0; i < 4; i++) pushLine(rp[i], rp[(i + 1) % 4]);
      } else if (e.type === "polyline" || e.type === "polygon") {
        const pts = e.points || [];
        const nn = pts.length;
        const closed = e.type === "polygon" || e.closed;
        const segs = closed ? nn : nn - 1;
        for (let i = 0; i < segs; i++) {
          const a = pts[i], b = pts[(i + 1) % nn];
          if (a.bulge && Math.abs(a.bulge) > 1e-8) pushArc(a, b, a.bulge);
          else pushLine(a, b);
        }
      } else keep.push(e);
    }
    if (!news.length) {
      hintEl.textContent = "Esplodi: solo rettangoli e polilinee.";
      return;
    }
    state.entities = keep;
    state.selection = news;
    pushHist();
    refreshUI();
    hintEl.textContent = `Esplosi in ${news.length} tratti`;
    draw();
  }

  function collectCutsOnLine(e) {
    const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
    const len2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
    if (len2 < EPS) return null;
    const ts = [0, 1];
    const addT = (pt) => {
      const t = ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / len2;
      if (t > 1e-4 && t < 1 - 1e-4) ts.push(t);
    };
    for (const o of state.entities) {
      if (o.id === e.id || !layerVisible(o.layer)) continue;
      for (const seg of entitySegs(o)) {
        const hit = segIntersect(a, b, seg[0], seg[1]);
        if (hit) addT(hit);
      }
      for (const cir of entityCircles(o)) {
        for (const hit of lineCircleHits(a, b, cir.c, cir.r)) {
          if (cir.arc) {
            const an = Math.atan2(hit.y - cir.c.y, hit.x - cir.c.x);
            if (!angleInArc(an, cir.arc.a0, cir.arc.a1)) continue;
          }
          addT(hit);
        }
      }
    }
    ts.sort((u, v) => u - v);
    const uniq = [];
    ts.forEach((t) => { if (!uniq.length || Math.abs(t - uniq[uniq.length - 1]) > 1e-5) uniq.push(t); });
    return { a, b, len2, ts: uniq };
  }

  function trimAt(p) {
    const hit = pickAt(p);
    if (!hit || hit.type !== "line") return false;
    const c = collectCutsOnLine(hit);
    if (!c || c.ts.length < 3) return false;
    const tClick = clamp(((p.x - c.a.x) * (c.b.x - c.a.x) + (p.y - c.a.y) * (c.b.y - c.a.y)) / c.len2, 0, 1);
    let i = 0;
    for (let k = 0; k < c.ts.length - 1; k++) {
      if (tClick >= c.ts[k] - 1e-8 && tClick <= c.ts[k + 1] + 1e-8) { i = k; break; }
    }
    const t0 = c.ts[i], t1 = c.ts[i + 1];
    if (t1 - t0 < 1e-6) return false;
    const lerpT = (t) => ({ x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t });
    if (t0 <= 1e-6 && t1 >= 1 - 1e-6) {
      state.entities = state.entities.filter((x) => x.id !== hit.id);
      state.selection = state.selection.filter((id) => id !== hit.id);
      return true;
    }
    if (t0 <= 1e-6) {
      const q = lerpT(t1);
      hit.x1 = q.x; hit.y1 = q.y;
      return true;
    }
    if (t1 >= 1 - 1e-6) {
      const q = lerpT(t0);
      hit.x2 = q.x; hit.y2 = q.y;
      return true;
    }
    const q0 = lerpT(t0), q1 = lerpT(t1);
    const nent = { id: uid(), type: "line", x1: q1.x, y1: q1.y, x2: hit.x2, y2: hit.y2, layer: hit.layer, color: hit.color };
    hit.x2 = q0.x; hit.y2 = q0.y;
    state.entities.push(nent);
    return true;
  }

  function extendAt(p) {
    const hit = pickAt(p);
    if (!hit || hit.type !== "line") return false;
    const a = { x: hit.x1, y: hit.y1 }, b = { x: hit.x2, y: hit.y2 };
    const len = dist(a, b);
    if (len < EPS) return false;
    const tClick = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
    const fromStart = tClick < 0.5;
    const origin = fromStart ? b : a;
    const dir = fromStart
      ? { x: a.x - b.x, y: a.y - b.y }
      : { x: b.x - a.x, y: b.y - a.y };
    const dl = Math.hypot(dir.x, dir.y) || 1;
    dir.x /= dl; dir.y /= dl;
    const far = { x: origin.x + dir.x * 1e6, y: origin.y + dir.y * 1e6 };
    let best = null, bd = Infinity;
    const consider = (pt) => {
      const along = (pt.x - origin.x) * dir.x + (pt.y - origin.y) * dir.y;
      if (along < 1e-4) return;
      if (along < bd) { bd = along; best = pt; }
    };
    for (const o of state.entities) {
      if (o.id === hit.id || !layerVisible(o.layer)) continue;
      for (const seg of entitySegs(o)) {
        const ip = lineIntersect(origin, far, seg[0], seg[1]);
        if (!ip) continue;
        const sx = seg[1].x - seg[0].x, sy = seg[1].y - seg[0].y;
        const sl2 = sx * sx + sy * sy || 1;
        const u = ((ip.x - seg[0].x) * sx + (ip.y - seg[0].y) * sy) / sl2;
        if (u >= -1e-6 && u <= 1 + 1e-6) consider(ip);
      }
      for (const cir of entityCircles(o)) {
        for (const ip of lineCircleHits(origin, far, cir.c, cir.r, true)) {
          if (cir.arc) {
            const an = Math.atan2(ip.y - cir.c.y, ip.x - cir.c.x);
            if (!angleInArc(an, cir.arc.a0, cir.arc.a1)) continue;
          }
          consider(ip);
        }
      }
    }
    if (!best) return false;
    if (fromStart) { hit.x1 = best.x; hit.y1 = best.y; }
    else { hit.x2 = best.x; hit.y2 = best.y; }
    return true;
  }

  function breakAt(p) {
    const hit = pickAt(p);
    if (!hit || hit.type !== "line") return false;
    const a = { x: hit.x1, y: hit.y1 }, b = { x: hit.x2, y: hit.y2 };
    const foot = projectSeg(p, a, b);
    const len = dist(a, b);
    if (len < EPS) return false;
    const t = dist(a, foot) / len;
    if (t < 0.02 || t > 0.98) return false;
    const nent = { id: uid(), type: "line", x1: foot.x, y1: foot.y, x2: hit.x2, y2: hit.y2, layer: hit.layer, color: hit.color };
    hit.x2 = foot.x; hit.y2 = foot.y;
    state.entities.push(nent);
    return true;
  }

  function scaleAllEntities(k) {
    const o = { x: 0, y: 0 };
    state.entities.forEach((e) => scaleEntity(e, o, k));
  }

  /* ---------- state ---------- */
  const state = {
    units: "mm",
    entities: [],
    layers: [
      { id: "0", name: "0 Contorno", color: "#e8eaef", visible: true, locked: false },
      { id: "fori", name: "Fori", color: "#4db2ff", visible: true, locked: false },
      { id: "ferramenta", name: "Ferramenta", color: "#c084fc", visible: true, locked: false },
      { id: "foto", name: "Foto", color: "#8b93a7", visible: true, locked: true },
      { id: "quote", name: "Quote", color: "#f0c040", visible: true, locked: false }
    ],
    layer: "0",
    selection: [],
    tool: "select",
    grid: true,
    gridStep: 5,
    snapObj: true,
    ortho: false,
    polar: false,
    view: { x: 0, y: 0, scale: 5 },
    view3d: false,
    thickness: 40,
    iso: { yaw: 0.7, pitch: 0.45, zoom: 1, panX: 0, panY: 0 },
    draft: null,
    hoverSnap: null,
    hoverId: null,
    history: [],
    histIndex: -1,
    clipboard: [],
    name: "senza-nome"
  };

  let cssW = 800, cssH = 600;
  let spacePan = false;
  let panning = false;
  let isoOrbit = false;
  let panLast = null;
  let boxSel = null;
  let dragging = null;
  let lastMouse = { x: 0, y: 0 };
  let lastWorld = { x: 0, y: 0 };
  let lastPoint = null;
  let cmdBuf = [];
  let pointerDown = false;
  let lastCmd = "select";
  let savedAt = 0;
  const pinchPtrs = new Map();
  let pinch = null;

  function markSaved() { savedAt = state.histIndex; }
  function isDirty() { return state.histIndex !== savedAt; }

  function layerById(id) {
    return state.layers.find((l) => l.id === id) || state.layers[0];
  }
  function layerVisible(id) {
    const l = layerById(id);
    return l && l.visible !== false;
  }
  function layerLocked(id) {
    const l = layerById(id);
    return !!(l && l.locked);
  }
  function colorOf(e) {
    if (e.color) return e.color;
    return layerById(e.layer).color || "#e8eaef";
  }

  /* ---------- view ---------- */
  function worldToScreen(p) {
    return {
      x: cssW / 2 + (p.x - state.view.x) * state.view.scale,
      y: cssH / 2 - (p.y - state.view.y) * state.view.scale
    };
  }
  function screenToWorld(x, y) {
    return {
      x: state.view.x + (x - cssW / 2) / state.view.scale,
      y: state.view.y - (y - cssH / 2) / state.view.scale
    };
  }
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    cssW = r.width; cssH = r.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ---------- entities geometry ---------- */
  function rectPts(e) { return SchizzoExport.rectPoints(e); }

  function entityPoints(e) {
    switch (e.type) {
      case "line": return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
      case "rect": return rectPts(e);
      case "circle": return [{ x: e.cx, y: e.cy }];
      case "arc": return [
        { x: e.cx, y: e.cy },
        polar({ x: e.cx, y: e.cy }, e.a0, e.r),
        polar({ x: e.cx, y: e.cy }, e.a1, e.r)
      ];
      case "ellipse": return [{ x: e.cx, y: e.cy }];
      case "polyline":
      case "polygon":
      case "spline": return e.points || [];
      case "text": return [{ x: e.x, y: e.y }];
      case "image": return [{ x: e.x, y: e.y }, { x: e.x + e.w, y: e.y + e.h }];
      case "dimension": return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
      default: return [];
    }
  }

  function entitySegs(e) {
    const segs = [];
    if (e.type === "line") segs.push([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
    if (e.type === "rect") {
      const p = rectPts(e);
      for (let i = 0; i < 4; i++) segs.push([p[i], p[(i + 1) % 4]]);
    }
    if (e.type === "polyline" || e.type === "polygon") {
      const p = SchizzoExport.polylineDrawPts(e);
      for (let i = 0; i < p.length - 1; i++) segs.push([p[i], p[i + 1]]);
      if ((e.type === "polygon" || e.closed) && p.length > 2) segs.push([p[p.length - 1], p[0]]);
    }
    return segs;
  }

  function entityCircles(e) {
    if (e.type === "circle") return [{ c: { x: e.cx, y: e.cy }, r: e.r, arc: null }];
    if (e.type === "arc") return [{ c: { x: e.cx, y: e.cy }, r: e.r, arc: { a0: e.a0, a1: e.a1 } }];
    return [];
  }

  function isClosedEntity(e) {
    if (e.type === "circle" || e.type === "ellipse" || e.type === "rect" || e.type === "polygon") return true;
    if ((e.type === "polyline" || e.type === "spline") && e.closed) return true;
    if (e.type === "polyline" && e.points && e.points.length > 2) {
      return dist(e.points[0], e.points[e.points.length - 1]) < 0.02;
    }
    return false;
  }

  function countClosed() {
    let n = 0;
    for (const e of state.entities) {
      if (!layerVisible(e.layer)) continue;
      if (isClosedEntity(e)) n++;
    }
    n += countLineLoops();
    return n;
  }

  function countLineLoops() {
    const lines = state.entities.filter((e) => e.type === "line" && layerVisible(e.layer));
    if (lines.length < 3) return 0;
    const key = (p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    const nodes = new Map();
    function node(p) {
      const k = key(p);
      if (!nodes.has(k)) nodes.set(k, { p, k, adj: [] });
      return nodes.get(k);
    }
    for (const e of lines) {
      const a = node({ x: e.x1, y: e.y1 });
      const b = node({ x: e.x2, y: e.y2 });
      a.adj.push(b.k); b.adj.push(a.k);
    }
    let cycles = 0;
    const visitedEdges = new Set();
    for (const [k, n] of nodes) {
      for (const ak of n.adj) {
        const ek = k < ak ? k + "|" + ak : ak + "|" + k;
        if (visitedEdges.has(ek)) continue;
        const q = [k];
        const seen = new Set([k]);
        let found = false;
        while (q.length) {
          const cur = q.pop();
          const nodeC = nodes.get(cur);
          for (const nx of nodeC.adj) {
            if (cur === k && nx === ak) continue;
            if (nx === ak && cur !== k) { found = true; break; }
            if (!seen.has(nx)) { seen.add(nx); q.push(nx); }
          }
          if (found) break;
        }
        if (found) {
          cycles++;
          visitedEdges.add(ek);
        }
      }
    }
    return cycles > 0 ? 1 : 0;
  }

  function bboxEntities(list) {
    return SchizzoExport.bboxOf(list);
  }

  function hitEntity(e, p, tol) {
    const t = tol;
    switch (e.type) {
      case "line": {
        const q = projectSeg(p, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
        return dist(p, q) <= t;
      }
      case "circle":
        return Math.abs(dist(p, { x: e.cx, y: e.cy }) - e.r) <= t;
      case "arc": {
        const d = dist(p, { x: e.cx, y: e.cy });
        if (Math.abs(d - e.r) > t) return false;
        return angleInArc(Math.atan2(p.y - e.cy, p.x - e.cx), e.a0, e.a1);
      }
      case "ellipse": {
        const rot = e.rot || 0;
        const c = Math.cos(-rot), s = Math.sin(-rot);
        const dx = p.x - e.cx, dy = p.y - e.cy;
        const lx = dx * c - dy * s, ly = dx * s + dy * c;
        const v = (lx * lx) / (e.rx * e.rx) + (ly * ly) / (e.ry * e.ry);
        return Math.abs(Math.sqrt(v) - 1) * Math.max(e.rx, e.ry) <= t * 1.5;
      }
      case "rect": {
        const pts = rectPts(e);
        for (let i = 0; i < 4; i++) {
          const q = projectSeg(p, pts[i], pts[(i + 1) % 4]);
          if (dist(p, q) <= t) return true;
        }
        return false;
      }
      case "polyline":
      case "polygon": {
        const pts = SchizzoExport.polylineDrawPts(e);
        const n = pts.length;
        const closed = e.type === "polygon" || e.closed;
        for (let i = 0; i < n - 1; i++) {
          if (dist(p, projectSeg(p, pts[i], pts[i + 1])) <= t) return true;
        }
        if (closed && n > 2 && dist(p, projectSeg(p, pts[n - 1], pts[0])) <= t) return true;
        return false;
      }
      case "spline": {
        const pts = SchizzoExport.sampleSpline(e.points, !!e.closed, 8);
        for (let i = 0; i < pts.length - 1; i++) {
          if (dist(p, projectSeg(p, pts[i], pts[i + 1])) <= t) return true;
        }
        return false;
      }
      case "text":
        return dist(p, { x: e.x, y: e.y }) <= Math.max(t, (e.height || 4));
      case "dimension":
        return dist(p, projectSeg(p, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 })) <= t * 1.5;
      case "image": {
        const m = 6;
        const inX = p.x >= e.x - t && p.x <= e.x + e.w + t;
        const inY = p.y >= e.y - t && p.y <= e.y + e.h + t;
        if (!inX || !inY) return false;
        const onBorder = p.x <= e.x + m || p.x >= e.x + e.w - m || p.y <= e.y + m || p.y >= e.y + e.h - m;
        return onBorder;
      }
      default:
        return false;
    }
  }

  function pickAt(p) {
    const tol = 8 / state.view.scale;
    for (let i = state.entities.length - 1; i >= 0; i--) {
      const e = state.entities[i];
      if (!layerVisible(e.layer) || layerLocked(e.layer)) continue;
      if (hitEntity(e, p, tol)) return e;
    }
    return null;
  }

  function translateEntity(e, dx, dy) {
    const sh = (pt) => { pt.x += dx; pt.y += dy; };
    switch (e.type) {
      case "line": e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy; break;
      case "circle":
      case "arc":
      case "ellipse": e.cx += dx; e.cy += dy; break;
      case "rect": e.x += dx; e.y += dy; break;
      case "text": e.x += dx; e.y += dy; break;
      case "image": e.x += dx; e.y += dy; break;
      case "dimension": e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy; break;
      case "polyline":
      case "polygon":
      case "spline": (e.points || []).forEach(sh); break;
      default: break;
    }
  }

  function rotateEntity(e, o, da) {
    const rotP = (p) => {
      const c = Math.cos(da), s = Math.sin(da);
      const dx = p.x - o.x, dy = p.y - o.y;
      return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c };
    };
    const apply = (obj, xk, yk) => {
      const r = rotP({ x: obj[xk], y: obj[yk] });
      obj[xk] = r.x; obj[yk] = r.y;
    };
    switch (e.type) {
      case "line": apply(e, "x1", "y1"); apply(e, "x2", "y2"); break;
      case "circle": apply(e, "cx", "cy"); break;
      case "arc": apply(e, "cx", "cy"); e.a0 += da; e.a1 += da; break;
      case "ellipse": apply(e, "cx", "cy"); e.rot = (e.rot || 0) + da; break;
      case "rect": {
        const pts = rectPts(e).map(rotP);
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        /* keep as polygon if rotated off-axis from original axis-aligned unless we store rot */
        e.rot = (e.rot || 0) + da;
        const c = rotP({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
        e.x = c.x - e.w / 2; e.y = c.y - e.h / 2;
        break;
      }
      case "text": apply(e, "x", "y"); e.rot = (e.rot || 0) + da; break;
      case "image": {
        const c = rotP({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
        e.x = c.x - e.w / 2; e.y = c.y - e.h / 2;
        break;
      }
      case "dimension": apply(e, "x1", "y1"); apply(e, "x2", "y2"); break;
      case "polyline":
      case "polygon":
      case "spline": e.points = (e.points || []).map(rotP); break;
      default: break;
    }
  }

  function scaleEntity(e, o, f) {
    const sc = (p) => ({ x: o.x + (p.x - o.x) * f, y: o.y + (p.y - o.y) * f });
    const apply = (obj, xk, yk) => {
      const r = sc({ x: obj[xk], y: obj[yk] });
      obj[xk] = r.x; obj[yk] = r.y;
    };
    switch (e.type) {
      case "line": apply(e, "x1", "y1"); apply(e, "x2", "y2"); break;
      case "circle": apply(e, "cx", "cy"); e.r *= f; break;
      case "arc": apply(e, "cx", "cy"); e.r *= f; break;
      case "ellipse": apply(e, "cx", "cy"); e.rx *= f; e.ry *= f; break;
      case "rect": {
        const c = sc({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
        e.w *= f; e.h *= f;
        e.x = c.x - e.w / 2; e.y = c.y - e.h / 2;
        break;
      }
      case "text": apply(e, "x", "y"); e.height = (e.height || 4) * f; break;
      case "image": {
        const c = sc({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
        e.w *= f; e.h *= f;
        e.x = c.x - e.w / 2; e.y = c.y - e.h / 2;
        break;
      }
      case "dimension": apply(e, "x1", "y1"); apply(e, "x2", "y2"); e.offset = (e.offset || 8) * f; break;
      case "polyline":
      case "polygon":
      case "spline": e.points = (e.points || []).map(sc); break;
      default: break;
    }
  }

  function mirrorEntity(e, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const mir = (p) => {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      return { x: 2 * q.x - p.x, y: 2 * q.y - p.y };
    };
    const apply = (obj, xk, yk) => {
      const r = mir({ x: obj[xk], y: obj[yk] });
      obj[xk] = r.x; obj[yk] = r.y;
    };
    switch (e.type) {
      case "line": apply(e, "x1", "y1"); apply(e, "x2", "y2"); break;
      case "circle": apply(e, "cx", "cy"); break;
      case "arc": {
        apply(e, "cx", "cy");
        const p0 = mir(polar({ x: e.cx, y: e.cy }, e.a0, e.r)); /* cx already mirrored — use original? skip angle flip approx */
        const angLine = Math.atan2(dy, dx);
        e.a0 = 2 * angLine - e.a0;
        e.a1 = 2 * angLine - e.a1;
        const tmp = e.a0; e.a0 = e.a1; e.a1 = tmp;
        break;
      }
      case "ellipse": apply(e, "cx", "cy"); e.rot = -(e.rot || 0); break;
      case "rect": apply(e, "x", "y"); break;
      case "text": apply(e, "x", "y"); break;
      case "image": {
        const c = mir({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
        e.x = c.x - e.w / 2; e.y = c.y - e.h / 2;
        break;
      }
      case "dimension": apply(e, "x1", "y1"); apply(e, "x2", "y2"); break;
      case "polyline":
      case "polygon":
      case "spline": e.points = (e.points || []).map(mir); break;
      default: break;
    }
  }

  /* ---------- snap ---------- */
  function snapPoints() {
    const pts = [];
    const add = (p, kind) => { if (p && Number.isFinite(p.x)) pts.push({ x: p.x, y: p.y, kind }); };
    for (const e of state.entities) {
      if (!layerVisible(e.layer)) continue;
      switch (e.type) {
        case "line":
          add({ x: e.x1, y: e.y1 }, "end");
          add({ x: e.x2, y: e.y2 }, "end");
          add(lerp({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, 0.5), "mid");
          break;
        case "rect": {
          const p = rectPts(e);
          p.forEach((q) => add(q, "end"));
          for (let i = 0; i < 4; i++) add(lerp(p[i], p[(i + 1) % 4], 0.5), "mid");
          add({ x: e.x + e.w / 2, y: e.y + e.h / 2 }, "cen");
          break;
        }
        case "circle":
          add({ x: e.cx, y: e.cy }, "cen");
          add({ x: e.cx + e.r, y: e.cy }, "quad");
          add({ x: e.cx - e.r, y: e.cy }, "quad");
          add({ x: e.cx, y: e.cy + e.r }, "quad");
          add({ x: e.cx, y: e.cy - e.r }, "quad");
          break;
        case "arc":
          add({ x: e.cx, y: e.cy }, "cen");
          add(polar({ x: e.cx, y: e.cy }, e.a0, e.r), "end");
          add(polar({ x: e.cx, y: e.cy }, e.a1, e.r), "end");
          break;
        case "ellipse":
          add({ x: e.cx, y: e.cy }, "cen");
          break;
        case "polyline":
        case "polygon":
        case "spline":
          (e.points || []).forEach((q, i, arr) => {
            add(q, "end");
            if (i < arr.length - 1) add(lerp(q, arr[i + 1], 0.5), "mid");
          });
          break;
        default: break;
      }
    }
    add({ x: 0, y: 0 }, "ori");
    /* intersections (cap for performance) */
    const ents = state.entities.filter((e) => layerVisible(e.layer));
    const maxE = Math.min(ents.length, 80);
    for (let i = 0; i < maxE; i++) {
      for (let j = i + 1; j < maxE; j++) {
        const A = ents[i], B = ents[j];
        const sa = entitySegs(A), sb = entitySegs(B);
        for (const s1 of sa) for (const s2 of sb) {
          const hit = segIntersect(s1[0], s1[1], s2[0], s2[1]);
          if (hit) add(hit, "int");
        }
        const ca = entityCircles(A), cb = entityCircles(B);
        for (const c1 of ca) for (const c2 of cb) {
          circleCircleHits(c1.c, c1.r, c2.c, c2.r).forEach((p) => add(p, "int"));
        }
        for (const c of ca) for (const s of sb) lineCircleHits(s[0], s[1], c.c, c.r).forEach((p) => add(p, "int"));
        for (const c of cb) for (const s of sa) lineCircleHits(s[0], s[1], c.c, c.r).forEach((p) => add(p, "int"));
      }
    }
    return pts;
  }

  function applyOrtho(from, to) {
    if (!from) return to;
    if (state.ortho) {
      const dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y);
      if (dx > dy) return { x: to.x, y: from.y };
      return { x: from.x, y: to.y };
    }
    if (state.polar) {
      const d = dist(from, to);
      if (d < EPS) return to;
      const step = Math.PI / 4;
      const a = Math.round(ang(from, to) / step) * step;
      return polar(from, a, d);
    }
    return to;
  }

  function snapWorld(p, from) {
    let q = { ...p };
    const kinds = { end: "Estremo", mid: "Medio", cen: "Centro", quad: "Quadrante", int: "Intersezione", grid: "Griglia", ori: "Origine", perp: "Perpendicolare", tan: "Tangente", nea: "Più vicino" };
    let kind = null;
    if (from) q = applyOrtho(from, q);

    const pix = 12;
    const tol = pix / state.view.scale;
    if (state.snapObj) {
      let best = null, bd = tol;
      const cands = snapPoints();
      for (const e of state.entities) {
        if (!layerVisible(e.layer)) continue;
        for (const seg of entitySegs(e)) {
          const foot = projectSeg(q, seg[0], seg[1]);
          cands.push({ x: foot.x, y: foot.y, kind: "nea" });
          if (from) {
            const pf = projectLine(from, seg[0], seg[1]);
            cands.push({ x: pf.x, y: pf.y, kind: "perp" });
          }
        }
        if (from) {
          for (const cir of entityCircles(e)) {
            circleTangents(from, cir.c, cir.r).forEach((tpt) => {
              if (cir.arc) {
                const angt = Math.atan2(tpt.y - cir.c.y, tpt.x - cir.c.x);
                if (!angleInArc(angt, cir.arc.a0, cir.arc.a1)) return;
              }
              cands.push({ x: tpt.x, y: tpt.y, kind: "tan" });
            });
            const vx = from.x - cir.c.x, vy = from.y - cir.c.y;
            const L = Math.hypot(vx, vy);
            if (L > EPS) {
              for (const s of [1, -1]) {
                const pt = { x: cir.c.x + vx / L * cir.r * s, y: cir.c.y + vy / L * cir.r * s, kind: "perp" };
                if (cir.arc) {
                  const angt = Math.atan2(pt.y - cir.c.y, pt.x - cir.c.x);
                  if (!angleInArc(angt, cir.arc.a0, cir.arc.a1)) continue;
                }
                cands.push(pt);
              }
            }
          }
        }
      }
      for (const s of cands) {
        const d0 = dist(q, s);
        if (d0 < bd) { bd = d0; best = s; }
      }
      if (best) { q = { x: best.x, y: best.y }; kind = best.kind; }
    }
    if (!kind && state.grid) {
      const g = state.gridStep || 5;
      const gx = Math.round(q.x / g) * g;
      const gy = Math.round(q.y / g) * g;
      if (dist(q, { x: gx, y: gy }) <= tol) {
        q = { x: gx, y: gy };
        kind = "grid";
      }
    }
    /* close-to-first-point for polyline */
    if (state.draft && (state.draft.points || []).length >= 2) {
      const f = state.draft.points[0];
      if (dist(q, f) <= tol) { q = { ...f }; kind = "end"; }
    }
    state.hoverSnap = kind ? { ...q, kind, label: kinds[kind] || kind } : null;
    return q;
  }

  /* ---------- history ---------- */
  function pushHist() {
    state.history = state.history.slice(0, state.histIndex + 1);
    state.history.push({
      entities: deep(state.entities),
      layers: deep(state.layers),
      layer: state.layer
    });
    if (state.history.length > 80) state.history.shift();
    state.histIndex = state.history.length - 1;
    autosave();
  }
  function restore(h) {
    state.entities = deep(h.entities);
    state.layers = deep(h.layers);
    state.layer = h.layer;
    state.selection = [];
    refreshUI();
    draw();
  }
  function undo() {
    if (state.histIndex <= 0) return;
    state.histIndex--;
    restore(state.history[state.histIndex]);
  }
  function redo() {
    if (state.histIndex >= state.history.length - 1) return;
    state.histIndex++;
    restore(state.history[state.histIndex]);
  }

  function autosave() {
    try {
      localStorage.setItem("schizzo-autosave-v2", JSON.stringify({
        units: state.units, entities: state.entities, layers: state.layers, layer: state.layer, name: state.name, gridStep: state.gridStep, thickness: state.thickness
      }));
    } catch (_) { /* ignore quota */ }
  }

  /* ---------- draw ---------- */
  function drawGrid() {
    if (!state.grid) return;
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(cssW, cssH);
    const minX = Math.min(tl.x, br.x), maxX = Math.max(tl.x, br.x);
    const minY = Math.min(tl.y, br.y), maxY = Math.max(tl.y, br.y);
    let minor = state.gridStep || 5;
    let px = minor * state.view.scale;
    while (px < 7) { minor *= 5; px = minor * state.view.scale; }
    while (px > 90) { minor /= 2; px = minor * state.view.scale; }
    const major = minor * 5;

    const startX = Math.floor(minX / minor) * minor;
    const startY = Math.floor(minY / minor) * minor;

    ctx.save();
    for (let x = startX; x <= maxX; x += minor) {
      const s = worldToScreen({ x, y: 0 });
      const isMaj = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      ctx.strokeStyle = isMaj ? "#252b38" : "#181c26";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(s.x) + 0.5, 0);
      ctx.lineTo(Math.round(s.x) + 0.5, cssH);
      ctx.stroke();
    }
    for (let y = startY; y <= maxY; y += minor) {
      const s = worldToScreen({ x: 0, y });
      const isMaj = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      ctx.strokeStyle = isMaj ? "#252b38" : "#181c26";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(s.y) + 0.5);
      ctx.lineTo(cssW, Math.round(s.y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAxes() {
    const o = worldToScreen({ x: 0, y: 0 });
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#e05656";
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + 48, o.y); ctx.stroke();
    ctx.strokeStyle = "#3ecf8e";
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - 48); ctx.stroke();
    ctx.fillStyle = "#8b93a7";
    ctx.font = "11px IBM Plex Sans, sans-serif";
    ctx.fillText("X", o.x + 52, o.y + 4);
    ctx.fillText("Y", o.x + 4, o.y - 52);
    ctx.restore();
  }

  function strokeEntity(e, preview) {
    const sel = state.selection.includes(e.id);
    const hov = !preview && !sel && state.hoverId === e.id;
    ctx.lineWidth = sel ? 2 : (hov ? 1.7 : 1.25);
    ctx.strokeStyle = preview ? "#4db2ff" : (sel ? "#f5a623" : (hov ? "#8fd3ff" : colorOf(e)));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(preview ? [6, 4] : []);
    const fillClosed = sel && isClosedEntity(e) && !preview;
    if (fillClosed) {
      ctx.fillStyle = "rgba(245,166,35,0.08)";
    }
    const m = (p) => worldToScreen(p);

    switch (e.type) {
      case "line": {
        const a = m({ x: e.x1, y: e.y1 }), b = m({ x: e.x2, y: e.y2 });
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        break;
      }
      case "circle": {
        const c = m({ x: e.cx, y: e.cy });
        ctx.beginPath(); ctx.arc(c.x, c.y, e.r * state.view.scale, 0, TAU);
        if (fillClosed) ctx.fill();
        ctx.stroke();
        break;
      }
      case "arc": {
        const c = m({ x: e.cx, y: e.cy });
        ctx.beginPath();
        ctx.arc(c.x, c.y, e.r * state.view.scale, -e.a0, -e.a1, true);
        ctx.stroke();
        break;
      }
      case "ellipse": {
        const c = m({ x: e.cx, y: e.cy });
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, e.rx * state.view.scale, e.ry * state.view.scale, -(e.rot || 0), 0, TAU);
        if (fillClosed) ctx.fill();
        ctx.stroke();
        break;
      }
      case "rect": {
        const pts = rectPts(e).map(m);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        if (fillClosed) ctx.fill();
        ctx.stroke();
        break;
      }
      case "polyline":
      case "polygon": {
        const pts = SchizzoExport.polylineDrawPts(e).map(m);
        if (!pts.length) break;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        if (e.type === "polygon" || e.closed) ctx.closePath();
        if (fillClosed) ctx.fill();
        ctx.stroke();
        break;
      }
      case "spline": {
        const pts = SchizzoExport.sampleSpline(e.points, !!e.closed, 12).map(m);
        if (!pts.length) break;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        if (e.closed) ctx.closePath();
        if (fillClosed) ctx.fill();
        ctx.stroke();
        break;
      }
      case "text": {
        const p = m({ x: e.x, y: e.y });
        ctx.save();
        ctx.fillStyle = sel ? "#f5a623" : colorOf(e);
        ctx.font = `${Math.max(10, (e.height || 4) * state.view.scale)}px IBM Plex Sans, sans-serif`;
        ctx.translate(p.x, p.y);
        ctx.rotate(-(e.rot || 0));
        ctx.fillText(e.text || "", 0, 0);
        ctx.restore();
        break;
      }
      case "dimension": {
        drawDimension(e, sel);
        break;
      }
      case "image": {
        const im = imageOf(e);
        const a = worldToScreen({ x: e.x, y: e.y });
        const b = worldToScreen({ x: e.x + e.w, y: e.y + e.h });
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        ctx.save();
        if (im && im.complete && im.naturalWidth) {
          ctx.globalAlpha = e.opacity == null ? 0.4 : e.opacity;
          ctx.drawImage(im, x, y, w, h);
        } else {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = "#4db2ff";
          ctx.fillRect(x, y, w, h);
        }
        ctx.globalAlpha = 1;
        if (sel) {
          ctx.strokeStyle = "#f5a623";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(x, y, w, h);
        }
        ctx.restore();
        break;
      }
      default: break;
    }
    ctx.setLineDash([]);
  }

  function drawDimension(e, sel) {
    const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const off = e.offset || 8;
    const p1 = { x: a.x + nx * off, y: a.y + ny * off };
    const p2 = { x: b.x + nx * off, y: b.y + ny * off };
    const sA = worldToScreen(a), sB = worldToScreen(b);
    const s1 = worldToScreen(p1), s2 = worldToScreen(p2);
    ctx.strokeStyle = sel ? "#f5a623" : colorOf(e);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sA.x, sA.y); ctx.lineTo(s1.x, s1.y);
    ctx.moveTo(sB.x, sB.y); ctx.lineTo(s2.x, s2.y);
    ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
    const angS = Math.atan2(s2.y - s1.y, s2.x - s1.x);
    const arrow = (sx, sy, dir) => {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angS + (dir < 0 ? Math.PI : 0));
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-8, -3.2); ctx.lineTo(-8, 3.2); ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    arrow(s1.x, s1.y, 1); arrow(s2.x, s2.y, -1);
    const mid = worldToScreen({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.fillStyle = sel ? "#f5a623" : colorOf(e);
    const label = (e.prefix || "") + fmt(len, 2) + " " + state.units;
    ctx.fillText(label, mid.x + 6, mid.y - 6);
  }

  function drawSnap() {
    if (!state.hoverSnap) return;
    const s = worldToScreen(state.hoverSnap);
    ctx.save();
    ctx.strokeStyle = "#ffe566";
    ctx.fillStyle = "rgba(255,229,102,0.15)";
    ctx.lineWidth = 1.4;
    const k = state.hoverSnap.kind;
    ctx.beginPath();
    if (k === "cen") ctx.arc(s.x, s.y, 7, 0, TAU);
    else if (k === "mid") {
      ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x + 7, s.y); ctx.lineTo(s.x, s.y + 7); ctx.lineTo(s.x - 7, s.y); ctx.closePath();
    } else if (k === "int") {
      ctx.moveTo(s.x - 6, s.y - 6); ctx.lineTo(s.x + 6, s.y + 6);
      ctx.moveTo(s.x + 6, s.y - 6); ctx.lineTo(s.x - 6, s.y + 6);
    } else if (k === "perp") {
      ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y);
      ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6);
    } else if (k === "tan") {
      ctx.arc(s.x, s.y, 6, 0, TAU);
    } else if (k === "nea") {
      ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5);
      ctx.moveTo(s.x + 5, s.y - 5); ctx.lineTo(s.x - 5, s.y + 5);
    } else {
      ctx.rect(s.x - 5, s.y - 5, 10, 10);
    }
    ctx.stroke();
    ctx.font = "10px IBM Plex Sans, sans-serif";
    ctx.fillStyle = "#ffe566";
    ctx.fillText(state.hoverSnap.label, s.x + 10, s.y - 8);
    ctx.restore();
  }

  function drawDraft() {
    const d = state.draft;
    if (!d) return;
    const w = lastWorld;
    if (d.kind === "line" && d.p1) {
      strokeEntity({ type: "line", x1: d.p1.x, y1: d.p1.y, x2: w.x, y2: w.y, layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "polyline" || d.kind === "spline") {
      const pts = (d.points || []).concat([w]);
      strokeEntity({ type: d.kind, points: pts, closed: false, layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "rect" && d.p1) {
      const x = Math.min(d.p1.x, w.x), y = Math.min(d.p1.y, w.y);
      strokeEntity({ type: "rect", x, y, w: Math.abs(w.x - d.p1.x), h: Math.abs(w.y - d.p1.y), layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "circle" && d.c) {
      if (d.diam) {
        const cc = { x: (d.c.x + w.x) / 2, y: (d.c.y + w.y) / 2 };
        strokeEntity({ type: "circle", cx: cc.x, cy: cc.y, r: dist(cc, w), layer: state.layer, color: "#4db2ff" }, true);
        strokeEntity({ type: "line", x1: d.c.x, y1: d.c.y, x2: w.x, y2: w.y, layer: state.layer, color: "#4db2ff" }, true);
      } else {
        strokeEntity({ type: "circle", cx: d.c.x, cy: d.c.y, r: dist(d.c, w), layer: state.layer, color: "#4db2ff" }, true);
      }
    }
    if (d.kind === "circle3" && d.p1) {
      if (d.p2) {
        const cc = circumcircle(d.p1, d.p2, w);
        if (cc) strokeEntity({ type: "circle", cx: cc.cx, cy: cc.cy, r: cc.r, layer: state.layer, color: "#4db2ff" }, true);
      } else {
        strokeEntity({ type: "line", x1: d.p1.x, y1: d.p1.y, x2: w.x, y2: w.y, layer: state.layer, color: "#4db2ff" }, true);
      }
    }
    if (d.kind === "ellipse" && d.c) {
      strokeEntity({ type: "ellipse", cx: d.c.x, cy: d.c.y, rx: Math.abs(w.x - d.c.x), ry: Math.abs(w.y - d.c.y), rot: 0, layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "arc") {
      if (d.p1 && d.p2) {
        const a = arcFrom3(d.p1, d.p2, w);
        if (a) strokeEntity({ type: "arc", ...a, layer: state.layer, color: "#4db2ff" }, true);
        else strokeEntity({ type: "line", x1: d.p1.x, y1: d.p1.y, x2: w.x, y2: w.y, layer: state.layer }, true);
      } else if (d.p1) {
        strokeEntity({ type: "line", x1: d.p1.x, y1: d.p1.y, x2: w.x, y2: w.y, layer: state.layer }, true);
      }
    }
    if (d.kind === "polygon" && d.c) {
      const n = parseInt($("poly-sides").value, 10) || 6;
      const r = dist(d.c, w);
      const a0 = ang(d.c, w);
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(polar(d.c, a0 + i * TAU / n, r));
      strokeEntity({ type: "polygon", points: pts, layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "dimension" && d.p1) {
      const p2 = d.p2 || w;
      const off = d.p2 ? signedOffset(d.p1, d.p2, w) : 8;
      strokeEntity({ type: "dimension", x1: d.p1.x, y1: d.p1.y, x2: p2.x, y2: p2.y, offset: off, layer: "quote" }, true);
    }
    if (d.kind === "array-polar" && d.center) {
      strokeEntity({ type: "line", x1: d.center.x, y1: d.center.y, x2: w.x, y2: w.y, layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "offset" && d.src) {
      const src = state.entities.find((e) => e.id === d.src);
      if (src) {
        const dd = offsetDistanceToward(src, w);
        const c = deep(src);
        if (Math.abs(dd) > 0.02 && offsetEntity(c, dd)) strokeEntity(c, true);
        const lab = worldToScreen(w);
        ctx.save();
        ctx.font = "11px IBM Plex Mono, monospace";
        ctx.fillStyle = "#4db2ff";
        ctx.fillText((dd >= 0 ? "+" : "") + fmt(dd, 2), lab.x + 10, lab.y - 8);
        ctx.restore();
      }
    }
    if (d.kind === "measure" && d.p1) {
      strokeEntity({ type: "line", x1: d.p1.x, y1: d.p1.y, x2: w.x, y2: w.y, layer: "quote", color: "#f0c040" }, true);
    }
    if ((d.kind === "move" || d.kind === "copy") && d.base) {
      const dx = w.x - d.base.x, dy = w.y - d.base.y;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#4db2ff";
      const a = worldToScreen(d.base), b = worldToScreen(w);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      const src = (d.kind === "copy" && d.src) ? d.src : selectedEntities();
      src.forEach((e) => {
        const c = deep(e);
        translateEntity(c, dx, dy);
        strokeEntity(c, true);
      });
    }
    if (d.kind === "rotate" && d.origin && d.ref) {
      const a0 = ang(d.origin, d.ref);
      const a1 = ang(d.origin, w);
      strokeEntity({ type: "line", x1: d.origin.x, y1: d.origin.y, x2: w.x, y2: w.y, layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "scale" && d.origin) {
      strokeEntity({ type: "line", x1: d.origin.x, y1: d.origin.y, x2: w.x, y2: w.y, layer: state.layer, color: "#4db2ff" }, true);
    }
    if (d.kind === "mirror" && d.a) {
      strokeEntity({ type: "line", x1: d.a.x, y1: d.a.y, x2: w.x, y2: w.y, layer: state.layer, color: "#4db2ff" }, true);
    }
  }

  function drawBox() {
    if (!boxSel) return;
    const x = Math.min(boxSel.x0, boxSel.x1), y = Math.min(boxSel.y0, boxSel.y1);
    const w = Math.abs(boxSel.x1 - boxSel.x0), h = Math.abs(boxSel.y1 - boxSel.y0);
    ctx.save();
    const crossing = boxSel.x1 < boxSel.x0;
    ctx.fillStyle = crossing ? "rgba(62,207,142,0.10)" : "rgba(77,178,255,0.08)";
    ctx.strokeStyle = crossing ? "rgba(62,207,142,0.75)" : "rgba(77,178,255,0.7)";
    ctx.setLineDash(crossing ? [6, 3] : [4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawIso() {
    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, cssW, cssH);
    const list = state.entities.filter((e) => layerVisible(e.layer) && e.type !== "image" && e.type !== "dimension" && e.type !== "text");
    const bb = SchizzoExport.bboxOf(list.length ? list : state.entities);
    const T = state.thickness || 40;
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2, cz = T / 2;
    const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, T, 1);
    const s = Math.min(cssW, cssH) * 0.62 / span * (state.iso.zoom || 1);
    const yaw = state.iso.yaw, pitch = state.iso.pitch;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    function proj(x, y, z) {
      x -= cx; y -= cy; z -= cz;
      const x1 = x * cyw + z * syw;
      const z1 = -x * syw + z * cyw;
      const y2 = y * cp - z1 * sp;
      return { x: cssW / 2 + x1 * s + (state.iso.panX || 0), y: cssH / 2 - y2 * s + (state.iso.panY || 0), d: z1 };
    }
    const faces = [];
    for (const e of list) {
      const ring = SchizzoExport.profileRing ? SchizzoExport.profileRing(e) : null;
      if (!ring || ring.length < 3) continue;
      const col = colorOf(e);
      const n = ring.length;
      const top = ring.map((p) => proj(p.x, p.y, T));
      const bot = ring.map((p) => proj(p.x, p.y, 0));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const d = (bot[i].d + bot[j].d + top[j].d) / 3;
        faces.push({ d, pts: [bot[i], bot[j], top[j], top[i]], col, side: true });
      }
      faces.push({ d: top.reduce((a, p) => a + p.d, 0) / n, pts: top, col, side: false });
    }
    faces.sort((a, b) => a.d - b.d);
    for (const f of faces) {
      ctx.beginPath();
      ctx.moveTo(f.pts[0].x, f.pts[0].y);
      f.pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = f.side ? "rgba(245,166,35,0.16)" : "rgba(77,178,255,0.18)";
      if (f.col && f.col.startsWith("#")) {
        ctx.fillStyle = f.side ? f.col + "28" : f.col + "40";
      }
      ctx.fill();
      ctx.strokeStyle = f.col || "#dfe3ea";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.fillStyle = "#8b93a7";
    ctx.font = "12px IBM Plex Sans, sans-serif";
    ctx.fillText("3D · spessore " + fmt(T, 1) + " mm · trascina per orbitare · DXF Onshape / STL", 14, cssH - 16);
  }

  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, cssW, cssH);
    if (state.view3d) { drawIso(); return; }
    drawGrid();
    drawAxes();
    const rest = [];
    for (const e of state.entities) {
      if (!layerVisible(e.layer)) continue;
      if (e.type === "image") strokeEntity(e, false);
      else rest.push(e);
    }
    for (const e of rest) strokeEntity(e, false);
    drawDraft();
    drawBox();
    drawSnap();
  }

  /* ---------- tools ---------- */
  const HINTS = {
    select: "Seleziona oggetti · trascina per spostare · riquadro per selezione multipla",
    pan: "Trascina per spostare la vista · rotella per zoom",
    line: "Linea: primo punto, poi secondo · catena continua · Esc per chiudere",
    polyline: "Polilinea: clic sui vertici · clic sul primo punto o Invio+C per chiudere · Invio termina",
    rect: "Rettangolo: due angoli opposti",
    circle: "Cerchio: centro + raggio · Shift = diametro 2 punti · Alt = 3 punti",
    arc: "Arco: tre punti (inizio, punto intermedio, fine)",
    ellipse: "Ellisse: centro, poi punto che definisce i raggi X/Y",
    polygon: "Poligono regolare: centro, poi raggio · imposta i lati nel pannello",
    spline: "Spline: punti di passaggio · Invio termina · C chiude",
    dimension: "Quota: due estremi, poi offset · snap al centro di un cerchio/arco per quota R",
    text: "Testo: clic sul punto di inserimento",
    fillet: "Raccordo: clicca un rettangolo o una polilinea · due linee + pulsante in Proprietà",
    measure: "Misura: due punti · la distanza resta in evidenza, senza creare geometria",
    trim: "Taglia: clicca il tratto di linea da togliere · Shift+clic per estendere fino all’intersezione",
    break: "Spezza: clicca una linea nel punto in cui dividerla",
    offset: "Offset: clicca la geometria, poi un punto dal lato desiderato (distanza)"
  };

  function setTool(t) {
    state.tool = t;
    state.draft = null;
    cmdBuf = [];
    if (t !== "select" && t !== "pan") lastCmd = t;
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    hintEl.textContent = HINTS[t] || "";
    canvas.style.cursor = t === "pan" ? "grab" : t === "select" ? "default" : "crosshair";
    draw();
  }

  function addEntity(e) {
    e.id = e.id || uid();
    e.layer = e.layer || state.layer;
    if (layerLocked(e.layer)) {
      hintEl.textContent = "Livello bloccato: sblocca o cambia livello corrente.";
      return null;
    }
    state.entities.push(e);
    pushHist();
    refreshUI();
    draw();
    return e;
  }

  function deleteSelection() {
    if (!state.selection.length) return;
    const set = new Set(state.selection);
    const before = state.entities.length;
    state.entities = state.entities.filter((e) => !set.has(e.id) || layerLocked(e.layer));
    state.selection = state.selection.filter((id) => {
      const e = state.entities.find((x) => x.id === id);
      return e && layerLocked(e.layer);
    });
    if (state.entities.length === before) {
      hintEl.textContent = "Niente da eliminare (livello bloccato).";
      return;
    }
    pushHist();
    refreshUI();
    draw();
  }

  function applyRectArray() {
    const src = selectedEntities();
    if (!src.length) { hintEl.textContent = "Seleziona gli oggetti da copiare in serie."; return; }
    const nx = Math.max(1, parseInt($("arr-n").value, 10) || 4);
    const ny = Math.max(1, parseInt($("arr-ny").value, 10) || 1);
    const dx = parseFloat($("arr-dx").value) || 20;
    const dy = parseFloat($("arr-dy").value) || 20;
    const news = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (i === 0 && j === 0) continue;
        src.forEach((e) => {
          const c = cloneTranslated(e, i * dx, j * dy);
          state.entities.push(c);
          news.push(c.id);
        });
      }
    }
    state.selection = state.selection.concat(news);
    pushHist();
    refreshUI();
    draw();
    hintEl.textContent = `Serie ${nx}×${ny} creata`;
  }

  function applyPolarArray(center) {
    const src = selectedEntities();
    if (!src.length) { hintEl.textContent = "Seleziona prima gli oggetti (es. un foro)."; return; }
    const n = Math.max(2, parseInt($("arr-n").value, 10) || 4);
    const news = [];
    for (let i = 1; i < n; i++) {
      const da = (TAU * i) / n;
      src.forEach((e) => {
        const c = deep(e);
        c.id = uid();
        rotateEntity(c, center, da);
        state.entities.push(c);
        news.push(c.id);
      });
    }
    state.selection = state.selection.concat(news);
    pushHist();
    refreshUI();
    hintEl.textContent = `Serie polare: ${n} copie attorno al centro`;
    draw();
  }

  function filletSelection() {
    const r = Math.max(0.1, parseFloat($("fillet-r").value) || 3);
    let n = 0;
    const lines = selectedEntities().filter((e) => e.type === "line");
    if (lines.length >= 2 && filletTwoLines(lines[0], lines[1], r)) n++;
    selectedEntities().forEach((e) => { if (filletEntity(e, r)) n++; });
    if (!n) {
      hintEl.textContent = "Seleziona un rettangolo, una polilinea, o due linee che si incontrano.";
      return;
    }
    pushHist();
    refreshUI();
    draw();
    hintEl.textContent = `Raccordo R${fmt(r, 2)} su ${n} oggetti`;
  }

  function chamferSelection() {
    const d = Math.max(0.1, parseFloat($("fillet-r").value) || 3);
    let n = 0;
    const lines = selectedEntities().filter((e) => e.type === "line");
    if (lines.length >= 2 && chamferTwoLines(lines[0], lines[1], d)) n++;
    selectedEntities().forEach((e) => { if (chamferEntity(e, d)) n++; });
    if (!n) {
      hintEl.textContent = "Seleziona un rettangolo, una polilinea, o due linee che si incontrano.";
      return;
    }
    pushHist();
    refreshUI();
    draw();
    hintEl.textContent = `Smusso ${fmt(d, 2)} su ${n} oggetti`;
  }

  function joinSelection() {
    const lines = selectedEntities().filter((e) => e.type === "line");
    if (lines.length < 2) {
      hintEl.textContent = "Seleziona almeno due linee da unire.";
      return;
    }
    const tol = 0.05;
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
    const unused = lines.slice();
    const chains = [];
    while (unused.length) {
      const first = unused.shift();
      let pts = [{ x: first.x1, y: first.y1 }, { x: first.x2, y: first.y2 }];
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < unused.length; i++) {
          const ln = unused[i];
          const a = { x: ln.x1, y: ln.y1 }, b = { x: ln.x2, y: ln.y2 };
          const head = pts[0], tail = pts[pts.length - 1];
          if (near(tail, a)) { pts.push(b); unused.splice(i, 1); grew = true; break; }
          if (near(tail, b)) { pts.push(a); unused.splice(i, 1); grew = true; break; }
          if (near(head, a)) { pts.unshift(b); unused.splice(i, 1); grew = true; break; }
          if (near(head, b)) { pts.unshift(a); unused.splice(i, 1); grew = true; break; }
        }
      }
      chains.push(pts);
    }
    const ids = new Set(lines.map((e) => e.id));
    state.entities = state.entities.filter((e) => !ids.has(e.id));
    const news = [];
    chains.forEach((pts) => {
      if (pts.length < 2) return;
      const closed = pts.length > 2 && near(pts[0], pts[pts.length - 1]);
      if (closed) pts = pts.slice(0, -1);
      const e = { id: uid(), type: "polyline", points: pts, closed, layer: state.layer };
      state.entities.push(e);
      news.push(e.id);
    });
    state.selection = news;
    pushHist();
    refreshUI();
    draw();
    hintEl.textContent = news.some((id) => (state.entities.find((e) => e.id === id) || {}).closed)
      ? "Polilinea chiusa pronta per l’estrusione"
      : `Unite ${news.length} polilinee`;
  }

  function duplicateSelection() {
    if (!state.selection.length) return;
    const g = state.gridStep || 5;
    const news = [];
    for (const id of state.selection) {
      const e = state.entities.find((x) => x.id === id);
      if (!e) continue;
      const c = deep(e);
      c.id = uid();
      translateEntity(c, g, g);
      state.entities.push(c);
      news.push(c.id);
    }
    state.selection = news;
    pushHist();
    refreshUI();
    draw();
  }

  function selectedEntities() {
    const set = new Set(state.selection);
    return state.entities.filter((e) => set.has(e.id));
  }

  function finishDraft(extra) {
    const d = state.draft;
    if (!d) return;
    if (d.kind === "polyline" && (d.points || []).length >= 2) {
      const pts = d.points.slice();
      const closed = extra === "close" || dist(pts[0], pts[pts.length - 1]) < 0.02;
      if (closed && pts.length >= 3) {
        if (dist(pts[0], pts[pts.length - 1]) < 0.02) pts.pop();
      }
      addEntity({ type: "polyline", points: pts, closed: closed && pts.length >= 3 });
    } else if (d.kind === "spline" && (d.points || []).length >= 2) {
      addEntity({ type: "spline", points: d.points.slice(), closed: extra === "close" });
    }
    state.draft = null;
    lastPoint = null;
    draw();
  }

  function cancelDraft() {
    state.draft = null;
    lastPoint = null;
    cmdBuf = [];
    boxSel = null;
    dragging = null;
    hintEl.textContent = HINTS[state.tool] || "";
    draw();
  }

  function startModify(kind) {
    if (!state.selection.length && kind !== "select") {
      hintEl.textContent = "Seleziona prima almeno un oggetto.";
      return;
    }
    state.tool = "select";
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === "select"));
    lastCmd = kind;
    state.draft = { kind, step: 0 };
    const msg = {
      move: "Sposta: indica il punto base",
      copy: "Copia: indica il punto base",
      rotate: "Ruota: indica il centro di rotazione",
      scale: "Scala: indica il punto origine",
      mirror: "Specchia: primo punto dell'asse"
    };
    hintEl.textContent = msg[kind] || "";
    draw();
  }

  function clickWorld(p, ev) {
    const tool = state.tool;
    if (state.draft && ["move", "copy", "rotate", "scale", "mirror", "array-polar", "origin"].includes(state.draft.kind)) {
      return modifyClick(p, ev);
    }
    if (tool === "offset") {
      if (!state.draft || state.draft.kind !== "offset") {
        const hit = pickAt(p);
        if (!hit) {
          hintEl.textContent = "Offset: clicca una linea, un cerchio o un profilo chiuso";
          return;
        }
        state.draft = { kind: "offset", src: hit.id };
        state.selection = [hit.id];
        lastPoint = p;
        hintEl.textContent = "Offset: clicca dal lato voluto (la distanza è fino al cursore)";
        refreshUI(); draw();
        return;
      }
      const src = state.entities.find((e) => e.id === state.draft.src);
      if (!src) { state.draft = null; return; }
      const dd = offsetDistanceToward(src, p);
      const c = deep(src);
      c.id = uid();
      if (Math.abs(dd) > 0.02 && offsetEntity(c, dd)) {
        state.entities.push(c);
        state.selection = [c.id];
        pushHist();
        hintEl.textContent = "Offset " + fmt(dd, 2) + " " + state.units + " · clicca un’altra geometria o Esc";
        state.draft = null;
      } else {
        hintEl.textContent = "Offset troppo piccolo o non applicabile";
      }
      refreshUI(); draw();
      return;
    }
    if (tool === "break") {
      if (breakAt(p)) {
        pushHist(); refreshUI();
        hintEl.textContent = "Spezzato · clicca un altro tratto o Esc";
      } else {
        hintEl.textContent = "Spezza: clicca una linea nel punto di taglio";
      }
      draw();
      return;
    }
    if (tool === "trim") {
      const ok = ev && ev.shiftKey ? extendAt(p) : trimAt(p);
      if (ok) {
        pushHist();
        refreshUI();
        hintEl.textContent = ev && ev.shiftKey
          ? "Esteso · clicca un altro tratto (Shift) o Esc"
          : "Taglio applicato · clicca un altro tratto o Esc";
      } else {
        hintEl.textContent = ev && ev.shiftKey
          ? "Estendi: clicca una linea vicino all’estremo da allungare"
          : "Trim: clicca un tratto di linea tagliato da altre geometrie (esplodi i rettangoli se serve)";
      }
      draw();
      return;
    }
    if (tool === "select") return;
    if (tool === "pan") return;

    if (tool === "line") {
      if (!state.draft) {
        state.draft = { kind: "line", p1: p };
        lastPoint = p;
        hintEl.textContent = "Linea: secondo punto · digita la lunghezza";
      } else {
        addEntity({ type: "line", x1: state.draft.p1.x, y1: state.draft.p1.y, x2: p.x, y2: p.y });
        state.draft = { kind: "line", p1: p };
        lastPoint = p;
      }
      draw();
      return;
    }
    if (tool === "polyline" || tool === "spline") {
      if (!state.draft) state.draft = { kind: tool, points: [p] };
      else {
        const pts = state.draft.points;
        if (pts.length >= 2 && dist(p, pts[0]) < 8 / state.view.scale) {
          finishDraft("close");
          return;
        }
        pts.push(p);
      }
      lastPoint = p;
      hintEl.textContent = tool === "polyline"
        ? "Vertice successivo · Invio termina · C chiude"
        : "Punto spline · Invio termina · C chiude";
      draw();
      return;
    }
    if (tool === "rect") {
      if (!state.draft) {
        state.draft = { kind: "rect", p1: p };
        lastPoint = p;
        hintEl.textContent = "Rettangolo: angolo opposto";
      } else {
        const x = Math.min(state.draft.p1.x, p.x), y = Math.min(state.draft.p1.y, p.y);
        addEntity({ type: "rect", x, y, w: Math.abs(p.x - state.draft.p1.x), h: Math.abs(p.y - state.draft.p1.y), rot: 0 });
        state.draft = null;
      }
      draw();
      return;
    }
    if (tool === "circle") {
      if (state.draft && state.draft.kind === "circle3") {
        if (!state.draft.p2) {
          state.draft.p2 = p;
          lastPoint = p;
          hintEl.textContent = "Cerchio 3P: terzo punto";
        } else {
          const cc = circumcircle(state.draft.p1, state.draft.p2, p);
          if (cc) addEntity({ type: "circle", cx: cc.cx, cy: cc.cy, r: cc.r, layer: state.layer });
          else hintEl.textContent = "Punti allineati: cerchio 3P non valido";
          state.draft = null;
        }
        draw();
        return;
      }
      if (!state.draft) {
        if (ev && ev.altKey) {
          state.draft = { kind: "circle3", p1: p };
          lastPoint = p;
          hintEl.textContent = "Cerchio 3P: secondo punto";
        } else {
          state.draft = { kind: "circle", c: p, diam: !!(ev && ev.shiftKey) };
          lastPoint = p;
          hintEl.textContent = state.draft.diam
            ? "Cerchio Ø: secondo estremo del diametro"
            : "Cerchio: raggio · Shift=Ø · Alt=3 punti";
        }
      } else if (state.draft.diam) {
        const cc = { x: (state.draft.c.x + p.x) / 2, y: (state.draft.c.y + p.y) / 2 };
        addEntity({ type: "circle", cx: cc.x, cy: cc.cy, r: dist(cc, p), layer: state.layer });
        state.draft = null;
      } else {
        addEntity({ type: "circle", cx: state.draft.c.x, cy: state.draft.c.y, r: dist(state.draft.c, p), layer: state.layer });
        state.draft = null;
      }
      draw();
      return;
    }
    if (tool === "ellipse") {
      if (!state.draft) {
        state.draft = { kind: "ellipse", c: p };
        lastPoint = p;
        hintEl.textContent = "Ellisse: punto che definisce i raggi X e Y";
      } else {
        addEntity({
          type: "ellipse",
          cx: state.draft.c.x, cy: state.draft.c.y,
          rx: Math.max(EPS, Math.abs(p.x - state.draft.c.x)),
          ry: Math.max(EPS, Math.abs(p.y - state.draft.c.y)),
          rot: 0
        });
        state.draft = null;
      }
      draw();
      return;
    }
    if (tool === "arc") {
      if (!state.draft) {
        state.draft = { kind: "arc", p1: p };
        lastPoint = p;
        hintEl.textContent = "Arco: secondo punto";
      } else if (!state.draft.p2) {
        state.draft.p2 = p;
        lastPoint = p;
        hintEl.textContent = "Arco: punto finale";
      } else {
        const a = arcFrom3(state.draft.p1, state.draft.p2, p);
        if (a) addEntity({ type: "arc", ...a });
        state.draft = null;
      }
      draw();
      return;
    }
    if (tool === "polygon") {
      if (!state.draft) {
        state.draft = { kind: "polygon", c: p };
        lastPoint = p;
        hintEl.textContent = "Poligono: raggio";
      } else {
        const n = clamp(parseInt($("poly-sides").value, 10) || 6, 3, 64);
        const inscribed = !$("poly-inscribed") || $("poly-inscribed").checked;
        const rClick = dist(state.draft.c, p);
        const r = inscribed ? rClick : rClick / Math.cos(Math.PI / n);
        const a0 = ang(state.draft.c, p);
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(polar(state.draft.c, a0 + i * TAU / n, r));
        addEntity({ type: "polygon", points: pts, closed: true });
        state.draft = null;
      }
      draw();
      return;
    }
    if (tool === "dimension") {
      if (!state.draft) {
        const hit = pickAt(p);
        if (hit && (hit.type === "circle" || hit.type === "arc") && state.hoverSnap && state.hoverSnap.kind === "cen") {
          const a0 = hit.type === "arc" ? hit.a0 : 0;
          state.draft = {
            kind: "dimension",
            p1: { x: hit.cx, y: hit.cy },
            p2: polar({ x: hit.cx, y: hit.cy }, a0, hit.r),
            radius: true
          };
          lastPoint = p;
          hintEl.textContent = "Quota R: clicca per posizionare la linea di quota";
        } else {
          state.draft = { kind: "dimension", p1: p };
          lastPoint = p;
          hintEl.textContent = "Quota: secondo punto · snap al centro di un cerchio per R";
        }
      } else if (!state.draft.p2) {
        if (state._dimHV === "h" || (ev && ev.shiftKey)) p = { x: p.x, y: state.draft.p1.y };
        else if (state._dimHV === "v" || (ev && ev.altKey)) p = { x: state.draft.p1.x, y: p.y };
        state.draft.p2 = p;
        state._dimHV = null;
        lastPoint = p;
        hintEl.textContent = "Quota: clicca per posizionare la linea di quota";
      } else {
        const off = signedOffset(state.draft.p1, state.draft.p2, p);
        addEntity({ type: "dimension", x1: state.draft.p1.x, y1: state.draft.p1.y, x2: state.draft.p2.x, y2: state.draft.p2.y, offset: off, layer: "quote", prefix: state.draft.diam ? "Ø" : (state.draft.radius ? "R" : "") });
        state.draft = null;
      }
      draw();
      return;
    }
    if (tool === "fillet") {
      const hit = pickAt(p);
      const r = Math.max(0.1, parseFloat($("fillet-r").value) || 3);
      if (hit && hit.type === "line") {
        if (!state.draft || state.draft.kind !== "fillet2") {
          state.draft = { kind: "fillet2" };
          state.selection = [hit.id];
          lastPoint = p;
          hintEl.textContent = "Raccordo: seconda linea · Shift = smusso";
          refreshUI(); draw();
          return;
        }
        const e1 = state.entities.find((e) => e.id === state.selection[0]);
        const ok = e1 && e1.type === "line" && e1.id !== hit.id && (
          (ev && ev.shiftKey) ? chamferTwoLines(e1, hit, r) : filletTwoLines(e1, hit, r)
        );
        if (ok) {
          state.draft = null;
          pushHist(); refreshUI();
          hintEl.textContent = ((ev && ev.shiftKey) ? "Smusso " : "Raccordo R") + fmt(r, 2);
        } else {
          hintEl.textContent = "Le due linee non si incontrano o la distanza è troppo grande";
        }
        draw();
        return;
      }
      state.draft = null;
      if (!hit) {
        hintEl.textContent = "Clicca un rettangolo, una polilinea, o due linee";
        return;
      }
      if (filletEntity(hit, r)) {
        state.selection = [hit.id];
        pushHist();
        refreshUI();
        hintEl.textContent = "Raccordo applicato · raggio " + fmt(r, 2);
      } else {
        hintEl.textContent = "Raggio troppo grande o geometria non raccordabile";
      }
      draw();
      return;
    }
    if (tool === "measure") {
      if (!state.draft) {
        state.draft = { kind: "measure", p1: p };
        lastPoint = p;
        hintEl.textContent = "Misura: secondo punto";
      } else {
        const d = dist(state.draft.p1, p);
        const a = deg(ang(state.draft.p1, p));
        hintEl.textContent = `Distanza ${fmt(d, 3)} ${state.units}   angolo ${fmt(a, 2)}°   ΔX ${fmt(p.x - state.draft.p1.x, 3)}   ΔY ${fmt(p.y - state.draft.p1.y, 3)}`;
        state.draft = { kind: "measure", p1: p, last: { d, a } };
        lastPoint = p;
      }
      draw();
      return;
    }
    if (tool === "text") {
      state.draft = { kind: "text", p: p };
      lastPoint = p;
      hintEl.textContent = "Testo: scrivi nella barra comando e premi Invio";
      cmdEl.focus();
      draw();
      return;
    }
  }

  function modifyClick(p, ev) {
    const d = state.draft;
    if (d.kind === "move" || d.kind === "copy") {
      if (!d.base) {
        d.base = p;
        if (d.kind === "copy") d.src = selectedEntities().map((e) => deep(e));
        hintEl.textContent = (d.kind === "copy" ? "Copia" : "Sposta") + ": punto di destinazione";
      } else {
        const dx = p.x - d.base.x, dy = p.y - d.base.y;
        if (d.kind === "copy") {
          const news = [];
          (d.src || selectedEntities()).forEach((e) => {
            const c = deep(e); c.id = uid();
            translateEntity(c, dx, dy);
            state.entities.push(c);
            news.push(c.id);
          });
          state.selection = news;
          pushHist();
          refreshUI();
          hintEl.textContent = "Altra copia oppure Esc";
          draw();
          return;
        } else {
          selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) translateEntity(e, dx, dy); });
        }
        state.draft = null;
        pushHist();
        refreshUI();
      }
    } else if (d.kind === "rotate") {
      if (!d.origin) {
        d.origin = p;
        hintEl.textContent = "Ruota: punto di riferimento angolo";
      } else if (!d.ref) {
        d.ref = p;
        hintEl.textContent = "Ruota: secondo punto (angolo) o digita i gradi";
      } else {
        const da = ang(d.origin, p) - ang(d.origin, d.ref);
        if (ev && ev.shiftKey) {
          selectedEntities().forEach((e) => {
            const c = deep(e); c.id = uid();
            rotateEntity(c, d.origin, da);
            state.entities.push(c);
          });
          hintEl.textContent = "Ruota: copia creata (Shift)";
        } else {
          selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) rotateEntity(e, d.origin, da); });
        }
        state.draft = null;
        pushHist();
        refreshUI();
      }
    } else if (d.kind === "scale") {
      if (!d.origin) {
        d.origin = p;
        hintEl.textContent = "Scala: punto di riferimento, poi fattore (o clic)";
        d.refLen = null;
      } else if (d.refLen == null) {
        d.refLen = dist(d.origin, p) || 1;
        hintEl.textContent = "Scala: secondo punto oppure digita il fattore";
      } else {
        const f = dist(d.origin, p) / d.refLen;
        if (ev && ev.shiftKey) {
          selectedEntities().forEach((e) => {
            const c = deep(e); c.id = uid();
            scaleEntity(c, d.origin, f);
            state.entities.push(c);
          });
          hintEl.textContent = "Scala: copia creata (Shift)";
        } else {
          selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) scaleEntity(e, d.origin, f); });
        }
        state.draft = null;
        pushHist();
        refreshUI();
      }
    } else if (d.kind === "mirror") {
      if (!d.a) {
        d.a = p;
        hintEl.textContent = "Specchia: secondo punto dell'asse";
      } else {
        if (ev && ev.shiftKey) {
          selectedEntities().forEach((e) => {
            const c = deep(e); c.id = uid();
            mirrorEntity(c, d.a, p);
            state.entities.push(c);
          });
          hintEl.textContent = "Specchio: copia creata";
        } else {
          selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) mirrorEntity(e, d.a, p); });
        }
        state.draft = null;
        pushHist();
        refreshUI();
      }
    } else if (d.kind === "array-polar") {
      applyPolarArray(p);
      state.draft = null;
    } else if (d.kind === "origin") {
      state.entities.forEach((e) => translateEntity(e, -p.x, -p.y));
      state.draft = null;
      pushHist();
      refreshUI();
      hintEl.textContent = "Origine spostata sul punto scelto";
      fitView();
    }
    draw();
  }

  /* ---------- pointer ---------- */
  function canvasPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button === 2) return;
    hideCtx();
    try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
    pointerDown = true;
    const s = canvasPos(ev);
    pinchPtrs.set(ev.pointerId, { x: s.x, y: s.y });
    if (pinchPtrs.size === 2) {
      const arr = Array.from(pinchPtrs.values());
      pinch = { dist: Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y), scale: state.view.scale };
    }
    lastMouse = s;
    if (state.view3d && (isoOrbit || panning) && panLast) {
      const dx = s.x - panLast.x, dy = s.y - panLast.y;
      if (panning) { state.iso.panX += dx; state.iso.panY += dy; }
      else { state.iso.yaw += dx * 0.01; state.iso.pitch = clamp(state.iso.pitch + dy * 0.01, -1.2, 1.2); }
      panLast = s;
      draw();
      return;
    }
    const raw = screenToWorld(s.x, s.y);
    const from = lastPoint || (state.draft && (state.draft.p1 || state.draft.c || state.draft.base || state.draft.origin || (state.draft.points || []).slice(-1)[0]));
    const p = snapWorld(raw, from);
    lastWorld = p;

    if (state.view3d) {
      panLast = s;
      if (ev.button === 1 || state.tool === "pan" || spacePan) panning = true;
      else isoOrbit = true;
      canvas.style.cursor = "grabbing";
      return;
    }
    if (ev.button === 1 || state.tool === "pan" || spacePan) {
      panning = true;
      panLast = s;
      canvas.style.cursor = "grabbing";
      return;
    }

    if (state.tool === "select" && !(state.draft && ["move", "copy", "rotate", "scale", "mirror", "array-polar", "origin"].includes(state.draft.kind))) {
      const hit = pickAt(p);
      if (hit) {
        if (ev.shiftKey) {
          const i = state.selection.indexOf(hit.id);
          if (i >= 0) state.selection.splice(i, 1);
          else state.selection.push(hit.id);
        } else if (!state.selection.includes(hit.id)) {
          state.selection = [hit.id];
        }
        dragging = { ids: state.selection.filter((id) => {
          const e = state.entities.find((x) => x.id === id);
          return e && !layerLocked(e.layer);
        }), x: p.x, y: p.y, moved: false };
        refreshUI();
        draw();
      } else {
        if (!ev.shiftKey) state.selection = [];
        boxSel = { x0: s.x, y0: s.y, x1: s.x, y1: s.y };
        refreshUI();
        draw();
      }
      return;
    }

    clickWorld(p, ev);
  });

  canvas.addEventListener("pointermove", (ev) => {
    const s = canvasPos(ev);
    lastMouse = s;
    if (pinchPtrs.has(ev.pointerId)) pinchPtrs.set(ev.pointerId, { x: s.x, y: s.y });
    if (pinch && pinchPtrs.size === 2) {
      const arr = Array.from(pinchPtrs.values());
      const dnow = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      if (pinch.dist > 12) {
        const mid = { x: (arr[0].x + arr[1].x) / 2, y: (arr[0].y + arr[1].y) / 2 };
        const before = screenToWorld(mid.x, mid.y);
        state.view.scale = clamp(pinch.scale * (dnow / pinch.dist), 0.05, 400);
        const after = screenToWorld(mid.x, mid.y);
        state.view.x += before.x - after.x;
        state.view.y += before.y - after.y;
        updateStatus();
        draw();
      }
      return;
    }
    if (panning && panLast) {
      const dx = s.x - panLast.x, dy = s.y - panLast.y;
      state.view.x -= dx / state.view.scale;
      state.view.y += dy / state.view.scale;
      panLast = s;
      draw();
      updateStatus();
      return;
    }
    const raw = screenToWorld(s.x, s.y);
    const from = lastPoint || (state.draft && (state.draft.p1 || state.draft.c || state.draft.base || state.draft.origin || (state.draft.points || []).slice(-1)[0]));
    const p = snapWorld(raw, from);
    lastWorld = p;

    if (dragging && pointerDown) {
      const dx = p.x - dragging.x, dy = p.y - dragging.y;
      if (dx || dy) {
        const set = new Set(dragging.ids);
        state.entities.forEach((e) => { if (set.has(e.id)) translateEntity(e, dx, dy); });
        dragging.x = p.x; dragging.y = p.y; dragging.moved = true;
      }
      draw();
      updateStatus();
      updateMeasure(from, p);
      return;
    }
    if (boxSel) {
      boxSel.x1 = s.x; boxSel.y1 = s.y;
      draw();
      updateStatus();
      return;
    }

    const hit = state.tool === "select" ? pickAt(p) : null;
    state.hoverId = hit ? hit.id : null;
    canvas.style.cursor = panning || spacePan ? "grabbing" : (state.tool === "pan" || spacePan ? "grab" : (hit ? "move" : (state.tool === "select" ? "default" : "crosshair")));

    updateMeasure(from, p);
    updateStatus();
    draw();
  });

  function endPointer(ev) {
    pinchPtrs.delete(ev.pointerId);
    if (pinchPtrs.size < 2) pinch = null;
    pointerDown = false;
    isoOrbit = false;
    if (panning) {
      panning = false;
      canvas.style.cursor = state.tool === "pan" || spacePan ? "grab" : "crosshair";
    }
    if (dragging) {
      if (dragging.moved) pushHist();
      dragging = null;
      refreshUI();
    }
    if (boxSel) {
      const x0 = Math.min(boxSel.x0, boxSel.x1), x1 = Math.max(boxSel.x0, boxSel.x1);
      const y0 = Math.min(boxSel.y0, boxSel.y1), y1 = Math.max(boxSel.y0, boxSel.y1);
      if (x1 - x0 > 4 && y1 - y0 > 4) {
        const w0 = screenToWorld(x0, y1);
        const w1 = screenToWorld(x1, y0);
        const minX = Math.min(w0.x, w1.x), maxX = Math.max(w0.x, w1.x);
        const minY = Math.min(w0.y, w1.y), maxY = Math.max(w0.y, w1.y);
        const crossing = boxSel.x1 < boxSel.x0;
        const ids = [];
        for (const e of state.entities) {
          if (!layerVisible(e.layer) || layerLocked(e.layer)) continue;
          const bb = bboxEntities([e]);
          const inside = bb.minX >= minX && bb.maxX <= maxX && bb.minY >= minY && bb.maxY <= maxY;
          const overlap = !(bb.maxX < minX || bb.minX > maxX || bb.maxY < minY || bb.minY > maxY);
          if (crossing ? overlap : inside) ids.push(e.id);
        }
        state.selection = ev.shiftKey ? Array.from(new Set(state.selection.concat(ids))) : ids;
        refreshUI();
      }
      boxSel = null;
      draw();
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const s = canvasPos(ev);
    if (state.view3d) {
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      state.iso.zoom = clamp((state.iso.zoom || 1) * factor, 0.2, 12);
      draw();
      return;
    }
    const before = screenToWorld(s.x, s.y);
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    state.view.scale = clamp(state.view.scale * factor, 0.05, 400);
    const after = screenToWorld(s.x, s.y);
    state.view.x += before.x - after.x;
    state.view.y += before.y - after.y;
    updateStatus();
    draw();
  }, { passive: false });

  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (state.draft) { cancelDraft(); return; }
    const s = canvasPos(ev);
    const p = screenToWorld(s.x, s.y);
    const hit = pickAt(p);
    if (hit && !state.selection.includes(hit.id)) state.selection = [hit.id];
    showContext(ev.clientX, ev.clientY);
    refreshUI();
    draw();
  });

  canvas.addEventListener("dblclick", () => {
    if (state.draft && (state.draft.kind === "polyline" || state.draft.kind === "spline")) finishDraft();
  });

  /* ---------- measure overlay ---------- */
  function updateMeasure(from, p) {
    if (!from || !state.draft) { measureEl.hidden = true; return; }
    const d = dist(from, p);
    const a = deg(ang(from, p));
    let label = `${fmt(d, 2)} ${state.units}   ${fmt(a, 1)}°`;
    if (state.draft.kind === "rect" && state.draft.p1) {
      const ww = Math.abs(p.x - state.draft.p1.x), hh = Math.abs(p.y - state.draft.p1.y);
      label = `L ${fmt(ww, 2)}  H ${fmt(hh, 2)}  ·  ${fmt(ww * hh, 1)} ${state.units}²`;
    } else if (state.draft.kind === "circle" && state.draft.c) {
      if (state.draft.diam) {
        const rr = d / 2;
        label = `Ø ${fmt(d, 2)}  R ${fmt(rr, 2)} ${state.units}`;
      } else {
        label = `R ${fmt(d, 2)}  Ø ${fmt(d * 2, 2)} ${state.units}`;
      }
    } else if (state.draft.kind === "polygon" && state.draft.c) {
      label = `R ${fmt(d, 2)} ${state.units}`;
    } else if (state.draft.kind === "copy" || state.draft.kind === "move") {
      label = `ΔX ${fmt(p.x - from.x, 2)}  ΔY ${fmt(p.y - from.y, 2)}  ·  ${fmt(d, 2)} ${state.units}`;
    }
    measureEl.hidden = false;
    measureEl.style.left = lastMouse.x + "px";
    measureEl.style.top = lastMouse.y + "px";
    measureEl.textContent = label;
  }

  function updateStatus() {
    $("coord").innerHTML = `X ${fmt(lastWorld.x, 2)}&nbsp;&nbsp;Y ${fmt(lastWorld.y, 2)}`;
    $("tag-snap").classList.toggle("on", state.snapObj);
    $("tag-ortho").classList.toggle("on", state.ortho);
    const tagPolar = $("tag-polar");
    if (tagPolar) tagPolar.classList.toggle("on", state.polar);
    $("tag-grid").classList.toggle("on", state.grid);
    $("snap-label").textContent = state.hoverSnap ? state.hoverSnap.label : "";
    $("zoom-label").textContent = Math.round(state.view.scale / 5 * 100) + "%";
    $("tog-grid").classList.toggle("active", state.grid);
    $("tog-snap").classList.toggle("active", state.snapObj);
    $("tog-ortho").classList.toggle("active", state.ortho);
    const togPolar = $("tog-polar");
    if (togPolar) togPolar.classList.toggle("active", state.polar);
  }

  /* ---------- command input ---------- */
  function parsePoint(str, origin) {
    const s = str.trim().replace(/\s+/g, "");
    if (!s) return null;
    /* polar: 40<90 */
    const polarM = s.match(/^@?(-?\d+(?:\.\d+)?)[<°](-?\d+(?:\.\d+)?)$/);
    if (polarM) {
      const r = parseFloat(polarM[1]), a = parseFloat(polarM[2]) * Math.PI / 180;
      const o = origin || lastPoint || { x: 0, y: 0 };
      return polar(o, a, r);
    }
    /* relative @dx,dy */
    if (s[0] === "@") {
      const parts = s.slice(1).split(/[,;]/);
      if (parts.length >= 2) {
        const o = origin || lastPoint || { x: 0, y: 0 };
        return { x: o.x + parseFloat(parts[0]), y: o.y + parseFloat(parts[1]) };
      }
    }
    /* absolute x,y */
    const parts = s.split(/[,;]/);
    if (parts.length >= 2 && parts[0] !== "" && parts[1] !== "") {
      return { x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
    }
    /* direct distance */
    const num = parseFloat(s);
    if (Number.isFinite(num) && origin) {
      const a = ang(origin, lastWorld);
      return polar(origin, a, num);
    }
    return null;
  }

  function replayLast() {
    if (["move", "copy", "rotate", "scale", "mirror"].includes(lastCmd)) startModify(lastCmd);
    else if (lastCmd && lastCmd !== "select" && lastCmd !== "pan") setTool(lastCmd);
  }

  function runCmdLine(val) {
    const low = val.toLowerCase().trim();
    if (low === "chiudi") { finishDraft("close"); return true; }
    const map = {
      l: () => setTool("line"), linea: () => setTool("line"),
      pl: () => setTool("polyline"), polilinea: () => setTool("polyline"),
      c: () => setTool("circle"), cerchio: () => setTool("circle"),
      rettangolo: () => setTool("rect"),
      arco: () => setTool("arc"),
      sposta: () => startModify("move"),
      copia: () => startModify("copy"),
      ruota: () => startModify("rotate"),
      taglia: () => setTool("trim"),
      spezza: () => setTool("break"),
      misura: () => setTool("measure"),
      quota: () => setTool("dimension"),
      esplodi: () => explodeSelection(),
      offset: () => offsetSelection(1),
      unisci: () => joinSelection(),
      raccordo: () => filletSelection(),
      smusso: () => chamferSelection()
    };
    if (map[low]) { map[low](); return true; }
    if (/spess|manigl|anta|porta|raccord|thick|foro|fori/.test(low) && typeof SchizzoTrace !== "undefined") {
      const spec = SchizzoTrace.parsePrompt(val);
      if (spec.thickness) {
        state.thickness = spec.thickness;
        const th = $("ex-th") || $("studio-th");
        if ($("ex-th")) $("ex-th").value = spec.thickness;
      }
      SchizzoTrace.applySpec({ entities: state.entities, note: "" }, spec);
      pushHist(); refreshUI(); draw();
      hintEl.textContent = "Raffinato: " + val;
      return true;
    }
    const offm = low.match(/^offset\s+(-?\d+(?:\.\d+)?)$/);
    if (offm) {
      const inp = $("offset-d");
      if (inp) inp.value = String(Math.abs(parseFloat(offm[1])));
      offsetSelection(parseFloat(offm[1]) >= 0 ? 1 : -1);
      return true;
    }
    return false;
  }

  cmdEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const val = cmdEl.value.trim();
      ev.preventDefault();
      if (!val) { replayLast(); return; }
      if (state.draft && state.draft.kind === "text") {
        const h = parseFloat($("text-h").value) || 4;
        addEntity({ type: "text", x: state.draft.p.x, y: state.draft.p.y, text: val, height: h, rot: 0, layer: "quote" });
        state.draft = null;
        cmdEl.value = "";
        return;
      }
      if (!state.draft && runCmdLine(val)) { cmdEl.value = ""; return; }
      const origin = lastPoint || (state.draft && (state.draft.p1 || state.draft.c || state.draft.base || state.draft.origin || (state.draft.points || []).slice(-1)[0]));
      if (val.toLowerCase() === "c" || val.toLowerCase() === "chiudi") {
        finishDraft("close");
        cmdEl.value = "";
        return;
      }
      /* rotate degrees when in rotate step */
      if (state.draft && state.draft.kind === "rotate" && state.draft.origin && state.draft.ref && /^-?\d+(\.\d+)?$/.test(val)) {
        const da = parseFloat(val) * Math.PI / 180;
        selectedEntities().forEach((e) => rotateEntity(e, state.draft.origin, da));
        state.draft = null;
        pushHist(); refreshUI(); draw();
        cmdEl.value = "";
        return;
      }
      if (state.draft && state.draft.kind === "scale" && state.draft.origin && /^-?\d+(\.\d+)?$/.test(val)) {
        const f = parseFloat(val);
        selectedEntities().forEach((e) => scaleEntity(e, state.draft.origin, f));
        state.draft = null;
        pushHist(); refreshUI(); draw();
        cmdEl.value = "";
        return;
      }
      if (!state.draft && state.selection.length && val[0] === "@") {
        const rel = parsePoint(val, { x: 0, y: 0 });
        if (rel && Number.isFinite(rel.x) && Number.isFinite(rel.y)) {
          selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) translateEntity(e, rel.x, rel.y); });
          pushHist(); refreshUI(); draw();
          cmdEl.value = "";
          return;
        }
      }
      const p = parsePoint(val, origin);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        lastWorld = p;
        clickWorld(p, { shiftKey: false });
        cmdEl.value = "";
      }
    }
    if (ev.key === "Escape") {
      cancelDraft();
      cmdEl.value = "";
    }
  });

  /* ---------- keyboard ---------- */
  const keySeq = { buf: "", t: 0 };
  window.addEventListener("keydown", (ev) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (ev.key === "Escape") {
      if (overlay.classList.contains("show")) { hideModal(); return; }
      const st = $("studio");
      if (st && !st.hidden) { st.hidden = true; return; }
      if (state.view3d) {
        state.view3d = false;
        if ($("btn-3d")) $("btn-3d").classList.remove("active");
        draw();
        return;
      }
      if (inField && document.activeElement !== cmdEl) document.activeElement.blur();
      cancelDraft();
      setTool("select");
      hideCtx();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); redo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") { ev.preventDefault(); duplicateSelection(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
      if (!inField) {
        ev.preventDefault();
        state.selection = state.entities.filter((e) => layerVisible(e.layer) && !layerLocked(e.layer)).map((e) => e.id);
        refreshUI(); draw();
      }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c") {
      if (!inField) { ev.preventDefault(); state.clipboard = selectedEntities().map(deep); }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "v") {
      if (!inField && state.clipboard.length) {
        ev.preventDefault();
        const g = state.gridStep || 5;
        const news = [];
        for (const e of state.clipboard) {
          const c = deep(e); c.id = uid();
          translateEntity(c, g, g);
          state.entities.push(c); news.push(c.id);
        }
        state.selection = news;
        pushHist(); refreshUI(); draw();
      }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      saveProject();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "n") {
      ev.preventDefault();
      $("btn-new").click();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "o") {
      ev.preventDefault();
      $("file-open").click();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "0" || ev.key === "Digit0")) {
      ev.preventDefault();
      fitView();
      return;
    }
    if (ev.key === " " && !inField) {
      ev.preventDefault();
      spacePan = true;
      canvas.style.cursor = "grab";
      return;
    }
    if (inField && document.activeElement !== cmdEl) return;
    if (inField && document.activeElement === cmdEl && ev.key.length === 1) return;

    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (!inField) { ev.preventDefault(); deleteSelection(); }
      return;
    }
    if (ev.key === "Enter" && !inField) {
      if (state.draft && (state.draft.kind === "polyline" || state.draft.kind === "spline")) finishDraft();
      return;
    }
    if (ev.key === "F8") { ev.preventDefault(); state.ortho = !state.ortho; updateStatus(); draw(); return; }
    if (ev.key === "F3") { ev.preventDefault(); state.snapObj = !state.snapObj; updateStatus(); draw(); return; }
    if (ev.key === "F9") { ev.preventDefault(); state.grid = !state.grid; updateStatus(); draw(); return; }
    if (ev.key === "F10") { ev.preventDefault(); state.polar = !state.polar; if (state.polar) state.ortho = false; updateStatus(); draw(); return; }
    if (ev.key === "Home") { ev.preventDefault(); fitView(); return; }
    if (!inField && (ev.key === "+" || ev.key === "=")) { ev.preventDefault(); zoomAt(cssW / 2, cssH / 2, 1.2); return; }
    if (!inField && (ev.key === "-" || ev.key === "_")) { ev.preventDefault(); zoomAt(cssW / 2, cssH / 2, 1 / 1.2); return; }

    if (inField) return;

    const k = ev.key.toLowerCase();
    if (k === "?") { showHelp(); return; }

    /* two-letter commands first so CO/RO/TR/PL funzionano */
    const now = Date.now();
    if (now - keySeq.t > 700) keySeq.buf = "";
    keySeq.t = now;
    keySeq.buf += k;
    if (keySeq.buf.endsWith("pl")) { setTool("polyline"); keySeq.buf = ""; return; }
    if (keySeq.buf.endsWith("ro")) { startModify("rotate"); keySeq.buf = ""; return; }
    if (keySeq.buf.endsWith("di")) { setTool("measure"); keySeq.buf = ""; return; }
    if (keySeq.buf.endsWith("co")) { startModify("copy"); keySeq.buf = ""; return; }
    if (keySeq.buf.endsWith("tr")) { setTool("trim"); keySeq.buf = ""; return; }
    if (keySeq.buf.endsWith("br")) { setTool("break"); keySeq.buf = ""; return; }
    if (keySeq.buf.endsWith("of")) { setTool("offset"); keySeq.buf = ""; return; }
    if (keySeq.buf.endsWith("dh")) { setTool("dimension"); state._dimHV = "h"; keySeq.buf = ""; hintEl.textContent = "Quota orizzontale: due punti, poi offset"; return; }
    if (keySeq.buf.endsWith("dv")) { setTool("dimension"); state._dimHV = "v"; keySeq.buf = ""; hintEl.textContent = "Quota verticale: due punti, poi offset"; return; }

    if (k === "g") { state.grid = !state.grid; updateStatus(); draw(); return; }
    if (k === "o") { state.ortho = !state.ortho; if (state.ortho) state.polar = false; updateStatus(); draw(); return; }
    if (k === "f") {
      if (ev.shiftKey && state.selection.length) fitView(selectedEntities());
      else fitView();
      return;
    }

    if (k === "l") setTool("line");
    else if (k === "c") {
      if (state.draft && (state.draft.kind === "polyline" || state.draft.kind === "spline")) finishDraft("close");
      else setTool("circle");
    }
    else if (k === "r") setTool("rect");
    else if (k === "a") setTool("arc");
    else if (k === "s") setTool("select");
    else if (k === "d") setTool("dimension");
    else if (k === "m") startModify("move");
    else if (k === "p") setTool("pan");
    else if (k === "t") setTool("text");
    else if (k === "e") setTool("ellipse");
    else if (k === "x") explodeSelection();

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key) && state.selection.length) {
      ev.preventDefault();
      const step = ev.shiftKey ? 0.1 : (state.gridStep || 5);
      const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
      const dy = ev.key === "ArrowDown" ? -step : ev.key === "ArrowUp" ? step : 0;
      selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) translateEntity(e, dx, dy); });
      pushHist(); draw(); refreshUI();
    }
  });
  window.addEventListener("keyup", (ev) => {
    if (ev.key === " ") {
      spacePan = false;
      if (!panning) canvas.style.cursor = state.tool === "select" ? "default" : "crosshair";
    }
  });

  function zoomAt(sx, sy, factor) {
    const before = screenToWorld(sx, sy);
    state.view.scale = clamp(state.view.scale * factor, 0.05, 400);
    const after = screenToWorld(sx, sy);
    state.view.x += before.x - after.x;
    state.view.y += before.y - after.y;
    updateStatus();
    draw();
  }

  function fitView(list) {
    list = list || state.entities.filter((e) => layerVisible(e.layer));
    if (!list.length) {
      state.view = { x: 40, y: 30, scale: 5 };
      draw(); updateStatus();
      return;
    }
    const bb = bboxEntities(list);
    const w = Math.max(10, bb.maxX - bb.minX);
    const h = Math.max(10, bb.maxY - bb.minY);
    const pad = 1.25;
    state.view.x = (bb.minX + bb.maxX) / 2;
    state.view.y = (bb.minY + bb.maxY) / 2;
    state.view.scale = clamp(Math.min(cssW / (w * pad), cssH / (h * pad)), 0.2, 80);
    draw(); updateStatus();
  }

  /* ---------- UI panels ---------- */
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $("panel-" + t.dataset.panel).classList.add("active");
    });
  });
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.addEventListener("click", () => setTool(b.dataset.tool));
  });

  $("btn-undo").onclick = undo;
  $("btn-redo").onclick = redo;
  $("btn-dup").onclick = duplicateSelection;
  $("btn-del").onclick = deleteSelection;
  $("btn-move").onclick = () => startModify("move");
  $("btn-rotate").onclick = () => startModify("rotate");
  $("btn-scale").onclick = () => startModify("scale");
  $("btn-mirror").onclick = () => startModify("mirror");
  const btnCopy = $("btn-copy");
  if (btnCopy) btnCopy.onclick = () => startModify("copy");
  $("btn-fillet-sel").onclick = filletSelection;
  $("btn-chamfer-sel").onclick = chamferSelection;
  $("btn-join").onclick = joinSelection;
  const btnOffOut = $("btn-offset-out");
  const btnOffIn = $("btn-offset-in");
  if (btnOffOut) btnOffOut.onclick = () => offsetSelection(1);
  if (btnOffIn) btnOffIn.onclick = () => offsetSelection(-1);
  const btnExpl = $("btn-explode");
  if (btnExpl) btnExpl.onclick = explodeSelection;
  $("btn-array-rect").onclick = applyRectArray;
  $("btn-array").onclick = () => {
    document.querySelector('[data-panel="props"]').click();
    hintEl.textContent = "Serie: imposta Nx/Ny e i passi, seleziona gli oggetti, poi Rettangolare o Polare.";
  };
  $("btn-array-polar").onclick = () => {
    if (!state.selection.length) { hintEl.textContent = "Seleziona prima gli oggetti da copiare."; return; }
    state.tool = "select";
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === "select"));
    state.draft = { kind: "array-polar" };
    hintEl.textContent = "Serie polare: clicca il centro di rotazione";
  };
  $("btn-origin").onclick = () => {
    state.tool = "select";
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === "select"));
    state.draft = { kind: "origin" };
    hintEl.textContent = "Clicca il punto che diventerà l’origine (0,0) — utile per Onshape";
  };
  $("tog-grid").onclick = () => { state.grid = !state.grid; updateStatus(); draw(); };
  $("tog-snap").onclick = () => { state.snapObj = !state.snapObj; updateStatus(); draw(); };
  $("tog-ortho").onclick = () => { state.ortho = !state.ortho; if (state.ortho) state.polar = false; updateStatus(); draw(); };
  const togPolar = $("tog-polar");
  if (togPolar) togPolar.onclick = () => { state.polar = !state.polar; if (state.polar) state.ortho = false; updateStatus(); draw(); };
  ["tag-snap", "tag-ortho", "tag-grid", "tag-polar"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.onclick = () => {
      if (id === "tag-snap") state.snapObj = !state.snapObj;
      if (id === "tag-ortho") { state.ortho = !state.ortho; if (state.ortho) state.polar = false; }
      if (id === "tag-grid") state.grid = !state.grid;
      if (id === "tag-polar") { state.polar = !state.polar; if (state.polar) state.ortho = false; }
      updateStatus(); draw();
    };
  });
  const nameEl = $("dwg-name");
  if (nameEl) {
    nameEl.addEventListener("change", () => { state.name = nameEl.value.trim() || "senza-nome"; autosave(); refreshUI(); });
  }
  const btnLayerSel = $("btn-layer-sel");
  if (btnLayerSel) btnLayerSel.onclick = () => {
    if (!state.selection.length) { hintEl.textContent = "Seleziona oggetti da assegnare al livello corrente."; return; }
    selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) e.layer = state.layer; });
    pushHist(); refreshUI(); draw();
    hintEl.textContent = "Selezione assegnata a " + layerById(state.layer).name;
  };
  $("btn-fit").onclick = fitView;
  $("sel-units").onchange = (e) => {
      const next = e.target.value;
      const prev = state.units;
      if (next === prev) return;
      e.target.value = prev;
      const TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4 };
      const applyUnits = (convert) => {
        if (convert) {
          const k = (TO_MM[prev] || 1) / (TO_MM[next] || 1);
          scaleAllEntities(k);
          state.gridStep = Math.max(0.1, (state.gridStep || 5) * k);
          const gs = $("grid-step"); if (gs) gs.value = state.gridStep;
          pushHist();
        }
        state.units = next;
        e.target.value = next;
        hideModal(); autosave(); refreshUI(); draw();
      };
      showModal("Unità", `<p>Passare da <b>${prev}</b> a <b>${next}</b>.</p><p>Puoi solo cambiare l’etichetta (i numeri restano) oppure convertire tutta la geometria.</p>`, [
        { label: "Annulla" },
        { label: "Solo etichetta", fn: () => applyUnits(false) },
        { label: "Converti", primary: true, fn: () => applyUnits(true) }
      ]);
    };
  $("grid-step").onchange = (e) => { state.gridStep = Math.max(0.1, parseFloat(e.target.value) || 5); draw(); };

  $("btn-new").onclick = () => {
    showModal("Nuovo disegno", "<p>Cancellare il disegno corrente? Il progetto è anche nell'autosave del browser.</p>", [
      { label: "Annulla" },
      { label: "Nuovo", primary: true, fn: () => { newDrawing(); hideModal(); } }
    ]);
  };
  $("btn-save").onclick = saveProject;
  $("btn-open").onclick = () => $("file-open").click();
  $("file-open").onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) openFile(f);
  };
  function openStudio() {
    const st = $("studio");
    if (!st) { $("file-photo") && $("file-photo").click(); return; }
    st.hidden = false;
  }
  function closeStudio() { const st = $("studio"); if (st) st.hidden = true; }
  function pickPhoto() { openStudio(); }
  if ($("btn-photo")) $("btn-photo").onclick = pickPhoto;
  if ($("ex-photo")) $("ex-photo").onclick = pickPhoto;
  if ($("empty-photo")) $("empty-photo").onclick = pickPhoto;
  if ($("studio-close")) $("studio-close").onclick = closeStudio;

  let studioFile = null;
  function studioSetFile(file) {
    if (!file) return;
    studioFile = file;
    const r = new FileReader();
    r.onload = () => {
      const img = $("studio-preview");
      const msg = $("studio-drop-msg");
      if (img) { img.src = r.result; img.hidden = false; }
      if (msg) msg.style.display = "none";
    };
    r.readAsDataURL(file);
  }
  const drop = $("studio-drop");
  if (drop) {
    drop.onclick = () => $("file-photo") && $("file-photo").click();
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (ev) => {
      ev.preventDefault(); drop.classList.remove("drag");
      const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) studioSetFile(f);
    });
  }
  if ($("studio-go")) $("studio-go").onclick = () => {
    const f = studioFile;
    if (!f) { hintEl.textContent = "Carica prima una foto."; return; }
    window._schizzoPrompt = ($("studio-prompt") && $("studio-prompt").value) || "";
    const th = parseFloat($("studio-th") && $("studio-th").value);
    if (Number.isFinite(th) && th > 0) {
      window._schizzoPrompt += (window._schizzoPrompt ? ", " : "") + "spessore " + th;
      state.thickness = th;
    }
    closeStudio();
    importPhotoFile(f);
  };
  if ($("file-photo")) $("file-photo").onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const st = $("studio");
    if (st && !st.hidden) studioSetFile(f);
    else importPhotoFile(f);
  };

  $("btn-png").onclick = () => exportPNG();
  $("btn-svg").onclick = () => exportSVG();
  $("btn-dxf").onclick = () => exportDXF();
  if ($("btn-stl")) $("btn-stl").onclick = () => exportSTL();
  if ($("ex-stl")) $("ex-stl").onclick = () => exportSTL();
  if ($("btn-3d")) $("btn-3d").onclick = () => {
    state.view3d = !state.view3d;
    $("btn-3d").classList.toggle("active", state.view3d);
    hintEl.textContent = state.view3d ? "Vista 3D: trascina per orbitare, rotella zoom. Esc o 3D per tornare al 2D." : HINTS.select;
    draw();
  };
  if ($("ex-th")) $("ex-th").onchange = () => {
    const v = parseFloat($("ex-th").value);
    if (Number.isFinite(v) && v > 0) { state.thickness = v; if (state.view3d) draw(); }
  };
  $("btn-dwg").onclick = showDwgInfo;
  $("ex-png").onclick = () => exportPNG();
  $("ex-svg").onclick = () => exportSVG();
  $("ex-dxf").onclick = () => exportDXF();
  $("ex-dwg").onclick = showDwgInfo;
  $("btn-help").onclick = showHelp;
  const sideEl = document.querySelector(".side");
  function setSideOpen(on) {
    if (!sideEl) return;
    sideEl.classList.toggle("open", !!on);
    let bd = document.getElementById("side-backdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "side-backdrop";
      bd.className = "side-backdrop";
      const ws = document.querySelector(".workspace");
      if (ws) ws.appendChild(bd);
      bd.addEventListener("click", () => setSideOpen(false));
    }
    bd.classList.toggle("show", !!on);
  }
  if ($("btn-side")) $("btn-side").onclick = () => setSideOpen(!sideEl.classList.contains("open"));

  document.querySelectorAll("[data-tpl]").forEach((b) => {
    b.addEventListener("click", () => loadTemplate(b.dataset.tpl));
  });

  $("btn-add-layer").onclick = () => {
    const suggested = "Livello " + (state.layers.length + 1);
    showModal("Nuovo livello",
      `<div class="field"><label>Nome</label><input id="layer-name-in" value="${suggested}" /></div>`,
      [
        { label: "Annulla" },
        { label: "Crea", primary: true, fn: () => {
          const inp = $("layer-name-in");
          const name = ((inp && inp.value.trim()) || suggested);
          const colors = ["#e8eaef", "#4db2ff", "#3ecf8e", "#e05656", "#c084fc", "#f0c040"];
          state.layers.push({
            id: uid(),
            name,
            color: colors[state.layers.length % colors.length],
            visible: true,
            locked: false
          });
          hideModal();
          pushHist();
          refreshUI();
        } }
      ]);
    setTimeout(() => { const i = $("layer-name-in"); if (i) { i.focus(); i.select(); } }, 0);
  };

  function refreshUI() {
    $("st-ents").textContent = state.entities.length;
    const cl = countClosed();
    $("st-closed").textContent = cl;
    $("st-closed-row").classList.toggle("ok", cl > 0);
    $("st-closed-row").classList.toggle("warn", cl === 0);
    $("st-sel").textContent = state.selection.length;
    const areaEl = $("st-area");
    if (areaEl) {
      let area = 0;
      state.entities.forEach((e) => { if (layerVisible(e.layer) && isClosedEntity(e)) area += entityArea(e); });
      areaEl.textContent = fmt(area, 1) + " " + state.units + "²";
    }
    $("sel-units").value = state.units;
    const nameInp = $("dwg-name");
    if (nameInp && document.activeElement !== nameInp) nameInp.value = state.name || "senza-nome";
    document.title = (isDirty() ? "• " : "") + (state.name || "Schizzo") + " — Schizzo";
    const empty = $("empty");
    if (empty) empty.classList.toggle("hidden", state.entities.length > 0);

    const box = $("props-box");
    if (state.selection.length !== 1) {
      box.className = "props-empty";
      box.innerHTML = state.selection.length === 0
        ? "Nessuna selezione. Clicca un oggetto o disegna un profilo chiuso da estrudere in Onshape."
        : state.selection.length + " oggetti selezionati. Sposta, ruota, duplica o elimina.";
    } else {
      const e = state.entities.find((x) => x.id === state.selection[0]);
      if (!e) { box.className = "props-empty"; box.textContent = ""; }
      else renderProps(e, box);
    }
    renderLayers();
  }

  function numInput(id, label, value, onChange) {
    return `<span>${label}</span><input class="prop-input" data-pk="${id}" value="${fmt(value, 4)}" />`;
  }

  function renderProps(e, box) {
    box.className = "";
    let fields = `<div class="prop-grid">`;
    fields += `<span>Tipo</span><span style="font-size:12px;color:var(--text)">${e.type}</span>`;
    const add = (k, lab, v) => { fields += numInput(k, lab, v); };
    switch (e.type) {
      case "line": add("x1", "X1", e.x1); add("y1", "Y1", e.y1); add("x2", "X2", e.x2); add("y2", "Y2", e.y2);
        fields += numInput("__len", "Lungh.", dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }));
        break;
      case "circle": add("cx", "Cx", e.cx); add("cy", "Cy", e.cy); add("r", "R", e.r);
        fields += numInput("__dia", "Ø", e.r * 2);
        break;
      case "arc": add("cx", "Cx", e.cx); add("cy", "Cy", e.cy); add("r", "R", e.r); break;
      case "ellipse": add("cx", "Cx", e.cx); add("cy", "Cy", e.cy); add("rx", "Rx", e.rx); add("ry", "Ry", e.ry); break;
      case "rect": add("x", "X", e.x); add("y", "Y", e.y); add("w", "L", e.w); add("h", "H", e.h); break;
      case "text": add("x", "X", e.x); add("y", "Y", e.y); add("height", "H testo", e.height || 4); break;
      default: break;
    }
    fields += `</div>`;
    fields += `<div class="field" style="margin-top:8px"><label>Livello</label><select class="prop-input" data-pk="__layer">`;
    state.layers.forEach((ly) => {
      fields += `<option value="${ly.id}" ${e.layer === ly.id ? "selected" : ""}>${ly.name}</option>`;
    });
    fields += `</select></div>`;
    if (isClosedEntity(e)) {
      fields += `<div style="margin-top:6px;font-size:12px;color:var(--muted)">Area ${fmt(entityArea(e), 2)} ${state.units}²</div>`;
    }
    if (e.type === "text") {
      fields += `<div class="field" style="margin-top:8px"><label>Testo</label><input class="prop-input" data-pk="text" value="${(e.text || "").replace(/"/g, "&quot;")}" /></div>`;
    }
    if (e.type === "polyline" || e.type === "spline") {
      fields += `<label class="check"><input type="checkbox" data-pk="closed" ${e.closed ? "checked" : ""}/> Profilo chiuso (estrusione)</label>`;
    }
    box.innerHTML = fields;
    box.querySelectorAll("[data-pk]").forEach((inp) => {
      const apply = () => {
        const k = inp.dataset.pk;
        if (inp.type === "checkbox") e[k] = inp.checked;
        else if (k === "text") e[k] = inp.value;
        else if (k === "__layer") e.layer = inp.value;
        else if (k === "__len") {
          const v = parseFloat(inp.value);
          const L = dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }) || 1;
          if (Number.isFinite(v) && v > 0) {
            const f = v / L;
            e.x2 = e.x1 + (e.x2 - e.x1) * f;
            e.y2 = e.y1 + (e.y2 - e.y1) * f;
          }
        } else if (k === "__dia") {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v) && v > 0) e.r = v / 2;
        } else {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v)) e[k] = v;
        }
        pushHist(); draw(); refreshUI();
      };
      inp.addEventListener("change", apply);
      inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") apply(); });
    });
  }

  function renderLayers() {
    const el = $("layer-list");
    el.innerHTML = "";
    for (const ly of state.layers) {
      const row = document.createElement("div");
      row.className = "pill";
      row.style.outline = state.layer === ly.id ? "1px solid rgba(245,166,35,0.45)" : "none";
      row.innerHTML = `
        <div class="name">
          <input type="color" data-a="col" value="${/^#[0-9a-fA-F]{6}$/.test(ly.color) ? ly.color : "#e8eaef"}" title="Colore livello"/>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ly.name}</span>
        </div>
        <div style="display:flex;gap:2px">
          <button class="mini" data-a="vis" title="Visibile">${ly.visible ? "●" : "○"}</button>
          <button class="mini" data-a="lock" title="Blocca">${ly.locked ? "🔒" : "🔓"}</button>
          <button class="mini" data-a="use" title="Livello corrente">✓</button>
        </div>`;
      row.querySelector("[data-a=vis]").onclick = (e) => { e.stopPropagation(); ly.visible = !ly.visible; refreshUI(); draw(); };
      row.querySelector("[data-a=lock]").onclick = (e) => { e.stopPropagation(); ly.locked = !ly.locked; refreshUI(); draw(); };
      row.querySelector("[data-a=use]").onclick = (e) => { e.stopPropagation(); state.layer = ly.id; refreshUI(); };
      const col = row.querySelector("[data-a=col]");
      if (col) {
        col.onclick = (e) => e.stopPropagation();
        col.onchange = (e) => { e.stopPropagation(); ly.color = col.value; refreshUI(); draw(); };
      }
      row.ondblclick = (e) => {
        e.stopPropagation();
        state.selection = state.entities.filter((x) => x.layer === ly.id && layerVisible(x.layer) && !layerLocked(x.layer)).map((x) => x.id);
        refreshUI(); draw();
      };
      row.onclick = () => { state.layer = ly.id; refreshUI(); };
      el.appendChild(row);
    }
  }

  /* ---------- templates ---------- */
  function newDrawing() {
    state.entities = [];
    state.selection = [];
    state.draft = null;
    state.name = "senza-nome";
    state.history = [];
    state.histIndex = -1;
    pushHist();
    markSaved();
    fitView();
    refreshUI();
  }

  function loadTemplate(name) {
    const apply = () => {
    newDrawing();
    const L0 = "0", F = "fori";
    const E = [];
    if (name === "plate" || name === "rounded") {
      const plate = { type: "rect", x: 0, y: 0, w: 80, h: 50, rot: 0, layer: L0, id: uid() };
      filletEntity(plate, 6);
      E.push(plate);
      [[10, 10], [70, 10], [70, 40], [10, 40]].forEach(([x, y]) => E.push({ type: "circle", cx: x, cy: y, r: 3, layer: F }));
      E.push({ type: "dimension", x1: 0, y1: 0, x2: 80, y2: 0, offset: -12, layer: "quote" });
      E.push({ type: "dimension", x1: 0, y1: 0, x2: 0, y2: 50, offset: -12, layer: "quote" });
    } else if (name === "flange") {
      E.push({ type: "circle", cx: 0, cy: 0, r: 40, layer: L0 });
      E.push({ type: "circle", cx: 0, cy: 0, r: 18, layer: F });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        E.push({ type: "circle", cx: Math.cos(a) * 29, cy: Math.sin(a) * 29, r: 3.5, layer: F });
      }
    } else if (name === "bracket") {
      E.push({
        type: "polyline", closed: true, layer: L0,
        points: [
          { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 10 }, { x: 10, y: 10 },
          { x: 10, y: 40 }, { x: 0, y: 40 }
        ]
      });
      E.push({ type: "circle", cx: 8, cy: 32, r: 2.5, layer: F });
      E.push({ type: "circle", cx: 50, cy: 5, r: 2.5, layer: F });
    } else if (name === "channel") {
      E.push({
        type: "polyline", closed: true, layer: L0,
        points: [
          { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 46, y: 30 },
          { x: 46, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 30 }, { x: 0, y: 30 }
        ]
      });
    } else if (name === "gasket") {
      E.push({ type: "circle", cx: 0, cy: 0, r: 30, layer: L0 });
      E.push({ type: "circle", cx: 0, cy: 0, r: 20, layer: F });
    } else if (name === "door") {
      ensureLayer("ferramenta", "Ferramenta", "#c084fc", false);
      ensureLayer("foto", "Foto", "#8b93a7", true);
      const built = (typeof SchizzoTrace !== "undefined" && SchizzoTrace.doorElevation) ? SchizzoTrace.doorElevation() : null;
      if (built) {
        built.entities.forEach((e) => E.push(e));
        state.name = built.name || "porta-interna";
        state.gridStep = 50;
      }
    }
    E.forEach((e) => { e.id = uid(); state.entities.push(e); });
    if (name === "door") state.name = "porta-interna";
    else state.name = name;
    pushHist();
    markSaved();
    fitView();
    refreshUI();
    };
    if (state.entities.length) {
      showModal("Caricare il modello?",
        `<p>Sostituisce lo schizzo corrente (${state.entities.length} oggetti).</p>`,
        [
          { label: "Annulla" },
          { label: "Carica", primary: true, fn: () => { hideModal(); apply(); } }
        ]);
    } else apply();
  }

  /* ---------- file ---------- */
  function projectJSON() {
    return JSON.stringify({
      app: "schizzo", v: 1, units: state.units, entities: state.entities, layers: state.layers, layer: state.layer, name: state.name, gridStep: state.gridStep, thickness: state.thickness
    }, null, 2);
  }
  function saveProject() {
    const nameEl = $("dwg-name");
    if (nameEl && nameEl.value.trim()) state.name = nameEl.value.trim();
    SchizzoExport.download((state.name || "schizzo") + ".schizzo", projectJSON(), "application/json");
    markSaved();
    refreshUI();
  }
  function loadProject(obj) {
    if (!obj || !Array.isArray(obj.entities)) throw new Error("File non valido");
    state.units = obj.units || "mm";
    state.entities = obj.entities;
    state.layers = obj.layers || state.layers;
    state.layer = obj.layer || "0";
    state.name = obj.name || "schizzo";
    state.gridStep = obj.gridStep || 5;
    if (obj.thickness) state.thickness = obj.thickness;
    state.selection = [];
    state.history = [];
    state.histIndex = -1;
    pushHist();
    markSaved();
    fitView();
    refreshUI();
  }

  function importPhotoFile(file) {
    const run = () => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const im = new Image();
        im.onload = () => {
          try {
            ensureLayer("ferramenta", "Ferramenta", "#c084fc", false);
            ensureLayer("foto", "Foto", "#8b93a7", true);
            const prompt = (window._schizzoPrompt || "").trim();
            const built = SchizzoTrace.generateFromImage
              ? SchizzoTrace.generateFromImage(im, prompt)
              : SchizzoTrace.entitiesFromTrace(SchizzoTrace.tracePhoto(im));
            if (!built || !built.entities.length) throw new Error("Nessun oggetto riconoscibile sulla foto.");
            if (built.thickness) state.thickness = built.thickness;
            if ($("ex-th")) $("ex-th").value = state.thickness;
            built.entities.forEach((e) => {
              if (e.type === "image") e.src = src;
              e.id = uid();
            });
            state.entities = built.entities;
            state.selection = [];
            state.history = [];
            state.histIndex = -1;
            state.name = (file.name || "foto").replace(/\.[^.]+$/, "");
            state.gridStep = built.kind === "door" ? 50 : 5;
            pushHist();
            markSaved();
            fitView();
            refreshUI();
            state.view3d = true;
            if ($("btn-3d")) $("btn-3d").classList.add("active");
            hintEl.textContent = built.note || "Modello generato dalla foto";
          } catch (err) {
            showModal("Foto non convertita", `<p>${err.message || err}</p>`, [{ label: "Ok", primary: true }]);
          }
        };
        im.onerror = () => showModal("Foto non letta", "<p>Formato immagine non supportato.</p>", [{ label: "Ok", primary: true }]);
        im.src = src;
        imgCache.set(src, im);
      };
      reader.readAsDataURL(file);
    };
    if (state.entities.length) {
      showModal("Generare lo schizzo da foto?",
        `<p>Sostituisce il disegno corrente (${state.entities.length} oggetti) con il CAD ricavato dalla foto.</p>`,
        [
          { label: "Annulla" },
          { label: "Genera", primary: true, fn: () => { hideModal(); run(); } }
        ]);
    } else run();
  }

  function openFile(file) {
    const go = () => {
    const isImg = /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name) || (file.type || "").startsWith("image/");
    if (isImg) { importPhotoFile(file); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const name = file.name.toLowerCase();
        if (name.endsWith(".dxf") || /^\s*0\s*$/m.test(text.slice(0, 80)) && text.includes("SECTION")) {
          const parsed = SchizzoExport.fromDXF(text);
          if (!parsed.entities.length) throw new Error("Nessuna geometria DXF (LINE, CIRCLE, ARC, LWPOLYLINE).");
          parsed.entities.forEach((e) => { e.id = uid(); });
          state.entities = parsed.entities;
          state.units = parsed.units || "mm";
          if (parsed.layers) state.layers = parsed.layers;
          state.layer = "0";
          state.name = file.name.replace(/\.[^.]+$/, "");
          state.selection = [];
          state.history = [];
          state.histIndex = -1;
          pushHist();
          fitView();
          refreshUI();
          markSaved();
          hintEl.textContent = `Importati ${parsed.entities.length} oggetti da DXF (${state.units})`;
        } else if (name.endsWith(".svg") || text.trim().startsWith("<")) {
          importSVG(text);
        } else {
          loadProject(JSON.parse(text));
        }
      } catch (err) {
        showModal("Impossibile aprire", `<p>${err.message || err}</p>`, [{ label: "Ok", primary: true }]);
      }
    };
    reader.readAsText(file);
    };
    if (state.entities.length) {
      const safe = String(file.name || "file").replace(/[<>]/g, "");
      showModal("Sostituire il disegno?",
        `<p>Aprire <b>${safe}</b> sostituisce lo schizzo corrente (${state.entities.length} oggetti).</p><p>Esporta prima se vuoi conservarlo.</p>`,
        [
          { label: "Annulla" },
          { label: "Sostituisci", primary: true, fn: () => { hideModal(); go(); } }
        ]);
    } else go();
  }

  function importSVG(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const added = [];
    const num = (el, a, d = 0) => parseFloat(el.getAttribute(a) || d);
    doc.querySelectorAll("line").forEach((el) => {
      added.push({ type: "line", x1: num(el, "x1"), y1: num(el, "y1"), x2: num(el, "x2"), y2: num(el, "y2") });
    });
    doc.querySelectorAll("circle").forEach((el) => {
      added.push({ type: "circle", cx: num(el, "cx"), cy: num(el, "cy"), r: num(el, "r") });
    });
    doc.querySelectorAll("ellipse").forEach((el) => {
      added.push({ type: "ellipse", cx: num(el, "cx"), cy: num(el, "cy"), rx: num(el, "rx"), ry: num(el, "ry"), rot: 0 });
    });
    doc.querySelectorAll("rect").forEach((el) => {
      added.push({ type: "rect", x: num(el, "x"), y: num(el, "y"), w: num(el, "width"), h: num(el, "height"), rot: 0 });
    });
    doc.querySelectorAll("polygon,polyline").forEach((el) => {
      const pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(parseFloat);
      const points = [];
      for (let i = 0; i + 1 < pts.length; i += 2) points.push({ x: pts[i], y: pts[i + 1] });
      if (points.length >= 2) added.push({ type: el.tagName.toLowerCase() === "polygon" ? "polygon" : "polyline", points, closed: el.tagName.toLowerCase() === "polygon" });
    });
    if (!added.length) throw new Error("Nessuna geometria SVG semplice (linee, cerchi, rettangoli, polilinee).");
    const bb = SchizzoExport.bboxOf(added);
    const flipY = (y) => bb.minY + bb.maxY - y;
    added.forEach((e) => {
      if (e.type === "line") { e.y1 = flipY(e.y1); e.y2 = flipY(e.y2); }
      else if (e.type === "circle" || e.type === "ellipse") e.cy = flipY(e.cy);
      else if (e.type === "rect") e.y = flipY(e.y + e.h);
      else if (e.points) e.points.forEach((p) => { p.y = flipY(p.y); });
      e.id = uid(); e.layer = state.layer; state.entities.push(e);
    });
    pushHist(); fitView(); refreshUI();
  }

  /* ---------- export ---------- */
  function exportOpts() {
    const selEl = $("ex-sel");
    const dimEl = $("ex-dim");
    const selOnly = !!(selEl && selEl.checked);
    return {
      units: state.units,
      includeDimensions: !!(dimEl && dimEl.checked),
      selectionIds: selOnly && state.selection.length ? state.selection : null
    };
  }
  function exportSTL() {
    const T = state.thickness || parseFloat($("ex-th") && $("ex-th").value) || 40;
    const stl = SchizzoExport.toSTL(state, { thickness: T });
    SchizzoExport.download((state.name || "schizzo") + ".stl", stl, "model/stl");
  }
  function doExportDXF() {
    const dxf = SchizzoExport.toDXF(state, exportOpts());
    SchizzoExport.download((state.name || "schizzo") + ".dxf", dxf, "application/dxf");
  }
  function exportDXF() {
    if (!state.entities.length) {
      showModal("Disegno vuoto", "<p>Non c’è geometria da esportare. Disegna un profilo o apri un modello.</p>", [{ label: "Ok", primary: true }]);
      return;
    }
    if (countClosed() === 0) {
      showModal(
        "Nessun profilo chiuso",
        "<p>Onshape estrae i solidi da <b>contorni chiusi</b>. Chiudi le polilinee (Invio+C), usa un rettangolo/cerchio, oppure <b>Unisci linee</b>.</p><p>Puoi esportare comunque: le linee aperte restano geometria di schizzo.</p>",
        [
          { label: "Annulla" },
          { label: "Esporta comunque", primary: true, fn: () => { hideModal(); doExportDXF(); } }
        ]
      );
      return;
    }
    doExportDXF();
  }
  function exportSVG() {
    const svg = SchizzoExport.toSVG(state, exportOpts());
    SchizzoExport.download((state.name || "schizzo") + ".svg", svg, "image/svg+xml");
  }
  function exportPNG() {
    const opts = exportOpts();
    const list = state.entities.filter((e) => {
      if (opts.selectionIds && !opts.selectionIds.includes(e.id)) return false;
      if (!layerVisible(e.layer)) return false;
      if (e.type === "dimension" && !opts.includeDimensions) return false;
      return true;
    });
    const bb = SchizzoExport.bboxOf(list.length ? list : state.entities);
    const pad = 4;
    const wMm = Math.max(1, bb.maxX - bb.minX + pad * 2);
    const hMm = Math.max(1, bb.maxY - bb.minY + pad * 2);
    const dpi = parseFloat($("png-dpi").value) || 150;
    const pxPerMm = state.units === "in" ? dpi : dpi / 25.4;
    const W = Math.max(32, Math.round(wMm * pxPerMm));
    const H = Math.max(32, Math.round(hMm * pxPerMm));
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const g = off.getContext("2d");
    const bg = $("png-bg").value;
    if (bg === "white") { g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H); }
    else if (bg === "dark") { g.fillStyle = "#0b0d11"; g.fillRect(0, 0, W, H); }
    else { g.clearRect(0, 0, W, H); }

    const scale = pxPerMm;
    const ox = pad - bb.minX, oy = pad - bb.minY;
    const saved = { view: { ...state.view }, sel: state.selection.slice() };
    /* draw using a local transform: world -> png */
    g.save();
    /* Y-up: flip */
    g.translate(0, H);
    g.scale(scale, -scale);
    g.translate(ox, oy);

    const toLocal = (p) => p;
    const stroke = (e) => {
      const col = bg === "white" ? (colorOf(e) === "#e8eaef" ? "#111111" : colorOf(e)) : colorOf(e);
      g.lineWidth = 0.25;
      g.strokeStyle = col;
      g.lineCap = "round"; g.lineJoin = "round";
      switch (e.type) {
        case "line":
          g.beginPath(); g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke(); break;
        case "circle":
          g.beginPath(); g.arc(e.cx, e.cy, e.r, 0, TAU); g.stroke(); break;
        case "arc":
          g.beginPath(); g.arc(e.cx, e.cy, e.r, e.a0, e.a1, false); g.stroke(); break;
        case "ellipse":
          g.beginPath(); g.ellipse(e.cx, e.cy, e.rx, e.ry, e.rot || 0, 0, TAU); g.stroke(); break;
        case "rect": {
          const pts = SchizzoExport.rectPoints(e);
          g.beginPath(); g.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach((p) => g.lineTo(p.x, p.y)); g.closePath(); g.stroke();
          break;
        }
        case "polyline":
        case "polygon": {
          const pts = SchizzoExport.polylineDrawPts(e);
          if (!pts.length) break;
          g.beginPath(); g.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach((p) => g.lineTo(p.x, p.y));
          if (e.type === "polygon" || e.closed) g.closePath();
          g.stroke();
          break;
        }
        case "spline": {
          const pts = SchizzoExport.sampleSpline(e.points, !!e.closed, 16);
          if (!pts.length) break;
          g.beginPath(); g.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach((p) => g.lineTo(p.x, p.y));
          if (e.closed) g.closePath();
          g.stroke();
          break;
        }
        case "image": {
          const im = imageOf(e);
          if (im && im.complete && im.naturalWidth) {
            g.save();
            g.globalAlpha = e.opacity == null ? 0.4 : e.opacity;
            g.translate(e.x, e.y + e.h);
            g.scale(1, -1);
            g.drawImage(im, 0, 0, e.w, e.h);
            g.restore();
          }
          break;
        }
        default: break;
      }
    };
    list.forEach(stroke);
    g.restore();
    off.toBlob((blob) => {
      SchizzoExport.download((state.name || "schizzo") + ".png", blob, "image/png");
    }, "image/png");
  }

  function showDwgInfo() {
    showModal(
      "DWG e Onshape",
      `<p>Il <b>DWG</b> è un formato binario proprietario Autodesk. Nei browser non è possibile generare un DWG nativo affidabile.</p>
       <p>Onshape importa gli schizzi 2D da <b>DXF R2000</b> con lo stesso risultato del DWG: linee, archi, cerchi e polilinee chiuse diventano profili da estrudere.</p>
       <p>Flusso consigliato:</p>
       <ol class="help-list">
         <li>Disegna profili <b>chiusi</b> in millimetri (contatore in Proprietà).</li>
         <li>Esporta <b>DXF Onshape</b>.</li>
         <li>In Onshape: <b>Inserisci → Importa</b> nel Part Studio, oppure importa su un piano di schizzo.</li>
         <li>Usa <b>Estrudi</b> o <b>Rivoluzione</b> sui profili.</li>
       </ol>
       <p>Se un software richiede per forza l’estensione .dwg, Onshape non è tra questi: usa il DXF.</p>`,
      [
        { label: "Chiudi" },
        { label: "Scarica DXF", primary: true, fn: () => { hideModal(); exportDXF(); } }
      ]
    );
  }

  function showHelp() {
    showModal(
      "Guida rapida",
      `<p>Schizzo è un CAD 2D di precisione. I profili chiusi diventano solidi 3D in Onshape.</p>
       <div class="h">Strumenti</div>
       <ul class="help-list">
         <li><kbd>L</kbd> linea · <kbd>PL</kbd> polilinea · <kbd>C</kbd> cerchio · <kbd>R</kbd> rettangolo · <kbd>A</kbd> arco</li>
         <li>Raccordo sugli angoli (archi veri nel DXF) · serie rettangolare/polare dei fori</li>
         <li><kbd>S</kbd> seleziona · <kbd>M</kbd> sposta · <kbd>CO</kbd> copia · <kbd>RO</kbd> ruota · <kbd>TR</kbd> taglia · <kbd>BR</kbd> spezza · <kbd>X</kbd> esplodi</li>
         <li><kbd>F8</kbd> ortogonale · <kbd>F10</kbd> polare 45° · <kbd>F3</kbd> snap · <kbd>G</kbd> griglia · <kbd>F</kbd> adatta vista</li>
         <li><kbd>Ctrl+Z</kbd> annulla · <kbd>Ctrl+D</kbd> duplica · <kbd>Ctrl+S</kbd> salva · <kbd>Ctrl+N</kbd> nuovo · <kbd>+</kbd>/<kbd>-</kbd> zoom</li>
         <li>Cerchio: <kbd>Shift</kbd> diametro, <kbd>Alt</kbd> tre punti · Quota: <kbd>Shift</kbd> orizz., <kbd>Alt</kbd> vert. · <kbd>DH</kbd>/<kbd>DV</kbd></li>
       </ul>
       <div class="h">Coordinate</div>
       <ul class="help-list">
         <li><kbd>100,50</kbd> punto assoluto</li>
         <li><kbd>@20,0</kbd> relativo all’ultimo punto</li>
         <li><kbd>40&lt;90</kbd> polare: 40 unità a 90°</li>
         <li>Durante il tracciamento, scrivi solo la <b>distanza</b> e premi Invio</li>
       </ul>
       <p>Snap: estremo, medio, centro, quadrante, intersezione, perpendicolare, tangente, più vicino, griglia.</p>`,
      [{ label: "Ho capito", primary: true }]
    );
  }

  function showModal(title, html, actions) {
    modal.innerHTML = `<h2>${title}</h2>${html}<div class="modal-actions"></div>`;
    const bar = modal.querySelector(".modal-actions");
    (actions || [{ label: "Ok", primary: true }]).forEach((a) => {
      const b = document.createElement("button");
      b.className = "tbtn" + (a.primary ? " primary" : "");
      b.textContent = a.label;
      b.onclick = () => { if (a.fn) a.fn(); else hideModal(); };
      bar.appendChild(b);
    });
    overlay.classList.add("show");
  }
  function hideModal() { overlay.classList.remove("show"); }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) hideModal(); });

  function showContext(x, y) {
    ctxMenu.innerHTML = `
      <button data-k="move">Sposta</button>
      <button data-k="copy">Copia</button>
      <button data-k="rotate">Ruota</button>
      <button data-k="dup">Duplica</button>
      <button data-k="explode">Esplodi</button>
      <button data-k="layer">Assegna al livello corrente</button>
      <button data-k="del">Elimina</button>
      <hr/>
      <button data-k="close">Chiudi polilinea</button>
    `;
    ctxMenu.style.left = x + "px";
    ctxMenu.style.top = y + "px";
    ctxMenu.classList.add("show");
    ctxMenu.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        hideCtx();
        const k = b.dataset.k;
        if (k === "move") startModify("move");
        if (k === "copy") startModify("copy");
        if (k === "rotate") startModify("rotate");
        if (k === "dup") duplicateSelection();
        if (k === "explode") explodeSelection();
        if (k === "layer") {
          selectedEntities().forEach((e) => { if (!layerLocked(e.layer)) e.layer = state.layer; });
          pushHist(); refreshUI(); draw();
        }
        if (k === "del") deleteSelection();
        if (k === "close") {
          selectedEntities().forEach((e) => {
            if (e.type === "polyline" || e.type === "spline") e.closed = true;
          });
          pushHist(); draw(); refreshUI();
        }
      };
    });
  }
  function hideCtx() { ctxMenu.classList.remove("show"); }
  window.addEventListener("mousedown", (e) => { if (!ctxMenu.contains(e.target)) hideCtx(); });

  /* ---------- init ---------- */
  function init() {
    resize();
    window.addEventListener("resize", resize);
    try {
      const raw = localStorage.getItem("schizzo-autosave-v2");
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.entities) && obj.entities.length) {
          loadProject(obj);
          hintEl.textContent = "Ripristinato l’ultimo disegno. " + (HINTS.select);
        }
      }
    } catch (_) { /* ignore */ }
    if (!state.entities.length) {
      loadTemplate("door");
      hintEl.textContent = "Porta 800×2100 da foto — anta, telaio, maniglia. DXF Onshape";
    }
    if (!state.history.length) pushHist();
    markSaved();
    updateStatus();
    refreshUI();
    draw();
    setTool("select");
    window.addEventListener("beforeunload", (ev) => {
      if (!isDirty()) return;
      ev.preventDefault();
      ev.returnValue = "";
    });
  }
  init();
})();
