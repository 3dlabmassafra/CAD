/* Studio — foto → misure verificate → disegno tecnico quotato → CAD / Ragnar
 *
 * Flusso in tre passi, con controlli espliciti su ogni numero:
 *   1. foto                → immagine + eventuali misure dichiarate
 *   2. verifica            → analisi deterministica (precision.js): contorno,
 *                            linee persistenti, simmetria, ferramenta, QA
 *   3. disegno tecnico     → modello parametrico (models.js) su foglio (sheet.js)
 *
 * Export: SVG / PNG / DXF (Onshape, Ragnar) / STL / brief.json
 */
(function () {
  "use strict";

  const P = window.SchizzoPrecision;
  const M = window.SchizzoModels;
  const S = window.SchizzoSheet;

  const $ = (id) => document.getElementById(id);
  const state = {
    file: null, img: null, imageData: null,
    analysis: null, fit: null, params: null, built: null, sheet: null,
    model: "door", prompt: "", declared: {}, paper: "a3p", dims: true, detail: true, busy: false,
    step: 1
  };

  /* ------------------------------------------------------------ utilità UI */

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  /** Analizza un'immagine già caricata (usata dal wizard e dallo script di build). */
  window.studioAnalyze = function (img, opts) {
    const maxDim = (opts && opts.maxDim) || 1400;
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(8, Math.round(img.naturalWidth * k));
    const h = Math.max(8, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
    const data = c.getContext("2d").getImageData(0, 0, w, h);
    const prompt = (opts && opts.prompt) || "";
    const analysis = P.analyze(data, { maxDim, circles: false });
    const parsed = M.parsePrompt(prompt);
    const kind = (opts && opts.model) || M.choose(analysis, parsed);
    const model = M.MODELS[kind];
    const fit = model.fit(analysis, parsed);
    const built = model.build(fit.params, {});
    const sheet = S.render(built, fit.params, { paper: "a3p", title: built.meta.name.replace(/-/g, " ") });
    return { analysis, kind, fit, built, sheet };
  };

  function setStep(n) {
    state.step = n;
    document.querySelectorAll(".step-item").forEach((el) => {
      const i = +el.dataset.step;
      el.classList.toggle("on", i === n);
      el.classList.toggle("done", i < n && (i === 1 ? !!state.img : !!state.built));
    });
    document.querySelectorAll(".pane").forEach((el) => el.classList.toggle("on", +el.dataset.step === n));
    updateActionBar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateActionBar() {
    const bar = $("ab-status");
    if (!bar) return;
    if (!state.img) { bar.innerHTML = "Carica una foto per iniziare."; }
    else if (!state.built) { bar.innerHTML = `Foto caricata · <b>${state.fit ? state.fit.params.antaW + "×" + state.fit.params.antaH + " mm stimati" : "in attesa di analisi"}</b>`; }
    else {
      const b = state.built;
      bar.innerHTML = `Disegno pronto · <b>${b.width}×${b.height} mm</b> · ${b.entities.length} entità · ${(b.dims || []).length} quote`;
    }
    const next = $("ab-next");
    next.textContent = state.built ? "Torna al disegno" : state.fit ? "Genera il disegno tecnico" : "Analizza la foto";
    next.disabled = !state.img;
  }

  async function withProgress(title, steps, work) {
    const overlay = $("progress");
    $("progress-title").textContent = title;
    overlay.hidden = false;
    const label = $("progress-step");
    const tick = async (msg) => { label.textContent = msg; await nextFrame(); };
    try {
      return await work(tick);
    } finally {
      overlay.hidden = true;
    }
  }

  /* ------------------------------------------------------------ 1. la foto */

  function bindDrop() {
    const drop = $("drop");
    const input = $("file-photo");
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("drag");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    input.addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) loadFile(f);
    });
    const paste = (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) { loadFile(it.getAsFile()); break; }
      }
    };
    window.addEventListener("paste", paste);
    /* i parametri: dal testo alle misure */
    const promptEl = $("prompt");
    promptEl.addEventListener("input", () => {
      state.prompt = promptEl.value;
      state.declared = M.parsePrompt(promptEl.value).text;
      renderDeclared();
    });
    document.querySelectorAll("[data-esempio]").forEach((b) => {
      b.addEventListener("click", () => {
        promptEl.value = b.dataset.esempio;
        promptEl.dispatchEvent(new Event("input"));
      });
    });
    $("btn-demo").addEventListener("click", () => loadURL("porta.jpg"));
  }

  function renderDeclared() {
    const box = $("declared");
    const list = Object.entries(state.declared);
    if (!list.length) { box.innerHTML = `<span class="pill">Nessuna misura dichiarata: uso le misure stimate dalla foto.</span>`; return; }
    box.innerHTML = list.map(([k, v]) => {
      const s = (M.doors.schema().concat(M.panel.schema())).find((x) => x.id === k);
      return `<span class="pill ok">${s ? s.label : k}: <b>${v}</b></span>`;
    }).join(" ");
  }

  function loadURL(url) {
    const img = new Image();
    img.onload = () => setImage(img, url.split("/").pop());
    img.onerror = () => alert("Esempio non trovato: " + url);
    img.src = url;
  }

  function loadFile(file) {
    if (!file.type.startsWith("image/")) { alert("Serve un'immagine (JPG, PNG, WEBP)."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setImage(img, file.name);
      img.onerror = () => alert("Immagine non leggibile.");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function setImage(img, name) {
    state.img = img;
    state.fileName = name || "foto";
    state.analysis = null; state.fit = null; state.built = null; state.sheet = null;
    const prev = $("photo-preview");
    prev.src = img.src;
    prev.hidden = false;
    $("drop-msg").hidden = true;
    $("file-meta").textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${name || ""}`;
    updateActionBar();
  }

  /* ----------------------------------------------- 2. analisi e verifica */

  function readImageData(img, maxDim) {
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(8, Math.round(img.naturalWidth * k));
    const h = Math.max(8, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h);
  }

  async function runAnalysis() {
    if (!state.img || state.busy) return;
    state.busy = true;
    try {
      const result = await withProgress("Analisi della foto", 5, async (tick) => {
        await tick("Preparo l'immagine…");
        const data = readImageData(state.img, 1400);
        state.imageData = data;
        await tick("Cerco il contorno del pezzo…");
        const a = P.analyze(data, { maxDim: 1400, circles: false });
        await tick("Misuro linee, simmetria e ferramenta…");
        await nextFrame();
        await tick("Confronto le proporzioni…");
        return a;
      });
      state.analysis = result;
      state.model = M.choose(result, M.parsePrompt(state.prompt));
      const model = M.MODELS[state.model];
      state.fit = model.fit(result, M.parsePrompt(state.prompt));
      state.params = state.fit.params;
      drawOverlay();
      renderParams();
      renderEvidence();
      updateActionBar();
      setStep(3);
    } finally {
      state.busy = false;
    }
  }

  /* --------------------------------------------- overlay sulla fotografia */

  function drawOverlay() {
    const a = state.analysis;
    const canvas = $("overlay");
    if (!a || !state.imageData) return;
    const img = state.imageData;
    const maxW = 900;
    const k = Math.min(1, maxW / img.width);
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    const g = canvas.getContext("2d");
    g.fillStyle = "#0a0c10";
    g.fillRect(0, 0, canvas.width, canvas.height);
    /* immagine */
    const tmp = document.createElement("canvas");
    tmp.width = img.width; tmp.height = img.height;
    tmp.getContext("2d").putImageData(img, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    const sc = k;
    const line = (x1, y1, x2, y2, color, width, dash) => {
      g.save();
      g.strokeStyle = color; g.lineWidth = width || 1;
      if (dash) g.setLineDash(dash);
      g.beginPath(); g.moveTo(x1 * sc, y1 * sc); g.lineTo(x2 * sc, y2 * sc); g.stroke();
      g.restore();
    };
    /* contorno */
    const b = a.box;
    if (b) {
      g.save();
      g.strokeStyle = "#3ecf8e"; g.lineWidth = 2;
      g.strokeRect(b.x0 * sc, b.y0 * sc, (b.x1 - b.x0) * sc, (b.y1 - b.y0) * sc);
      g.restore();
    }
    /* linee persistenti */
    (a.lines.v || []).forEach((l) => line(l.pos, b ? b.y0 : 0, l.pos, b ? b.y1 : canvas.height / sc, l.edge ? "#3ecf8e" : (l.sym ? "#4db2ff" : "#8b93a7"), l.edge ? 2 : 1.4));
    (a.lines.h || []).forEach((l) => line(b ? b.x0 : 0, l.pos, b ? b.x1 : canvas.width / sc, l.pos, l.edge ? "#3ecf8e" : "#8b93a7", l.edge ? 2 : 1.2));
    /* ferramenta */
    (a.blobs || []).forEach((bl) => {
      g.save();
      g.strokeStyle = "#c084fc"; g.lineWidth = 1.6; g.setLineDash([4, 3]);
      g.strokeRect(bl.bx0 * sc, bl.by0 * sc, (bl.bx1 - bl.bx0) * sc, (bl.by1 - bl.by0) * sc);
      g.restore();
    });
    /* cerchi */
    (a.circles || []).forEach((c) => {
      g.save();
      g.strokeStyle = "#f0c040"; g.lineWidth = 1.6;
      g.beginPath(); g.arc(c.cx * sc, c.cy * sc, c.r * sc, 0, Math.PI * 2); g.stroke();
      g.restore();
    });
    /* anta stimata */
    const f = state.fit;
    if (f && f.params && state.model === "door") {
      const p = f.params;
      void p;
    }
  }

  /* -------------------------------------------------- 3. pannello misure */

  function renderParams() {
    const model = M.MODELS[state.model];
    const schema = model.schema();
    const box = $("params");
    const groups = [];
    schema.forEach((s) => {
      const gname = s.group || "";
      let g = groups.find((x) => x.name === gname);
      if (!g) { g = { name: gname, items: [] }; groups.push(g); }
      g.items.push(s);
    });
    box.innerHTML = groups.map((g) => {
      const rows = g.items.map((s) => {
        const v = state.params[s.id];
        const isStd = Array.isArray(s.std) && s.std.some((x) => Math.abs(x - v) < 1e-6);
        const declared = state.declared[s.id] != null;
        if (s.options) {
          return `<div class="field-app">
            <label for="p-${s.id}">${s.label}${declared ? ' <span class="tagstd">tuo</span>' : ""}</label>
            <select id="p-${s.id}" data-pid="${s.id}">
              ${s.options.map((o) => `<option value="${o}"${o === v ? " selected" : ""}>${o}</option>`).join("")}
            </select>
          </div>`;
        }
        const list = Array.isArray(s.std) && s.std.length
          ? `<datalist id="dl-${s.id}">${s.std.map((x) => `<option value="${x}"></option>`).join("")}</datalist>` : "";
        return `<div class="field-app">
          <label for="p-${s.id}">${s.label}${s.unit ? ` <span style="color:var(--faint)">(${s.unit})</span>` : ""}${isStd ? ' <span class="tagstd">std</span>' : ""}${declared ? ' <span class="tagstd">tuo</span>' : ""}</label>
          <span class="schema-row"><input id="p-${s.id}" data-pid="${s.id}" type="number" value="${v}" step="${s.unit === "" ? 1 : 0.5}" list="dl-${s.id}" />${list}</span>
        </div>`;
      }).join("");
      return `<div class="group-title">${g.name}</div>${rows}`;
    }).join("");

    box.querySelectorAll("[data-pid]").forEach((el) => {
      el.addEventListener("change", () => {
        const id = el.dataset.pid;
        const val = el.tagName === "SELECT" ? el.value : parseFloat(el.value);
        if (val === "" || (typeof val === "number" && !Number.isFinite(val))) return;
        state.params[id] = val;
        regenerate();
        renderParams();
      });
    });

    const sel = $("model-select");
    if (sel) {
      sel.value = state.model;
      sel.onchange = () => {
        state.model = sel.value;
        refit();
      };
    }
  }

  function renderEvidence() {
    const f = state.fit;
    if (!f) return;
    const ev = $("evidence");
    ev.innerHTML = (f.evidence || []).map((e) => `
      <div class="ev-row">
        <span class="k">${e.label}</span>
        <span class="v">${e.mm}<small>${e.px && e.px !== "—" ? e.px : ""}</small></span>
      </div>`).join("");

    const checks = (f.checks || []);
    const cbox = $("checks");
    const aq = (state.analysis && state.analysis.quality) ? state.analysis.quality.checks : [];
    const all = checks.concat(aq.map((c) => ({ id: c.id, ok: c.ok, label: c.label, detail: c.detail })));
    cbox.innerHTML = all.map((c) => `
      <div class="check-row ${c.ok ? "ok" : "no"}">
        <span class="dot">${c.ok ? "✓" : "!"}</span>
        <span><span class="lbl">${c.label}</span><span class="det">${c.detail || ""}</span></span>
      </div>`).join("");

    const passed = all.filter((c) => c.ok).length;
    $("checks-summary").innerHTML = all.length
      ? `<span class="pill ${passed === all.length ? "ok" : "warn"}">${passed}/${all.length} controlli superati</span>`
      : "";

    const warns = $("warns");
    const list = (f.warn || []);
    warns.innerHTML = list.length
      ? list.map((w) => `<div class="check-row no"><span class="dot">!</span><span>${w}</span></div>`).join("")
      : "";
    warns.hidden = !list.length;
  }

  /* ------------------------------------------------- 4. generazione CAD */

  function refit() {
    const model = M.MODELS[state.model];
    state.fit = model.fit(state.analysis, M.parsePrompt(state.prompt));
    state.params = state.fit.params;
    renderParams(); renderEvidence();
    regenerate();
  }

  function regenerate() {
    const model = M.MODELS[state.model];
    state.built = model.build(state.params, {});
    renderSheet();
    updateActionBar();
  }

  /** Zona da ingrandire nel dettaglio: la ferramenta (maniglia + bocchetta). */
  function detailZone() {
    const b = state.built, p = state.params;
    if (!b || state.model !== "door" || !p) return null;
    const latoSx = p.lato !== "destra";
    const leafX = p.copL + p.battL;
    const ax = latoSx ? leafX + p.backset : leafX + p.antaW - p.backset;
    const ay = p.manigliaH;
    return { x0: ax - 150, y0: ay - 220, x1: ax + 280, y1: ay + 160 };
  }

  function renderSheet() {
    if (!state.built) return;
    const zone = state.detail ? detailZone() : null;
    const sheet = S.render(state.built, state.params, {
      paper: state.paper, dims: state.dims,
      title: state.built.meta.name.replace(/-/g, " "),
      detail: zone ? { box: zone, scale: 5, letter: "A" } : null
    });
    state.sheet = sheet;
    $("sheet").innerHTML = sheet.svg;
    $("sheet-meta").textContent = `${sheet.paper[0]}×${sheet.paper[1]} mm · scala 1:${sheet.scale} · ${sheet.stats.entities} entità · ${sheet.stats.dims} quote`;
  }

  /* ------------------------------------------------------- 5. esportazioni */

  function safeName(ext) {
    const base = (state.built && state.built.meta.name) || "disegno";
    return `${base}-3dlab.${ext}`;
  }

  function dxfState(onlyStructural) {
    const b = state.built;
    const layers = [
      { id: "contorno", name: "Contorno", color: "#e8eaef", visible: true },
      { id: "ferramenta", name: "Ferramenta", color: "#4db2ff", visible: true },
      { id: "fori", name: "Fori", color: "#4db2ff", visible: true },
      { id: "quote", name: "Quote", color: "#f0c040", visible: true }
    ];
    let entities = b.entities;
    if (onlyStructural) {
      /* per il 3D servono solo i profili del pezzo: niente ferramenta né quote */
      entities = entities.filter((e) => e.layer !== "ferramenta" && e.layer !== "quote");
    } else {
      entities = entities.concat(b.dims || []);
    }
    return { units: "mm", layers, entities, thickness: b.thickness };
  }

  function exportDXF() {
    if (!state.built) return;
    const txt = window.SchizzoExport.toDXF(dxfState(), { units: "mm", includeDimensions: state.dims });
    window.SchizzoExport.download(safeName("dxf"), txt, "application/dxf");
  }

  function exportSTL() {
    if (!state.built) return;
    const txt = window.SchizzoExport.toSTL(dxfState(true), { thickness: state.built.thickness || 40 });
    window.SchizzoExport.download(safeName("stl"), txt, "model/stl");
  }

  function exportSVG() {
    if (!state.sheet) return;
    window.SchizzoExport.download(safeName("svg"), state.sheet.svg, "image/svg+xml");
  }

  function exportPNG() {
    if (!state.sheet) return;
    const dpi = parseInt($("png-dpi").value, 10) || 150;
    S.toPNG(state.sheet.svg, state.sheet.paper, dpi, (blob) => {
      if (!blob) { alert("Rasterizzazione non riuscita: usa l'SVG o stampa dal browser."); return; }
      window.SchizzoExport.download(safeName("png"), blob, "image/png");
    });
  }

  function exportBrief() {
    if (!state.built) return;
    const b = state.built;
    const brief = {
      documento: "brief-per-ragnar",
      generato: new Date().toISOString(),
      produttore: "3D Lab Massafra — Foto → Disegno tecnico",
      modello: state.model,
      nome: b.meta.name,
      unita: "mm",
      spessore: b.thickness,
      ingombro: { larghezza: b.width, altezza: b.height },
      parametri: state.params,
      modello3d: {
        tipo: "estrusione",
        profilo: "contorno chiuso in mm",
        spessore_mm: b.thickness,
        fori: (b.entities || []).filter((e) => e.type === "circle").length,
        nota: "Estrudere i profili chiusi; i cerchi sono fori passanti; gli archi sono veri archi."
      },
      controlli: (state.fit.checks || []).map((c) => `${c.ok ? "OK" : "ATTENZIONE"} · ${c.label}: ${c.detail}`),
      note: b.notes || [],
      dxf: "esportare il DXF dello stesso nome (mm, R2000) per Onshape/Ragnar"
    };
    window.SchizzoExport.download(safeName("json"), JSON.stringify(brief, null, 2), "application/json");
  }

  function printSheet() {
    const w = window.open("", "_blank");
    if (!w) { alert("Consenti le finestre pop-up per stampare."); return; }
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${state.built.meta.name}</title>
      <style>@page{size:auto;margin:8mm}body{margin:0}svg{width:100%;height:auto}</style></head><body>${state.sheet.svg}
      <script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
    w.document.close();
  }

  /* ------------------------------------------------------------- avvio */

  function bindActions() {
    $("ab-next").addEventListener("click", () => {
      if (!state.img) { $("file-photo").click(); return; }
      if (!state.fit) { runAnalysis(); return; }
      setStep(3);
      $("sheet").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("btn-analyze").addEventListener("click", runAnalysis);
    $("btn-nuova").addEventListener("click", () => {
      state.img = null; state.analysis = null; state.fit = null; state.built = null;
      $("photo-preview").hidden = true;
      $("drop-msg").hidden = false;
      $("file-meta").textContent = "";
      setStep(1);
      updateActionBar();
    });
    $("btn-back").addEventListener("click", () => setStep(Math.max(1, state.step - 1)));
    $("btn-gen").addEventListener("click", () => {
      if (!state.built) regenerate();
      setStep(3);
    });
    $("dl-svg").addEventListener("click", exportSVG);
    $("dl-png").addEventListener("click", exportPNG);
    $("dl-dxf").addEventListener("click", exportDXF);
    $("dl-stl").addEventListener("click", exportSTL);
    $("dl-json").addEventListener("click", exportBrief);
    $("btn-print").addEventListener("click", printSheet);
    document.querySelectorAll("[data-paper]").forEach((b) => {
      b.addEventListener("click", () => {
        state.paper = b.dataset.paper;
        document.querySelectorAll("[data-paper]").forEach((x) => x.classList.toggle("primary", x === b));
        renderSheet();
      });
    });
    $("chk-dims").addEventListener("change", (e) => { state.dims = e.target.checked; renderSheet(); });
    const chkDetail = $("chk-detail");
    if (chkDetail) chkDetail.addEventListener("change", (e) => { state.detail = e.target.checked; renderSheet(); });
    document.querySelectorAll(".step-item").forEach((el) => {
      el.addEventListener("click", () => {
        const n = +el.dataset.step;
        if (n === 3 && !state.built) { if (state.img) runAnalysis(); return; }
        if (n === 2 && !state.img) return;
        setStep(n);
      });
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); state.fit ? regenerate() : runAnalysis(); }
    });
  }

  function init() {
    bindDrop();
    bindActions();
    renderDeclared();
    updateActionBar();
    setStep(1);
    const params = new URLSearchParams(location.search);
    if (params.get("demo") === "1") loadURL("porta.jpg");
  }

  if (!(typeof window !== "undefined" && window.__SCHIZZO_NO_INIT__)) {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
