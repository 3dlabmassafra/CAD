const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
global.window.__SCHIZZO_NO_INIT__ = true;

require("../precision.js");
require("../models.js");
require("../sheet.js");
require("../export.js");

const width = 360;
const height = 780;
const pixels = new Uint8ClampedArray(width * height * 4);

function fillRect(x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = 255;
  }
}

/* Deterministic front-view fixture: dark background, wood-tone slab, two metal details. */
fillRect(0, 0, width - 1, height - 1, [4, 4, 4]);
fillRect(7, 7, width - 8, height - 8, [178, 127, 75]);
fillRect(25, 28, width - 26, height - 22, [160, 110, 64]);
fillRect(44, 48, width - 45, height - 25, [179, 127, 78]);
fillRect(50, 60, width - 51, height - 33, [178, 126, 75]);
fillRect(48, 403, 84, 414, [235, 235, 235]);
fillRect(48, 430, 61, 451, [235, 235, 235]);
const imageData = { width, height, data: pixels };

const image = { naturalWidth: width, naturalHeight: height, width, height };
global.document = {
  createElement() {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({
      drawImage() {},
      getImageData: () => imageData
    });
    return canvas;
  },
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; }
};
require("../studio.js");

test("photo analysis returns a measurable contour and explicit QA results", () => {
  const analysis = SchizzoPrecision.analyze(imageData, { maxDim: 1400, circles: false });
  assert.ok(analysis.box);
  assert.ok(analysis.box.w > 250);
  assert.ok(analysis.box.h > 600);
  assert.ok(analysis.quality.checks.some((check) => check.id === "contorno"));
  assert.ok(analysis.lines.v.every((line) => Number.isFinite(line.pos)));
});

test("parametric door fit honors declared dimensions and assembles a closed CAD model", () => {
  const analysis = SchizzoPrecision.analyze(imageData, { maxDim: 1400, circles: false });
  const prompt = SchizzoModels.parsePrompt("porta interna anta 800x2100, spessore 40, maniglia a 1019, backset 45");
  const fit = SchizzoModels.doors.fit(analysis, prompt);
  const built = SchizzoModels.doors.build(fit.params, {});

  assert.equal(fit.params.antaW, 800);
  assert.equal(fit.params.antaH, 2100);
  assert.equal(fit.params.manigliaH, 1019);
  assert.equal(fit.params.spessore, 40);
  assert.ok(built.width > 800);
  assert.ok(built.height > 2100);
  assert.ok(built.entities.some((entity) => entity.type === "polyline" && entity.closed));
  assert.ok(analysis.quality.errors >= 0);
});

test("studio wrapper builds a millimetre sheet and DXF/STL without NaN values", () => {
  const result = studioAnalyze(image, {
    prompt: "porta interna anta 800x2100, spessore 40, maniglia a 1019, backset 45"
  });
  const built = result.built;
  const layers = [
    { id: "contorno", name: "Contorno", color: "#e8eaef", visible: true },
    { id: "ferramenta", name: "Ferramenta", color: "#4db2ff", visible: true },
    { id: "fori", name: "Fori", color: "#4db2ff", visible: true },
    { id: "quote", name: "Quote", color: "#f0c040", visible: true }
  ];
  const dxf = SchizzoExport.toDXF({
    units: "mm", layers, thickness: built.thickness,
    entities: built.entities.concat(built.dims || [])
  }, { units: "mm", includeDimensions: true });
  const stl = SchizzoExport.toSTL({
    units: "mm", layers, thickness: built.thickness,
    entities: built.entities.filter((entity) => entity.layer !== "ferramenta" && entity.layer !== "quote")
  }, { thickness: built.thickness });

  assert.match(result.sheet.svg, /<svg/);
  assert.match(result.sheet.svg, /297mm/);
  assert.match(dxf, /\$INSUNITS/);
  assert.match(dxf, /SECTION/);
  assert.match(stl, /facet normal/);
  assert.doesNotMatch(result.sheet.svg + dxf + stl, /NaN|Infinity/);
});
