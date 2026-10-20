import { LIMITS, clamp } from "./state.js";

export function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function sourceSize(source) {
  if (!source) return { width: 0, height: 0 };
  return {
    width: source.naturalWidth || source.width || 0,
    height: source.naturalHeight || source.height || 0,
  };
}

export function normalizeCrop(crop, source) {
  const { width, height } = sourceSize(source);
  if (!width || !height) return { x: 0, y: 0, w: 1, h: 1 };
  const fallback = { x: 0, y: 0, w: 1, h: 1 };
  const input = crop && typeof crop === "object" ? crop : fallback;
  let x = clamp(Number(input.x) || 0, 0, 0.98);
  let y = clamp(Number(input.y) || 0, 0, 0.98);
  let w = clamp(Number(input.w) || 1, 0.02, 1 - x);
  let h = clamp(Number(input.h) || 1, 0.02, 1 - y);
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}

export function getOutputSize(source, editSettings, maxDimension = Infinity) {
  const { width, height } = sourceSize(source);
  const crop = normalizeCrop(editSettings?.crop, source);
  const rotation = ((Math.round((editSettings?.rotation || 0) / 90) * 90) % 360 + 360) % 360;
  const rotated = rotation === 90 || rotation === 270;
  // Crop coordinates are expressed in the displayed, post-rotation image.
  // Keeping them there means Crop X/Y always move in preview space, even
  // after a 90-degree rotation.
  const orientedW = rotated ? height : width;
  const orientedH = rotated ? width : height;
  const sourceW = Math.max(1, orientedW * crop.w);
  const sourceH = Math.max(1, orientedH * crop.h);
  const longest = Math.max(sourceW, sourceH);
  const scale = Number.isFinite(maxDimension) && maxDimension > 0
    ? Math.min(1, maxDimension / longest)
    : 1;
  return {
    width: Math.max(1, Math.round(sourceW * scale)),
    height: Math.max(1, Math.round(sourceH * scale)),
    sourceWidth: sourceW,
    sourceHeight: sourceH,
    orientedWidth: orientedW,
    orientedHeight: orientedH,
    scale,
    crop,
    rotation,
  };
}

export function renderGeometry(source, editSettings, maxDimension = Infinity) {
  const size = getOutputSize(source, editSettings, maxDimension);
  const output = createCanvas(size.width, size.height);
  const ctx = output.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");

  const { width: naturalWidth, height: naturalHeight } = sourceSize(source);
  const { crop, rotation, orientedWidth, orientedHeight, scale } = size;

  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-crop.x * orientedWidth, -crop.y * orientedHeight);
  ctx.translate(orientedWidth / 2, orientedHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(editSettings?.flipH ? -1 : 1, editSettings?.flipV ? -1 : 1);
  ctx.drawImage(source, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight);
  ctx.restore();
  return output;
}

export function cloneCanvas(canvas, contextOptions = undefined) {
  const output = createCanvas(canvas.width, canvas.height);
  const ctx = contextOptions
    ? output.getContext("2d", contextOptions)
    : output.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
  ctx.drawImage(canvas, 0, 0);
  return output;
}

export function resizeCanvas(canvas, width, height, smoothing = true) {
  const output = createCanvas(width, height);
  const ctx = output.getContext("2d");
  ctx.imageSmoothingEnabled = smoothing;
  ctx.imageSmoothingQuality = smoothing ? "high" : "low";
  ctx.drawImage(canvas, 0, 0, output.width, output.height);
  return output;
}

function contrastFactor(value) {
  const amount = clamp(Number(value) || 0, -100, 100);
  return (259 * (amount + 255)) / (255 * (259 - amount));
}

function applySharpen(data, width, height, amount) {
  if (amount <= 0) return data;
  const source = new Uint8ClampedArray(data);
  const strength = (amount / 100) * 1.35;
  const center = 1 + strength * 4;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = (row + x) * 4;
      const up = ((y - 1) * width + x) * 4;
      const down = ((y + 1) * width + x) * 4;
      const left = (row + x - 1) * 4;
      const right = (row + x + 1) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[index + channel] = source[index + channel] * center
          - source[up + channel] * strength
          - source[down + channel] * strength
          - source[left + channel] * strength
          - source[right + channel] * strength;
      }
    }
  }
  return data;
}

export function applyAdjustments(geometryCanvas, editSettings) {
  const output = cloneCanvas(geometryCanvas, { willReadFrequently: true });
  const ctx = output.getContext("2d", { willReadFrequently: true });
  if (!ctx) return output;

  const width = output.width;
  const height = output.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const exposure = 2 ** clamp(Number(editSettings?.exposure) || 0, -2, 2);
  const brightness = clamp(Number(editSettings?.brightness) || 0, -100, 100) * 1.8;
  const contrast = contrastFactor(editSettings?.contrast);
  const saturation = 1 + clamp(Number(editSettings?.saturation) || 0, -100, 100) / 100;
  const temperature = clamp(Number(editSettings?.temperature) || 0, -100, 100) / 100;
  const tint = clamp(Number(editSettings?.tint) || 0, -100, 100) / 100;
  const highlights = clamp(Number(editSettings?.highlights) || 0, -100, 100) / 100;
  const shadows = clamp(Number(editSettings?.shadows) || 0, -100, 100) / 100;
  const fade = clamp(Number(editSettings?.fade) || 0, 0, 100) / 100;
  const vignette = clamp(Number(editSettings?.vignette) || 0, 0, 100) / 100;
  const sharpening = clamp(Number(editSettings?.sharpening) || 0, 0, 100);
  const invWidth = width > 1 ? 1 / (width - 1) : 0;
  const invHeight = height > 1 ? 1 / (height - 1) : 0;

  for (let y = 0; y < height; y += 1) {
    const py = y * invHeight;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let r = data[index];
      let g = data[index + 1];
      let b = data[index + 2];

      r *= exposure;
      g *= exposure;
      b *= exposure;

      r += brightness;
      g += brightness;
      b += brightness;

      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;

      if (temperature || tint) {
        const warm = temperature * 38;
        const green = tint * 30;
        r += warm;
        b -= warm;
        g += green;
        r -= green * 0.22;
        b -= green * 0.22;
      }

      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (highlights && luminance > 0.5) {
        const delta = highlights * (luminance - 0.5) * 2 * 62;
        r += delta;
        g += delta;
        b += delta;
      }
      if (shadows && luminance < 0.5) {
        const delta = shadows * (1 - luminance * 2) * 62;
        r += delta;
        g += delta;
        b += delta;
      }

      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;

      if (fade) {
        const lift = fade * 42;
        const compression = 1 - fade * 0.28;
        r = r * compression + lift;
        g = g * compression + lift;
        b = b * compression + lift;
      }

      if (vignette) {
        const dx = (x * invWidth - 0.5) * 2;
        const dy = (py - 0.5) * 2;
        const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.4142);
        const factor = clamp(1 - vignette * distance * distance * 1.45, 0.05, 1);
        r *= factor;
        g *= factor;
        b *= factor;
      }

      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
    }
  }

  if (sharpening > 0) applySharpen(data, width, height, sharpening);
  ctx.putImageData(imageData, 0, 0);
  return output;
}

export function fitDimensions(width, height, maxWidth, maxHeight) {
  if (!width || !height) return { width: 1, height: 1, scale: 1 };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export function limitExportSize(size) {
  const pixels = size.width * size.height;
  const pixelScale = pixels > LIMITS.MAX_EXPORT_PIXELS
    ? Math.sqrt(LIMITS.MAX_EXPORT_PIXELS / pixels)
    : 1;
  const dimensionScale = Math.max(size.width, size.height) > LIMITS.MAX_EXPORT_DIMENSION
    ? LIMITS.MAX_EXPORT_DIMENSION / Math.max(size.width, size.height)
    : 1;
  const scale = Math.min(1, pixelScale, dimensionScale);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    scale,
  };
}

export function applyFinishGrain(canvas, amount = 0) {
  const strength = clamp(Number(amount) || 0, 0, 100);
  if (strength <= 0) return canvas;

  const output = cloneCanvas(canvas, { willReadFrequently: true });
  const ctx = output.getContext("2d", { willReadFrequently: true });
  if (!ctx) return output;
  const imageData = ctx.getImageData(0, 0, output.width, output.height);
  const data = imageData.data;
  const noiseScale = (strength / 100) * 68;
  let seed = 0x9e3779b9 ^ (output.width * 73856093) ^ (output.height * 19349663);

  for (let index = 0; index < data.length; index += 4) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = (((seed >>> 0) / 4294967295) - 0.5) * noiseScale;
    data[index] = data[index] + noise;
    data[index + 1] = data[index + 1] + noise;
    data[index + 2] = data[index + 2] + noise;
  }

  ctx.putImageData(imageData, 0, 0);
  return output;
}

export function fillBackground(canvas, color) {
  const output = cloneCanvas(canvas);
  const ctx = output.getContext("2d");
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.globalCompositeOperation = "source-over";
  return output;
}

export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser returned an empty image."));
      }, type, quality);
    } catch {
      reject(new Error("The canvas could not be encoded by this browser."));
    }
  });
}
