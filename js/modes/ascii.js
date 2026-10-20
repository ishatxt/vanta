import {
  ASCII_CHARSETS,
  ASCII_COLOR_MODES,
  LIMITS,
  clamp,
  getFont,
} from "../state.js";
import { applyFinishGrain, createCanvas } from "../image-pipeline.js";

const TERMINAL_SHADES = ["#00ff94", "#00d16e", "#009d4f", "#006934", "#003d1f"];
const AMBER_SHADES = ["#ffe0a3", "#ffc46b", "#e39a2e", "#a76812", "#6f4306"];

export { ASCII_CHARSETS, ASCII_COLOR_MODES };

function hexToRgb(hex, fallback = "#000000") {
  const value = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : fallback;
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const channel = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixRgb(start, end, amount) {
  const t = clamp(amount, 0, 1);
  return {
    r: start.r + (end.r - start.r) * t,
    g: start.g + (end.g - start.g) * t,
    b: start.b + (end.b - start.b) * t,
  };
}

function shadeFor(tone, shades) {
  const index = Math.min(shades.length - 1, Math.max(0, Math.floor((tone / 255) * shades.length)));
  return shades[index];
}

function fontSpec(settings, size) {
  const weight = settings.bold ? 700 : 400;
  return `${weight} ${size}px ${getFont(settings.font).stack}`;
}

function measureCharWidth(context, settings, size) {
  context.font = fontSpec(settings, size);
  const characters = new Set(["M", "W", "█", ...Array.from(settings.charset || " ")]);
  let width = context.measureText("M").width || size * 0.6;
  for (const character of characters) {
    width = Math.max(width, context.measureText(character).width);
  }
  return Math.max(0.1, Math.ceil(width * 100) / 100);
}

export function getAsciiCellAspect(settings) {
  if (typeof document === "undefined") return 0.6;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0.6;
  const size = 32;
  return measureCharWidth(ctx, settings, size) / size;
}

export function resolveGridDimensions(width, height, requestedColumns, cellAspect) {
  const aspect = clamp(Number(cellAspect) || 0.6, 0.1, 4);
  let columns = Math.round(clamp(Number(requestedColumns) || 140, 16, LIMITS.MAX_GRID_COLS));
  let rows = Math.max(1, Math.round(columns * (height / width) * aspect));

  const balanced = Math.max(1, Math.round(rows * (width / height) / aspect));
  if (balanced <= LIMITS.MAX_GRID_COLS) columns = balanced;

  for (let guard = 0; guard < 80; guard += 1) {
    rows = Math.max(1, Math.round(columns * (height / width) * aspect));
    if (rows <= LIMITS.MAX_GRID_ROWS && columns * rows <= LIMITS.MAX_GRID_CELLS) break;
    columns = Math.max(16, Math.floor(columns * 0.92));
  }

  return {
    cols: Math.max(1, Math.min(columns, width)),
    rows: Math.max(1, Math.min(rows, height, LIMITS.MAX_GRID_ROWS)),
    cellAspect: aspect,
  };
}

export function generateAsciiGrid(sourceCanvas, settings) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas pixels are unavailable.");
  const data = ctx.getImageData(0, 0, width, height).data;
  const cellAspect = getAsciiCellAspect(settings);
  const { cols, rows } = resolveGridDimensions(width, height, settings.columns, cellAspect);
  const characters = Array.from(settings.charset || " ");
  const mappedCharacters = settings.invert ? characters.slice().reverse() : characters;
  const count = mappedCharacters.length;
  const chars = new Array(cols * rows);
  const colors = new Array(cols * rows);
  const startRgb = hexToRgb(settings.customStart, "#00ff9d");
  const endRgb = hexToRgb(settings.customEnd, "#f5f7ff");
  const contrastFactor = settings.contrast >= 0
    ? 1 + (settings.contrast / 100) * 1.8
    : 1 + (settings.contrast / 100) * 0.8;
  const brightnessOffset = (settings.brightness / 100) * 255;

  const columnEdges = new Array(cols + 1);
  for (let col = 0; col <= cols; col += 1) columnEdges[col] = Math.floor((col * width) / cols);
  const rowEdges = new Array(rows + 1);
  for (let row = 0; row <= rows; row += 1) rowEdges[row] = Math.floor((row * height) / rows);

  let nonSpace = 0;
  for (let row = 0; row < rows; row += 1) {
    const yStart = rowEdges[row];
    const yEnd = Math.max(yStart + 1, rowEdges[row + 1]);
    for (let col = 0; col < cols; col += 1) {
      const xStart = columnEdges[col];
      const xEnd = Math.max(xStart + 1, columnEdges[col + 1]);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let samples = 0;

      for (let y = yStart; y < yEnd; y += 1) {
        let pixel = (y * width + xStart) * 4;
        for (let x = xStart; x < xEnd; x += 1) {
          r += data[pixel];
          g += data[pixel + 1];
          b += data[pixel + 2];
          a += data[pixel + 3];
          samples += 1;
          pixel += 4;
        }
      }

      const index = row * cols + col;
      if (!samples) {
        chars[index] = " ";
        colors[index] = settings.fgColor;
        continue;
      }

      r /= samples;
      g /= samples;
      b /= samples;
      a /= samples;
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const tone = clamp((gray - 128) * contrastFactor + 128 + brightnessOffset, 0, 255);

      let character = " ";
      if (a >= 12) {
        const characterIndex = clamp(Math.floor((tone / 255) * (count - 1)), 0, count - 1);
        character = mappedCharacters[characterIndex] || " ";
      }
      chars[index] = character;
      if (character !== " " && character !== "\u00a0") nonSpace += 1;

      switch (settings.colorMode) {
        case "source":
          colors[index] = rgbToHex({ r, g, b });
          break;
        case "terminal":
          colors[index] = shadeFor(tone, TERMINAL_SHADES);
          break;
        case "amber":
          colors[index] = shadeFor(tone, AMBER_SHADES);
          break;
        case "custom":
          colors[index] = rgbToHex(mixRgb(startRgb, endRgb, tone / 255));
          break;
        default:
          colors[index] = settings.fgColor;
      }
    }
  }

  return {
    cols,
    rows,
    chars,
    colors,
    flatColor: settings.colorMode === "mono" ? settings.fgColor : null,
    cellAspect,
    settings: { ...settings },
    sourceWidth: width,
    sourceHeight: height,
    nonSpace,
  };
}

export function gridToRows(grid) {
  const rows = new Array(grid.rows);
  for (let row = 0; row < grid.rows; row += 1) {
    const start = row * grid.cols;
    rows[row] = grid.chars.slice(start, start + grid.cols).join("");
  }
  return rows;
}

export function gridToText(grid) {
  return gridToRows(grid).join("\n");
}

function colorAt(grid, index) {
  return grid.flatColor || grid.colors[index] || grid.settings.fgColor;
}

export function renderAsciiCanvas(grid, settings, { targetWidth = 1200 } = {}) {
  const canvas = document.createElement("canvas");
  const scratch = canvas.getContext("2d");
  if (!scratch) throw new Error("Canvas 2D is unavailable.");

  const referenceSize = 32;
  const referenceWidth = measureCharWidth(scratch, settings, referenceSize);
  const aspect = referenceWidth / referenceSize;
  const sourceAspect = grid.cols / grid.rows;
  const requestedWidth = Math.max(grid.cols, Number(targetWidth) || 1200);
  const targetCellWidth = requestedWidth / grid.cols;
  const fontSize = clamp(targetCellWidth / aspect, 1, 512);
  const spec = fontSpec(settings, fontSize);
  scratch.font = spec;
  const charWidth = measureCharWidth(scratch, settings, fontSize);
  const lineHeight = fontSize;
  const width = Math.max(1, Math.ceil(grid.cols * charWidth));
  const height = Math.max(1, Math.ceil(grid.rows * lineHeight));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = settings.bgColor;
  ctx.fillRect(0, 0, width, height);
  ctx.font = spec;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  if (grid.flatColor) {
    ctx.fillStyle = grid.flatColor;
    for (let row = 0; row < grid.rows; row += 1) {
      const line = grid.chars.slice(row * grid.cols, (row + 1) * grid.cols).join("");
      if (line.trim()) ctx.fillText(line, 0, row * lineHeight);
    }
  } else {
    for (let row = 0; row < grid.rows; row += 1) {
      const start = row * grid.cols;
      const y = row * lineHeight;
      let run = "";
      let runStart = 0;
      let color = "";
      const flush = () => {
        if (run) {
          ctx.fillStyle = color;
          ctx.fillText(run, runStart * charWidth, y);
        }
        run = "";
      };
      for (let col = 0; col < grid.cols; col += 1) {
        const character = grid.chars[start + col];
        if (character === " " || character === "\u00a0") {
          flush();
          continue;
        }
        const nextColor = colorAt(grid, start + col);
        if (!run) {
          runStart = col;
          color = nextColor;
        } else if (nextColor !== color) {
          flush();
          runStart = col;
          color = nextColor;
        }
        run += character;
      }
      flush();
    }
  }

  let output = canvas;
  if (settings.grainFinish > 0) {
    output = applyFinishGrain(canvas, settings.grainFinish);
  }

  return {
    canvas: output,
    width: output.width,
    height: output.height,
    fontSize,
    charWidth,
    lineHeight,
    cellAspect: aspect,
    text: gridToText(grid),
    grid,
    sourceAspect,
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildAsciiSvg(grid, settings, meta) {
  const fontSize = meta.fontSize || 16;
  const charWidth = meta.charWidth || fontSize * 0.6;
  const lineHeight = meta.lineHeight || fontSize;
  const width = Math.ceil(grid.cols * charWidth);
  const height = Math.ceil(grid.rows * lineHeight);
  const textWidth = grid.cols * charWidth;
  const baseline = fontSize * 0.82;
  const font = escapeXml(getFont(settings.font).stack);
  const weight = settings.bold ? 700 : 400;
  const rows = [];

  for (let row = 0; row < grid.rows; row += 1) {
    const runs = [];
    let current = null;
    const start = row * grid.cols;
    for (let col = 0; col < grid.cols; col += 1) {
      const character = grid.chars[start + col];
      const color = colorAt(grid, start + col);
      if (!current || current.color !== color) {
        current = { color, text: "" };
        runs.push(current);
      }
      current.text += character;
    }
    if (!runs.map((run) => run.text).join("").trim()) continue;
    const y = (row * lineHeight + baseline).toFixed(2);
    if (runs.length === 1) {
      rows.push(`<text x="0" y="${y}" textLength="${textWidth.toFixed(2)}" lengthAdjust="spacing" xml:space="preserve" fill="${escapeXml(runs[0].color)}">${escapeXml(runs[0].text)}</text>`);
    } else {
      const spans = runs.map((run) => `<tspan fill="${escapeXml(run.color)}">${escapeXml(run.text)}</tspan>`).join("");
      rows.push(`<text x="0" y="${y}" textLength="${textWidth.toFixed(2)}" lengthAdjust="spacing" xml:space="preserve">${spans}</text>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="ASCII art generated by VANTA">
  <title>VANTA ASCII Artwork</title>
  <desc>${grid.cols} columns by ${grid.rows} rows.</desc>
  <style>text{font-family:${font};font-size:${fontSize}px;font-weight:${weight};white-space:pre;font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0;}</style>
  <rect width="100%" height="100%" fill="${escapeXml(settings.bgColor)}"/>
  ${rows.join("\n  ")}
</svg>
`;
}
