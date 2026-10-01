const test = require("node:test");
const assert = require("node:assert/strict");
require("../trace.js");
global.window = globalThis;
require("../export.js");

const Trace = globalThis.SchizzoTrace;
const Export = globalThis.SchizzoExport;

function doorTrace() {
  return {
    kind: "door",
    outer: { w: 120, h: 300 },
    inner: { l: 10, r: 110, t: 10, b: 290 },
    px: { minX: 0, minY: 0, maxX: 120, maxY: 300, w: 120, h: 300, s: 1 },
    hardware: [
      { x: 20, y: 150, w: 12, h: 4, n: 50 },
      { x: 20, y: 164, w: 6, h: 6, n: 30 }
    ]
  };
}

test("parses explicit dimensions, units, thickness and handle height", () => {
  const spec = Trace.parsePrompt("Porta interna 80 × 210 cm, spessore 4 cm, maniglia H 1019 mm");
  assert.equal(spec.kind, "door");
  assert.equal(spec.w, 800);
  assert.equal(spec.h, 2100);
  assert.equal(spec.thickness, 40);
  assert.equal(spec.handleH, 1019);
});

test("parses decimal comma and named dimensions", () => {
  const spec = Trace.parsePrompt("Piastra larghezza 80,5 mm, altezza 50 mm, spessore 2,5 mm");
  assert.equal(spec.w, 80.5);
  assert.equal(spec.h, 50);
  assert.equal(spec.thickness, 2.5);
});

test("uses two explicit dimensions exactly and reports aspect mismatch", () => {
  const built = Trace.entitiesFromTrace(doorTrace(), { w: 800, h: 2100, thickness: 40 });
  const leaf = built.entities.find((e) => e.type === "rect" && e.layer === "0");
  assert.equal(leaf.w, 800);
  assert.equal(leaf.h, 2100);
  assert.equal(built.quality.featureWidth, 800);
  assert.equal(built.quality.featureHeight, 2100);
  assert.ok(built.warnings.some((warning) => warning.includes("rapporto della foto")));
});

test("preserves explicit measurement precision to hundredths of a millimetre", () => {
  const built = Trace.entitiesFromTrace(doorTrace(), { w: 800.25, h: 2100.5 });
  const leaf = built.entities.find((e) => e.type === "rect" && e.layer === "0");
  assert.equal(leaf.w, 800.25);
  assert.equal(leaf.h, 2100.5);
});

test("one reference dimension keeps a uniform photo ratio", () => {
  const built = Trace.entitiesFromTrace(doorTrace(), { w: 800 });
  assert.equal(built.leafW, 800);
  assert.equal(built.leafH, 2240);
  assert.equal(built.quality.inputWidth, 800);
  assert.equal(built.quality.inputHeight, null);
  assert.ok(built.warnings.some((warning) => warning.includes("parti nascoste")));
});

test("does not silently claim a guessed scale is exact", () => {
  const built = Trace.entitiesFromTrace(doorTrace(), {});
  assert.equal(built.quality.estimated, true);
  assert.ok(built.warnings.some((warning) => warning.includes("Scala indicativa")));
});

test("dimension refinement keeps the slab exact and moves door hardware only", () => {
  const built = { entities: Trace.doorElevation().entities, note: "Porta di prova", thickness: 40 };
  Trace.applySpec(built, { w: 400, h: 1050, handleH: 509, thickness: 50 });
  const leaf = built.entities.find((e) => e.type === "rect" && e.layer === "0");
  const handle = built.entities.filter((e) => e.type === "circle" && e.role === "door-hardware").sort((a, b) => b.r - a.r)[0];
  const hinge = built.entities.find((e) => e.type === "rect" && e.role === "hinge");
  assert.equal(leaf.w, 400);
  assert.equal(leaf.h, 1050);
  assert.equal(built.thickness, 50);
  assert.ok(Math.abs(handle.cy - (leaf.y + 509)) < 1e-9);
  assert.ok(hinge);
});

test("DXF and SVG exports include complete, unit-labelled dimensions", () => {
  const state = {
    units: "mm",
    layers: [
      { id: "0", name: "0", color: "#ffffff", visible: true },
      { id: "quote", name: "Quote", color: "#f0c040", visible: true }
    ],
    entities: [{ type: "dimension", x1: 0, y1: 0, x2: 800, y2: 0, offset: -40, layer: "quote" }]
  };
  const dxf = Export.toDXF(state, { units: "mm", includeDimensions: true });
  const svg = Export.toSVG(state, { units: "mm", includeDimensions: true });
  assert.match(dxf, /800\.00 mm/);
  assert.match(dxf, /LWPOLYLINE/);
  assert.match(svg, /800\.00 mm/);
  assert.match(svg, /<line/);
  const box = Export.bboxOf(state.entities);
  assert.ok(box.minY < -40);
});
