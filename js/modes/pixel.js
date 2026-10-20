import {
  PIXEL_PALETTES,
  PIXEL_PALETTE_IDS,
  clamp,
} from "../state.js";
import { applyFinishGrain, createCanvas } from "../image-pipeline.js";

export { PIXEL_PALETTES, PIXEL_PALETTE_IDS };

const BAYER = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((value) => value / 16 - 0.5);

const CUSTOM_FALLBACK = ["#1a1c2c", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#41a6f6", "#f4f4f4"];

function parseHex(value, fallback = "#000000") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;
}

function hexToRgb(hex) {
  const value = parseHex(hex);
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function samplePalette(colors, size) {
  const target = Math.max(2, Math.min(colors.length, Math.round(size)));
  if (target >= colors.length) return colors;
  const output = [];
  for (let index = 0; index < target; index += 1) {
    output.push(colors[Math.floor((index * colors.length) / target)]);
  }
  return output;
}

export function resolvePalette(settings) {
  let colors;
  if (settings.palette === "custom") {
    const parsed = String(settings.customColors || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^#[0-9a-f]{6}$/i.test(value));
    colors = parsed.length >= 2 ? parsed.map((value) => parseHex(value)) : CUSTOM_FALLBACK;
  } else {
    const palette = PIXEL_PALETTES.find((item) => item.id === settings.palette);
    colors = palette?.colors?.length ? palette.colors : PIXEL_PALETTES[0].colors;
  }
  return samplePalette(colors, settings.paletteSize).map(hexToRgb);
}

function nearestColor(r, g, b, palette) {
  let best = palette[0];
  let bestDistance = Infinity;
  for (const color of palette) {
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best;
}

function edgeMap(data, width, height) {
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
  }
  const edges = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = -gray[index - width - 1] + gray[index - width + 1]
        - 2 * gray[index - 1] + 2 * gray[index + 1]
        - gray[index + width - 1] + gray[index + width + 1];
      const gy = -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1]
        + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1];
      edges[index] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 720);
    }
  }
  return edges;
}

export function pixelateCanvas(sourceCanvas, settings, {
  targetWidth = sourceCanvas.width,
  referenceWidth = sourceCanvas.width,
} = {}) {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const scaleToReference = referenceWidth > 0 ? sourceWidth / referenceWidth : 1;
  const effectiveBlock = Math.max(1, settings.blockSize * scaleToReference);
  const smallWidth = Math.max(1, Math.round(sourceWidth / effectiveBlock));
  const smallHeight = Math.max(1, Math.round(smallWidth * (sourceHeight / sourceWidth)));

  const small = createCanvas(smallWidth, smallHeight);
  const smallCtx = small.getContext("2d", { willReadFrequently: true });
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(sourceCanvas, 0, 0, smallWidth, smallHeight);

  const imageData = smallCtx.getImageData(0, 0, smallWidth, smallHeight);
  const data = imageData.data;
  const palette = resolvePalette(settings);
  const dither = clamp(Number(settings.dither) || 0, 0, 1) * 72;
  const contrast = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast));
  const brightness = settings.brightness * 2.1;
  const edges = settings.edgePreserve ? edgeMap(data, smallWidth, smallHeight) : null;

  for (let y = 0; y < smallHeight; y += 1) {
    for (let x = 0; x < smallWidth; x += 1) {
      const index = y * smallWidth + x;
      const offset = index * 4;
      const alpha = data[offset + 3];
      let r = (data[offset] - 128) * contrast + 128 + brightness;
      let g = (data[offset + 1] - 128) * contrast + 128 + brightness;
      let b = (data[offset + 2] - 128) * contrast + 128 + brightness;

      const edge = edges ? edges[index] : 0;
      const ditherScale = dither * (1 - edge * 0.85);
      const threshold = BAYER[(y % 4) * 4 + (x % 4)] * ditherScale;
      r = clamp(r + threshold, 0, 255);
      g = clamp(g + threshold, 0, 255);
      b = clamp(b + threshold, 0, 255);

      const color = nearestColor(r, g, b, palette);
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = settings.transparent ? (alpha < 20 ? 0 : alpha) : 255;
    }
  }
  smallCtx.putImageData(imageData, 0, 0);

  const outputWidth = Math.max(1, Math.round(targetWidth));
  const outputHeight = Math.max(1, Math.round(outputWidth * (sourceHeight / sourceWidth)));
  const output = createCanvas(outputWidth, outputHeight);
  const ctx = output.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, outputWidth, outputHeight);
  ctx.drawImage(small, 0, 0, outputWidth, outputHeight);

  if (settings.gridOverlay) {
    const cell = outputWidth / smallWidth;
    if (cell >= 3) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.13)";
      ctx.lineWidth = 1;
      for (let x = 1; x < smallWidth; x += 1) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x * cell) + 0.5, 0);
        ctx.lineTo(Math.round(x * cell) + 0.5, outputHeight);
        ctx.stroke();
      }
      for (let y = 1; y < smallHeight; y += 1) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y * cell) + 0.5);
        ctx.lineTo(outputWidth, Math.round(y * cell) + 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  const result = settings.grainFinish > 0 ? applyFinishGrain(output, settings.grainFinish) : output;
  return {
    canvas: result,
    width: result.width,
    height: result.height,
    smallWidth,
    smallHeight,
    blockScale: outputWidth / smallWidth,
    paletteSize: palette.length,
  };
}

export const PIXEL_GROUPS = Object.freeze([
  {
    id: "pixels",
    label: "Pixel Geometry",
    open: true,
    controls: [
      { type: "range", key: "blockSize", label: "Pixel Block", min: 1, max: 48, step: 1, digits: 0, suffix: " px", default: 8 },
      { type: "range", key: "paletteSize", label: "Palette Size", min: 2, max: 32, step: 1, digits: 0, default: 16 },
      {
        type: "select",
        key: "palette",
        label: "Palette",
        options: PIXEL_PALETTES.map((palette) => ({ value: palette.id, label: palette.label })),
        default: "classic8",
      },
      { type: "text", key: "customColors", label: "Custom Colors", placeholder: "#1a1c2c,#b13e53,#ffcd75", default: "" },
      { type: "range", key: "dither", label: "Dithering", min: 0, max: 1, step: 0.01, digits: 2, default: 0.35 },
    ],
  },
  {
    id: "tone",
    label: "Tone & Edges",
    open: true,
    controls: [
      { type: "range", key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, digits: 0, default: 0 },
      { type: "toggle", key: "edgePreserve", label: "Preserve edges", default: true },
      { type: "toggle", key: "gridOverlay", label: "Pixel grid overlay", default: false },
      { type: "toggle", key: "transparent", label: "Keep transparency", default: false },
      { type: "range", key: "grainFinish", label: "Grain finish", min: 0, max: 100, step: 1, digits: 0, default: 0 },
    ],
  },
]);
