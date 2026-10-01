/* Schizzo Models — modelli parametrici di officina
 *
 * Ogni modello:
 *   schema()          → parametri (nome, etichetta, unità, default, limiti)
 *   fit(analysis, tx) → stima i parametri dalla foto (con evidenze e controlli)
 *   build(params)     → entità CAD in mm (Y verso l'alto) + quote + note
 *
 * Le misure chiave restano numeri "di officina": chi le cambia nel pannello
 * Parametri rigenera il disegno in modo coerente (nessun valore scollegato).
 */
(function (global) {
  "use strict";

  const r = (v, d) => {
    const k = Math.pow(10, d == null ? 1 : d);
    return Math.round(v * k) / k;
  };
  const r05 = (v) => Math.round(v * 2) / 2;

  /* --------------------------------------------------------------- utilità */

  function stadium(x0, y0, x1, y1, half) {
    /* capsula fra due centri, spessore 2*half: polilinea chiusa con due raccordi
       semicircolari (bulge), così DXF e STL la trattano come profilo chiuso. */
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const p1 = { x: x0 + nx * half, y: y0 + ny * half };
    const p2 = { x: x1 + nx * half, y: y1 + ny * half };
    const p3 = { x: x1 - nx * half, y: y1 - ny * half };
    const p4 = { x: x0 - nx * half, y: y0 - ny * half };
    /* verso dell'anello: p1→p2→p3→p4 */
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    const b = (cross >= 0 ? 1 : -1) * Math.tan(Math.PI / 8);
    return [{
      type: "polyline", closed: true, points: [
        { x: p1.x, y: p1.y, bulge: 0 },
        { x: p2.x, y: p2.y, bulge: b },
        { x: p3.x, y: p3.y, bulge: 0 },
        { x: p4.x, y: p4.y, bulge: b }
      ]
    }];
  }

  function roundedRect(x, y, w, h, rr) {
    /* rettangolo con angoli arrotondati, come polilinea con bulge */
    const k = rr > 0 ? Math.min(rr, Math.min(w, h) / 2) : 0;
    if (k <= 0.01) return [{ type: "rect", x, y, w, h, rot: 0 }];
    const b = Math.tan(Math.PI / 8); /* 90° → bulge tan(θ/4) */
    const pts = [
      { x: x + k, y: y, bulge: 0 },
      { x: x + w - k, y: y, bulge: b },
      { x: x + w, y: y + k, bulge: 0 },
      { x: x + w, y: y + h - k, bulge: b },
      { x: x + w - k, y: y + h, bulge: 0 },
      { x: x + k, y: y + h, bulge: b },
      { x: x, y: y + h - k, bulge: 0 },
      { x: x, y: y + k, bulge: b }
    ];
    return [{ type: "polyline", closed: true, points: pts }];
  }

  /* --------------------------------------------------------- testo dell'utente */

  /**
   * Legge le misure dichiarate dall'utente ("anta 800x2100, spessore 40,
   * maniglia a 1019, backset 45, 3 cerniere, serratura a destra").
   * Le misure dichiarate sono autorevoli: la foto serve a completare il resto.
   */
  function parsePrompt(text) {
    const raw = String(text == null ? "" : text);
    const t = raw.toLowerCase().replace(/[×✕xX*]/g, "x").replace(/,/g, ".");
    const num = (s) => parseFloat(String(s).replace(",", "."));
    const out = { raw, text: {} };
    const T = out.text;
    let m;
    /* anta: "anta 800x2100" oppure una coppia qualsiasi che sembra una porta */
    m = t.match(/anta\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/) ||
        t.match(/(\d{1,4})\s*x\s*(\d{1,4})/);
    if (m) {
      const a = num(m[1]), b = num(m[2]);
      T.pair = [a, b];
      let w = a, h = b;
      if (w < 250 && h < 400) { w *= 10; h *= 10; }        /* 80x210 → 800x2100 */
      if (w <= 20 && h <= 30) { w *= 100; h *= 100; }      /* 8x21  → 800x2100 */
      if (w >= 400 && h >= 1200 && h > w) { T.antaW = w; T.antaH = h; }
    }
    m = t.match(/larghezza\s*[:=]?\s*(\d+(?:\.\d+)?)/); if (m) T.antaW = num(m[1]);
    m = t.match(/altezza\s*[:=]?\s*(\d+(?:\.\d+)?)/); if (m) T.antaH = num(m[1]);
    m = t.match(/spess(?:ore)?\s*[:=]?\s*(\d+(?:\.\d+)?)/) ||
        t.match(/\bsp\.?\s*[:=]?\s*(\d+(?:\.\d+)?)/); if (m) T.thickness = num(m[1]);
    m = t.match(/manigl\w*\s*(?:a|ad|h|alta)?\s*(\d{3,4}(?:\.\d+)?)/); if (m) T.manigliaH = num(m[1]);
    m = t.match(/back\s?set\s*[:=]?\s*(\d+(?:\.\d+)?)/); if (m) T.backset = num(m[1]);
    m = t.match(/rosetta\s*(?:da|:)?\s*(\d+(?:\.\d+)?)/); if (m) T.rosetta = num(m[1]);
    m = t.match(/chiave\s*(?:a|:)?\s*(\d+(?:\.\d+)?)/); if (m) T.chiave = num(m[1]);
    m = t.match(/(\d+)\s*cerniere/); if (m) T.cerniere = parseInt(m[1], 10);
    m = t.match(/coprifilo\s*(?:da|:)?\s*(\d+(?:\.\d+)?)/); if (m) { T.copL = num(m[1]); T.copR = num(m[1]); T.copT = num(m[1]); }
    m = t.match(/battut\w*\s*(?:da|:)?\s*(\d+(?:\.\d+)?)/); if (m) { T.battL = num(m[1]); T.battR = num(m[1]); T.battT = num(m[1]); }
    m = t.match(/for[oi]\s*(?:da|:)?\s*[ø⌀]?\s*(\d+(?:\.\d+)?)/); if (m) T.holeD = num(m[1]);
    m = t.match(/[ø⌀]\s*(\d+(?:\.\d+)?)/); if (m && T.holeD == null) T.holeD = num(m[1]);
    m = t.match(/margine\s*(?:di|:)?\s*(\d+(?:\.\d+)?)/); if (m) T.margin = num(m[1]);
    if (/destra/.test(t)) T.lato = "destra";
    if (/sinistra/.test(t)) T.lato = "sinistra";
    return out;
  }

  /** Applica le misure dichiarate sopra a quelle stimate. */
  function applyDeclared(params, declared, schema) {
    const applied = [];
    if (!declared) return applied;
    schema.forEach((s) => {
      const v = declared[s.id];
      if (v == null || v === "") return;
      if (s.options && !s.options.includes(v)) return;
      if (typeof v === "number" && !Number.isFinite(v)) return;
      params[s.id] = v;
      applied.push({ id: s.id, label: s.label, value: v });
    });
    return applied;
  }

  /* ------------------------------------------------------------ modello PORTA */

  const DOOR_STD = {
    antaW: [700, 750, 800, 900, 1000],
    antaH: [2000, 2050, 2100, 2150],
    battusa: [35, 40, 45, 50],
    coprifilo: [60, 70, 80, 90, 100],
    maniglia: [1000, 1019, 1020, 1050],
    backset: [40, 45, 50, 60, 70],
    ferramenta: [50]
  };
  const stdSnap = (v, list, tolPct) => {
    let best = null, bd = Infinity;
    for (const s of list) {
      const d = Math.abs(s - v) / Math.max(1, v);
      if (d < bd) { bd = d; best = s; }
    }
    return bd <= (tolPct == null ? 0.05 : tolPct) ? best : v;
  };

  const DOOR = {
    id: "door",
    label: "Porta a battente",
    hint: "Alzato frontale: coprifilo, telaio, anta, maniglia, bocchetta chiave.",
    schema: () => ([
      { id: "antaW", label: "Larghezza anta", unit: "mm", def: 800, min: 300, max: 1500, std: DOOR_STD.antaW, group: "Anta" },
      { id: "antaH", label: "Altezza anta", unit: "mm", def: 2100, min: 500, max: 3000, std: DOOR_STD.antaH, group: "Anta" },
      { id: "battL", label: "Battuta sinistra", unit: "mm", def: 40, min: 5, max: 200, std: DOOR_STD.battusa, group: "Telaio" },
      { id: "battR", label: "Battuta destra", unit: "mm", def: 40, min: 5, max: 200, std: DOOR_STD.battusa, group: "Telaio" },
      { id: "battT", label: "Battuta superiore", unit: "mm", def: 55, min: 5, max: 250, std: DOOR_STD.battusa, group: "Telaio" },
      { id: "copL", label: "Coprifilo sinistro", unit: "mm", def: 70, min: 10, max: 300, std: DOOR_STD.coprifilo, group: "Coprifilo" },
      { id: "copR", label: "Coprifilo destro", unit: "mm", def: 70, min: 10, max: 300, std: DOOR_STD.coprifilo, group: "Coprifilo" },
      { id: "copT", label: "Coprifilo superiore", unit: "mm", def: 70, min: 10, max: 300, std: DOOR_STD.coprifilo, group: "Coprifilo" },
      { id: "manigliaH", label: "Asse maniglia da terra", unit: "mm", def: 1019, min: 800, max: 1300, std: DOOR_STD.maniglia, group: "Ferramenta" },
      { id: "backset", label: "Maniglia dal bordo anta", unit: "mm", def: 40, min: 20, max: 120, std: DOOR_STD.backset, group: "Ferramenta" },
      { id: "rosetta", label: "Rosetta (quadra)", unit: "mm", def: 50, min: 20, max: 120, std: DOOR_STD.ferramenta, group: "Ferramenta" },
      { id: "chiave", label: "Bocchetta sotto maniglia", unit: "mm", def: 90, min: 30, max: 200, std: [65, 70, 72, 78, 90, 100], group: "Ferramenta" },
      { id: "manigliaL", label: "Maniglia: lunghezza dal centro", unit: "mm", def: 110, min: 40, max: 250, std: [95, 105, 110, 120, 130], group: "Ferramenta" },
      { id: "cerniere", label: "N. cerniere", unit: "", def: 3, min: 0, max: 4, group: "Ferramenta" },
      { id: "lato", label: "Lato serratura", unit: "", def: "sinistra", options: ["sinistra", "destra"], group: "Ferramenta" },
      { id: "spessore", label: "Spessore anta (3D)", unit: "mm", def: 40, min: 20, max: 120, group: "3D" },
      { id: "altezzaDavanzale", label: "Spazio sotto anta", unit: "mm", def: 0, min: 0, max: 60, group: "3D" }
    ]),

    defaults() {
      const p = {};
      this.schema().forEach((s) => { p[s.id] = s.def; });
      return p;
    },

    /** Stima dei parametri dalla foto: geometria + ferramenta. */
    fit(a, prompt) {
      const out = { params: this.defaults(), evidence: [], checks: [], warn: [], conf: 0 };
      if (!a || !a.box) { out.warn.push("Contorno non riconosciuto: nessuna stima automatica."); return out; }
      const box = a.box;
      const tx = (prompt && prompt.text) || {};
      const V = a.lines.v.map((l) => l.pos).filter((v) => v > box.x0 + 1 && v < box.x1 - 1).sort((x, y) => x - y);
      const H = a.lines.h.map((l) => l.pos).filter((v) => v > box.y0 + 1 && v < box.y1 - 1).sort((x, y) => x - y);
      const bx0 = box.x0, bx1 = box.x1, by0 = box.y0, by1 = box.y1;
      const blobs = (a.blobs || []).filter((b) => b.n > 40);

      /* --- anta candidata: rettangolo con proporzione da porta, ferramenta dentro,
             e nessuna linea forte al proprio interno (l'anta è la zona "pulita") --- */
      const target = 800 / 2100;
      const blobBox = (b) => ({ x0: b.bx0 - 3, y0: b.by0 - 3, x1: b.bx1 + 3, y1: b.by1 + 3 });
      const nearBlob = (v, horiz, bl) => bl.some((b) => horiz ? (v > b.x0 && v < b.x1) : (v > b.y0 && v < b.y1));
      let best = null;
      const candidates = [];
      for (const l of V) {
        for (const rr of V) {
          if (rr - l < (bx1 - bx0) * 0.3) continue;
          const leafW = rr - l;
          for (const t of H.concat([by0])) {
            const leafH = by1 - t;
            if (leafH < (by1 - by0) * 0.65) continue;
            const ar = leafW / leafH;
            const err = Math.abs(ar - target) / target;
            if (err > 0.08) continue;
            const inside = blobs.every((b) => b.x > l && b.x < rr && b.y > t && b.y < by1);
            if (!inside) continue;
            /* linee interne non spiegate dalla ferramenta */
            const bb = blobs.map(blobBox);
            const vIn = V.filter((v) => v > l + 2 && v < rr - 2 && !nearBlob(v, true, bb)).length;
            const hIn = H.filter((v) => v > t + 2 && v < by1 - 2 && !nearBlob(v, false, bb)).length;
            const extra = vIn + hIn;
            if (extra > 2) continue;
            const score = err * 3 + extra * 0.05 - leafW / (bx1 - bx0) * 0.01;
            candidates.push({ l, r: rr, t, b: by1, score, leafW, leafH, ar, extra });
            if (!best || score < best.score) best = { l, r: rr, t, b: by1, score, leafW, leafH, ar, extra };
          }
        }
      }
      if (!best) { out.warn.push("Anta non identificata con certezza: uso le proporzioni standard 800×2100."); return out; }

      /* --- scala: anta 800×2100 (o quella indicata nel testo) --- */
      const stdW = tx.antaW || 800, stdH = tx.antaH || 2100;
      const mmW = stdW / best.leafW, mmH = stdH / best.leafH;
      const mm = (mmW + mmH) / 2;
      const scartoScala = Math.abs(mmW - mmH) / mm;
      out.evidence.push({ id: "anta", label: "Anta dai pixel", px: `${r(best.leafW, 1)}×${r(best.leafH, 1)} px`, mm: `${stdW}×${stdH} mm` });
      out.evidence.push({ id: "scala", label: "Scala", px: "—", mm: `${r(mm, 3)} mm/px` });
      out.checks.push({
        id: "scala", ok: scartoScala < 0.02, label: "Scala coerente X/Y",
        detail: `X ${r(mmW, 3)} · Y ${r(mmH, 3)} mm/px · scarto ${r(scartoScala * 100, 2)}%`
      });
      if (scartoScala >= 0.02) out.warn.push(`Scala X e Y discordanti del ${r(scartoScala * 100, 1)}%: la foto potrebbe essere deformata.`);

      const P = out.params;
      P.antaW = r05(stdW);
      P.antaH = r05(stdH);
      if (tx.antaW || tx.antaH) {
        out.evidence.push({
          id: "dichiarato", label: "Misure dichiarate da te",
          px: "—", mm: `${P.antaW}×${P.antaH} mm (usate come riferimento di scala)`
        });
      }

      /* --- battute e coprifilo --- */
      const vScore = {}; a.lines.v.forEach((l) => { vScore[l.pos] = l.score; });
      const hScore = {}; a.lines.h.forEach((l) => { hScore[l.pos] = l.score; });
      /* la piega del coprifilo: la linea più marcata entro il 25% dal bordo (escluso il bordo) */
      function strongestNear(positions, scores, edge, limit) {
        let bestPos = null, bs = -1;
        for (const v of positions) {
          const d = Math.abs(v - edge);
          if (d < 1.5 || d > limit) continue;
          const s = scores[v] || 0;
          if (s > bs) { bs = s; bestPos = v; }
        }
        return bestPos;
      }
      const copInL = strongestNear(V, vScore, bx0, (bx1 - bx0) * 0.25);
      const copInR = strongestNear(V, vScore, bx1, (bx1 - bx0) * 0.25);
      const copInT = strongestNear(H, hScore, by0, (by1 - by0) * 0.3);
      P.copL = r05(copInL != null ? (copInL - bx0) * mm : 70);
      P.copR = r05(copInR != null ? (bx1 - copInR) * mm : 70);
      P.copT = r05(copInT != null ? (copInT - by0) * mm : 70);
      P.battL = r05(copInL != null ? (best.l - copInL) * mm : 0);
      P.battR = r05(copInR != null ? (copInR - best.r) * mm : 0);
      P.battT = r05(copInT != null ? (best.t - copInT) * mm : 0);
      P.altezzaDavanzale = 0;
      out.evidence.push({
        id: "telaio", label: "Telaio e coprifilo",
        px: `L ${copInL != null ? r(copInL - bx0, 1) : "?"} px + ${copInL != null ? r(best.l - copInL, 1) : "?"} px`,
        mm: `coprifilo ${P.copL}/${P.copR}/${P.copT} · battuta ${P.battL}/${P.battR}/${P.battT}`
      });

      /* --- ferramenta --- */
      if (blobs.length) {
        const main = blobs.slice().sort((x, y) => y.n - x.n)[0];
        const others = blobs.filter((b) => b !== main);
        const key = others.slice().sort((x, y) => y.n - x.n).find((b) => b.y > main.y) || null;
        /* asse maniglia: centro verticale della rosetta (dal riquadro, non dal baricentro) */
        const axY = (main.by0 + main.by1) / 2;
        const axX = key ? key.x : (main.x < best.l + best.leafW / 2 ? main.bx0 + main.w * 0.5 : main.bx1 - main.w * 0.5);
        P.manigliaH = r05((by1 - axY) * mm);
        const leafEdge = (key && key.x < best.l + best.leafW / 2) || (!key && main.x < best.l + best.leafW / 2) ? best.l : best.r;
        const dir = leafEdge === best.l ? 1 : -1;
        P.backset = r05(Math.abs(axX - leafEdge) * mm);
        P.rosetta = r05((main.by1 - main.by0) * mm);
        /* maniglia: dal centro rosetta alla punta (bordo esterno del blob) */
        const tipX = dir > 0 ? main.bx1 : main.bx0;
        P.manigliaL = r05(Math.abs(tipX - axX) * mm);
        P.lato = leafEdge === best.l ? "sinistra" : "destra";
        if (key) P.chiave = r05((key.y - axY) * mm);
        P.spessore = tx.thickness ? r05(tx.thickness) : P.spessore;

        /* controllo forte: rosetta e bocchetta sono della stessa serie */
        if (key) {
          const rw = main.by1 - main.by0, kw = key.w, kh = key.h;
          const same = Math.abs(rw - kw) / rw < 0.18 && Math.abs(kw - kh) / kw < 0.12;
          out.checks.push({
            id: "ferramenta", ok: same, label: "Rosetta e bocchetta coerenti",
            detail: `rosetta ${r(rw, 1)} px · bocchetta ${r(kw, 1)}×${r(kh, 1)} px`
          });
        }
        out.evidence.push({
          id: "maniglia", label: "Maniglia",
          px: `asse y=${r(axY, 1)} · backset ${r(Math.abs(axX - leafEdge), 1)} px`,
          mm: `H ${P.manigliaH} · dal bordo ${P.backset} · ${P.lato}`
        });
      } else {
        out.warn.push("Nessuna ferramenta riconosciuta: maniglia e bocchetta sono ai valori standard.");
      }

      /* --- le misure dichiarate dall'utente vincono sulle stime --- */
      out.declared = applyDeclared(P, tx, this.schema());

      /* --- controlli di coerenza sulle misure --- */
      const manOk = P.manigliaH >= 900 && P.manigliaH <= 1150;
      out.checks.push({
        id: "maniglia", ok: manOk, label: "Altezza maniglia plausibile",
        detail: `${P.manigliaH} mm da terra (intervallo tipico 950–1100)`
      });
      const bsOk = P.backset >= 25 && P.backset <= 90;
      out.checks.push({
        id: "backset", ok: bsOk, label: "Backset plausibile",
        detail: `${P.backset} mm (tipico 40–60)`
      });
      const copOk = P.copL > 20 && P.copL < 200;
      out.checks.push({ id: "coprifilo", ok: copOk, label: "Coprifilo plausibile", detail: `${P.copL} mm` });
      out.conf = out.checks.filter((c) => c.ok).length / Math.max(1, out.checks.length);
      return out;
    },

    /** Entità CAD (mm, Y verso l'alto, origine = angolo basso-sinistro esterno). */
    build(p, opts) {
      opts = opts || {};
      const E = [], D = [], N = [];
      const copL = p.copL, copR = p.copR, copT = p.copT;
      const battL = p.battL, battR = p.battR, battT = p.battT;
      const OW = r(p.antaW + battL + battR + copL + copR, 1);
      const OH = r(p.antaH + battT + copT + (p.altezzaDavanzale || 0), 1);
      const leafX = copL + battL, leafY = p.altezzaDavanzale || 0;
      const O = "contorno", F = "ferramenta", Q = "quote";

      /* coprifilo esterno */
      E.push({ type: "polyline", closed: true, layer: O, points: [{ x: 0, y: 0 }, { x: OW, y: 0 }, { x: OW, y: OH }, { x: 0, y: OH }] });
      /* piega coprifilo (bordo interno del coprifilo, a U) */
      E.push({
        type: "polyline", closed: false, layer: O, points: [
          { x: copL, y: 0 }, { x: copL, y: OH - copT }, { x: OW - copR, y: OH - copT }, { x: OW - copR, y: 0 }
        ]
      });
      /* anta */
      E.push({ type: "rect", x: leafX, y: leafY, w: p.antaW, h: p.antaH, rot: 0, layer: O });

      /* --- ferramenta --- */
      const latoSx = p.lato !== "destra";
      const axX = latoSx ? leafX + p.backset : leafX + p.antaW - p.backset;
      const axY = leafY + p.manigliaH;
      const ro = p.rosetta / 2;
      roundedRect(axX - ro, axY - ro, p.rosetta, p.rosetta, p.rosetta * 0.12)
        .forEach((e) => E.push({ ...e, layer: F }));
      /* maniglia: capsula dal centro rosetta verso l'interno dell'anta */
      const dir = latoSx ? 1 : -1;
      const tip = p.manigliaL - p.rosetta * 0.5;
      if (tip > 6) {
        stadium(axX, axY, axX + dir * tip, axY, 10).forEach((e) => E.push({ ...e, layer: F }));
      }
      /* bocchetta chiave: piastra + fessura */
      const kx = axX, ky = axY - p.chiave;
      const kh = p.rosetta;
      roundedRect(kx - ro, ky - kh / 2, p.rosetta, kh, p.rosetta * 0.12).forEach((e) => E.push({ ...e, layer: F }));
      const slotW = 5, slotH = 10.5;
      stadium(kx, ky + slotH / 2 - slotW / 2 - 2, kx, ky - slotH / 2 + slotW / 2 + 2, slotW / 2)
        .forEach((e) => E.push({ ...e, layer: F }));
      /* cerniere (non visibili in foto: posizione standard) */
      if (p.cerniere > 0) {
        const hx = latoSx ? leafX + p.antaW - 6 : leafX;
        const pos = p.cerniere === 1 ? [p.antaH / 2]
          : p.cerniere === 2 ? [180, p.antaH - 180]
          : p.cerniere === 3 ? [250, p.antaH / 2, p.antaH - 250]
          : [200, p.antaH * 0.45, p.antaH * 0.7, p.antaH - 200];
        pos.forEach((hh) => {
          E.push({ type: "rect", x: hx, y: leafY + hh - 15, w: 24, h: 34, rot: 0, layer: F });
        });
        N.push(`Cerniere: ${p.cerniere} — posizione standard da terra ${pos.map((v) => Math.round(v)).join(" / ")} mm (non visibili in foto).`);
      }

      /* --- quote (posizioni scelte per non sovrapporsi al disegno) --- */
      const off = opts.dimOffset || 60;
      D.push({ type: "dimension", x1: 0, y1: 0, x2: OW, y2: 0, offset: -off, layer: Q });
      D.push({ type: "dimension", x1: 0, y1: 0, x2: 0, y2: OH, offset: -off, layer: Q });
      D.push({ type: "dimension", x1: leafX, y1: leafY, x2: leafX + p.antaW, y2: leafY, offset: -off - 72, layer: Q });
      D.push({ type: "dimension", x1: leafX + p.antaW, y1: leafY, x2: leafX + p.antaW, y2: leafY + p.antaH, offset: 24, layer: Q });
      /* coprifilo + battuta superiori, fuori dall'ingombro */
      D.push({ type: "dimension", x1: 0, y1: leafY + p.antaH, x2: 0, y2: OH, offset: -off - 72, layer: Q });
      /* asse maniglia da terra, a sinistra del coprifilo */
      D.push({ type: "dimension", x1: leafX, y1: leafY, x2: leafX, y2: axY, offset: -26, layer: Q });
      /* backset: sopra la maniglia */
      D.push({ type: "dimension", x1: latoSx ? leafX : leafX + p.antaW, y1: axY + 26, x2: axX, y2: axY + 26, offset: 0, layer: Q });
      /* rosetta: fra rosetta e bocchetta */
      D.push({ type: "dimension", x1: axX - ro, y1: axY - ro - 34, x2: axX + ro, y2: axY - ro - 34, offset: 0, layer: Q });
      /* lunghezza maniglia: sotto la bocchetta */
      const tipX = axX + dir * tip;
      D.push({ type: "dimension", x1: axX, y1: ky - kh / 2 - 60, x2: tipX, y2: ky - kh / 2 - 60, offset: 0, layer: Q });
      /* interasse maniglia-chiave: fuori dall'anta, dal lato opposto alla maniglia */
      D.push({ type: "dimension", x1: axX, y1: axY, x2: kx, y2: ky, offset: dir > 0 ? -58 : 58, layer: Q });

      N.push(`Ferramenta: rosetta quadra ${r(p.rosetta, 1)}×${r(p.rosetta, 1)} mm, maniglia ${r(p.manigliaL, 1)} mm dal centro, bocchetta ${r(p.chiave, 1)} mm sotto l'asse.`);
      N.push(`Anta ${r(p.antaW, 1)}×${r(p.antaH, 1)} mm · coprifilo ${r(copL, 1)} mm · battuta ${r(battL, 1)}×${r(battT, 1)} mm · spessore ${r(p.spessore, 1)} mm.`);

      return {
        kind: "door",
        entities: E, dims: D, notes: N,
        width: OW, height: OH,
        bounds: { minX: -off - 40, minY: -off - 40, maxX: OW + off * 0.4, maxY: OH + off * 0.6 },
        thickness: p.spessore,
        meta: { name: "porta-a-battente", material: "Legno / MDF nobilitato" }
      };
    }
  };

  /* ------------------------------------------------- modello generico (pannello) */

  const PANEL = {
    id: "panel",
    label: "Pannello / piastra",
    hint: "Contorno rettilineo con fori: ricava ingombro, spessore e fori dalla foto.",
    schema: () => ([
      { id: "w", label: "Larghezza", unit: "mm", def: 200, min: 5, max: 5000, group: "Ingombro" },
      { id: "h", label: "Altezza", unit: "mm", def: 120, min: 5, max: 5000, group: "Ingombro" },
      { id: "thickness", label: "Spessore (3D)", unit: "mm", def: 5, min: 0.5, max: 200, group: "3D" },
      { id: "holeD", label: "Diametro fori", unit: "mm", def: 6, min: 0.5, max: 200, group: "Fori" },
      { id: "margin", label: "Distanza fori dal bordo", unit: "mm", def: 12, min: 0, max: 500, group: "Fori" }
    ]),
    defaults() {
      const p = {};
      this.schema().forEach((s) => { p[s.id] = s.def; });
      return p;
    },
    fit(a, prompt) {
      const out = { params: this.defaults(), evidence: [], checks: [], warn: [], conf: 0 };
      if (!a || !a.box) { out.warn.push("Contorno non riconosciuto."); return out; }
      const tx = (prompt && prompt.text) || {};
      const P = out.params;
      const px2mm = tx.refMm && tx.refPx ? tx.refMm / tx.refPx : null;
      const mm = px2mm || (tx.maxDim ? tx.maxDim / Math.max(a.box.w, a.box.h) : 1);
      P.w = r05(a.box.w * mm); P.h = r05(a.box.h * mm);
      if (tx.pair) { P.w = r05(tx.pair[0]); P.h = r05(tx.pair[1]); }
      P.thickness = tx.thickness ? r05(tx.thickness) : P.thickness;
      if (a.circles && a.circles.length) {
        const rr = a.circles.slice().sort((x, y) => y.r - x.r)[0];
        P.holeD = r05(rr.r * 2 * mm);
        /* margine: distanza del foro dal bordo più vicino */
        const dn = [];
        dn.push(rr.cx - a.box.x0, a.box.x1 - rr.cx, rr.cy - a.box.y0, a.box.y1 - rr.cy);
        P.margin = r05(Math.min(...dn) * mm);
        out.evidence.push({ id: "foro", label: "Foro rilevato", px: `R ${r(rr.r, 1)} px`, mm: `Ø ${P.holeD} mm` });
      } else {
        out.warn.push("Nessun foro rilevato: diametro e margine restano ai valori standard.");
      }
      out.declared = applyDeclared(P, tx, this.schema());
      out.conf = 0.6;
      return out;
    },
    build(p) {
      const E = [], D = [], N = [];
      E.push({ type: "rect", x: 0, y: 0, w: p.w, h: p.h, rot: 0, layer: "contorno" });
      const m = p.margin, d = p.holeD / 2;
      const holes = [
        { x: m, y: m }, { x: p.w - m, y: m }, { x: p.w - m, y: p.h - m }, { x: m, y: p.h - m }
      ];
      holes.forEach((h) => E.push({ type: "circle", cx: h.x, cy: h.y, r: d, layer: "fori" }));
      D.push({ type: "dimension", x1: 0, y1: 0, x2: p.w, y2: 0, offset: -40, layer: "quote", label: "Larghezza" });
      D.push({ type: "dimension", x1: 0, y1: 0, x2: 0, y2: p.h, offset: -40, layer: "quote", label: "Altezza" });
      D.push({ type: "dimension", x1: m, y1: 0, x2: m, y2: m, offset: -18, layer: "quote", label: "Margine" });
      N.push(`${holes.length} fori Ø ${r(p.holeD, 1)} mm a ${r(m, 1)} mm dai bordi.`);
      return {
        kind: "panel", entities: E, dims: D, notes: N, width: p.w, height: p.h,
        bounds: { minX: -70, minY: -70, maxX: p.w + 30, maxY: p.h + 30 },
        thickness: p.thickness, meta: { name: "pannello", material: "Alluminio / acciaio" }
      };
    }
  };

  const MODELS = { door: DOOR, panel: PANEL };

  /** Sceglie il modello adatto: parole chiave + forma rilevata. */
  function choose(a, prompt) {
    const t = ((prompt && prompt.text && prompt.text.raw) || "").toLowerCase();
    if (/porta|door|anta|battente|telaio|coprifilo/.test(t)) return "door";
    if (/piastra|plate|pannello|panel|flangia|staffa/.test(t)) return "panel";
    if (!a || !a.box) return "panel";
    const ar = a.box.h / a.box.w;
    const hasKey = (a.blobs || []).length >= 2;
    if (ar > 1.6 && ar < 4.2 && hasKey) return "door";
    return "panel";
  }

  global.SchizzoModels = {
    MODELS, choose, doors: DOOR, panel: PANEL,
    stdSnap, stadium, roundedRect, parsePrompt, applyDeclared, r: r, r05: r05
  };
})(typeof window !== "undefined" ? window : globalThis);
