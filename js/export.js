import {
  applyAdjustments,
  canvasToBlob,
  createCanvas,
  fillBackground,
  getOutputSize,
  limitExportSize,
  renderGeometry,
} from "./image-pipeline.js";
import { buildAsciiSvg, generateAsciiGrid, gridToText, renderAsciiCanvas } from "./modes/ascii.js";
import { pixelateCanvas } from "./modes/pixel.js";
import { GrainLabEngine, renderGrainFallback } from "./modes/grain-lab.js";

export const IMAGE_FORMATS = Object.freeze([
  { id: "png", label: "PNG", mime: "image/png", extension: "png", note: "Lossless, transparency" },
  { id: "jpeg", label: "JPG", mime: "image/jpeg", extension: "jpg", note: "Smallest photo export" },
  { id: "webp", label: "WEBP", mime: "image/webp", extension: "webp", note: "Modern compressed image" },
]);

export const VECTOR_FORMATS = Object.freeze([
  { id: "txt", label: "TXT", mime: "text/plain", extension: "txt", note: "Plain character grid" },
  { id: "svg", label: "SVG", mime: "image/svg+xml", extension: "svg", note: "Scalable colored text" },
]);

function tick() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function safeName(value) {
  return String(value || "image")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "image";
}

export function exportFilename(state, format) {
  const formatInfo = [...IMAGE_FORMATS, ...VECTOR_FORMATS].find((item) => item.id === format);
  const extension = formatInfo?.extension || format;
  return `${safeName(state.source?.name)}-vanta-${state.mode}.${extension}`;
}

function formatInfo(format) {
  return [...IMAGE_FORMATS, ...VECTOR_FORMATS].find((item) => item.id === format) || null;
}

function resolveExportGeometry(state) {
  const fullSize = getOutputSize(state.source.image, state.settings.edit);
  const limited = limitExportSize(fullSize);
  const maxDimension = Math.max(limited.width, limited.height);
  const geometry = renderGeometry(state.source.image, state.settings.edit, maxDimension);
  return { geometry, limited, fullSize };
}

function prepareJpeg(canvas) {
  return fillBackground(canvas, "#000000");
}

export async function buildExport({ state, format, quality = 0.92, onProgress = () => {} }) {
  const info = formatInfo(format);
  if (!info) throw new Error("Choose a supported export format.");
  if (!state?.source?.image) throw new Error("Open an image before exporting.");
  if (VECTOR_FORMATS.some((item) => item.id === format) && state.mode !== "ascii") {
    throw new Error("TXT and SVG exports are available in ASCII mode.");
  }
  if (state.mode === "grain" && !["png", "jpeg", "webp"].includes(format)) {
    throw new Error("Grain Lab can export PNG, JPG, or WEBP.");
  }

  onProgress("Preparing output from the original source…");
  await tick();
  const { geometry, limited, fullSize } = resolveExportGeometry(state);

  onProgress("Applying shared image adjustments…");
  await tick();
  const adjusted = applyAdjustments(geometry, state.settings.edit);

  let resultCanvas = adjusted;
  let asciiGrid = null;
  let asciiMeta = null;
  let engine = null;
  let blob = null;

  if (state.mode === "ascii") {
    onProgress("Generating the ASCII grid…");
    await tick();
    asciiGrid = generateAsciiGrid(adjusted, state.settings.ascii);
    if (format === "txt") {
      blob = new Blob([gridToText(asciiGrid)], { type: "text/plain;charset=utf-8" });
    } else if (format === "svg") {
      asciiMeta = renderAsciiCanvas(asciiGrid, state.settings.ascii, { targetWidth: adjusted.width });
      const svg = buildAsciiSvg(asciiGrid, state.settings.ascii, asciiMeta);
      blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    } else {
      asciiMeta = renderAsciiCanvas(asciiGrid, state.settings.ascii, { targetWidth: adjusted.width });
      resultCanvas = asciiMeta.canvas;
    }
  } else if (state.mode === "pixel") {
    onProgress("Reconstructing pixel art…");
    await tick();
    const pixel = pixelateCanvas(adjusted, state.settings.pixel, {
      targetWidth: adjusted.width,
      referenceWidth: fullSize.width,
    });
    resultCanvas = pixel.canvas;
  } else if (state.mode === "grain") {
    onProgress("Rendering the WebGL film pipeline…");
    await tick();
    try {
      const canvas = createCanvas(adjusted.width, adjusted.height);
      engine = new GrainLabEngine(canvas);
      engine.render(adjusted, state.settings.grain, {
        width: adjusted.width,
        height: adjusted.height,
        sourceKey: `export-${Date.now()}`,
        time: 24,
      });
      resultCanvas = canvas;
    } catch {
      resultCanvas = renderGrainFallback(adjusted, state.settings.grain, adjusted.width, adjusted.height);
    }
  }

  if (["png", "jpeg", "webp"].includes(format)) {
    onProgress(`Encoding ${info.label}…`);
    await tick();
    const output = format === "jpeg" ? prepareJpeg(resultCanvas) : resultCanvas;
    const mime = info.mime;
    blob = await canvasToBlob(output, mime, format === "png" ? undefined : quality);
    if (!blob) throw new Error("The browser could not encode this image.");
    if (format === "webp" && blob.type !== "image/webp") {
      throw new Error("WEBP export is not supported by this browser.");
    }
  }

  engine?.dispose();
  if (!blob || blob.size === 0) throw new Error("The export generated an empty file.");

  return {
    blob,
    filename: exportFilename(state, format),
    format,
    mime: info.mime,
    width: resultCanvas?.width || fullSize.width,
    height: resultCanvas?.height || fullSize.height,
    scale: limited.scale,
    originalWidth: fullSize.width,
    originalHeight: fullSize.height,
    asciiGrid,
    asciiMeta,
    mode: state.mode,
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function formatsForMode(mode) {
  if (mode === "ascii") return [...IMAGE_FORMATS, ...VECTOR_FORMATS];
  return [...IMAGE_FORMATS];
}
