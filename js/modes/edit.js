import { DEFAULT_EDIT, EDIT_PRESETS, clamp, deepClone } from "../state.js";

export { EDIT_PRESETS };

export function applyEditPreset(editSettings, presetId) {
  const preset = EDIT_PRESETS.find((item) => item.id === presetId);
  if (!preset) return deepClone(editSettings);
  return {
    ...deepClone(DEFAULT_EDIT),
    ...deepClone(preset.settings),
    crop: deepClone(editSettings.crop || DEFAULT_EDIT.crop),
    rotation: editSettings.rotation || 0,
    flipH: Boolean(editSettings.flipH),
    flipV: Boolean(editSettings.flipV),
  };
}

export function rotateCrop(editSettings, direction = 90) {
  const rotation = ((Math.round((editSettings.rotation || 0) / 90) * 90 + direction) % 360 + 360) % 360;
  const crop = editSettings.crop || { x: 0, y: 0, w: 1, h: 1 };
  let nextCrop;
  if (direction === 90) {
    nextCrop = { x: 1 - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w };
  } else if (direction === 270 || direction === -90) {
    nextCrop = { x: crop.y, y: 1 - crop.x - crop.w, w: crop.h, h: crop.w };
  } else {
    nextCrop = { x: 1 - crop.x - crop.w, y: 1 - crop.y - crop.h, w: crop.w, h: crop.h };
  }
  return {
    ...editSettings,
    rotation,
    crop: {
      x: clamp(nextCrop.x, 0, 1),
      y: clamp(nextCrop.y, 0, 1),
      w: clamp(nextCrop.w, 0.02, 1),
      h: clamp(nextCrop.h, 0.02, 1),
    },
  };
}

export function setCropRatio(editSettings, ratio, source) {
  if (!source?.width || !source?.height) return deepClone(editSettings);
  if (!ratio) {
    return { ...deepClone(editSettings), crop: { x: 0, y: 0, w: 1, h: 1 } };
  }
  const imageRatio = source.width / source.height;
  const rotation = ((Math.round((editSettings.rotation || 0) / 90) * 90) % 360 + 360) % 360;
  // A 90/270-degree rotation swaps the output axes, so the crop fraction
  // needed to produce the requested final ratio is the reciprocal.
  const cropRatio = rotation === 90 || rotation === 270 ? 1 / ratio : ratio;
  let w;
  let h;
  if (imageRatio > cropRatio) {
    h = 1;
    w = (cropRatio * source.height) / source.width;
  } else {
    w = 1;
    h = source.width / cropRatio / source.height;
  }
  w = clamp(w, 0.02, 1);
  h = clamp(h, 0.02, 1);
  return {
    ...deepClone(editSettings),
    crop: {
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      w,
      h,
    },
  };
}

export function updateNested(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
  return target;
}

export function readNested(target, path, fallback = 0) {
  const parts = String(path).split(".");
  let cursor = target;
  for (const key of parts) {
    if (cursor == null) return fallback;
    cursor = cursor[key];
  }
  return cursor ?? fallback;
}

export const EDIT_GROUPS = Object.freeze([
  {
    id: "light",
    label: "Light",
    open: true,
    controls: [
      { type: "range", key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05, digits: 2, default: 0 },
      { type: "range", key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "highlights", label: "Highlights", min: -100, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "shadows", label: "Shadows", min: -100, max: 100, step: 1, digits: 0, default: 0 },
    ],
  },
  {
    id: "color",
    label: "Color",
    open: true,
    controls: [
      { type: "range", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "temperature", label: "Temperature", min: -100, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "tint", label: "Tint", min: -100, max: 100, step: 1, digits: 0, default: 0 },
    ],
  },
  {
    id: "detail",
    label: "Detail & Finish",
    open: true,
    controls: [
      { type: "range", key: "sharpening", label: "Sharpening", min: 0, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "fade", label: "Fade", min: 0, max: 100, step: 1, digits: 0, default: 0 },
      { type: "range", key: "vignette", label: "Vignette", min: 0, max: 100, step: 1, digits: 0, default: 0 },
    ],
  },
  {
    id: "geometry",
    label: "Crop & Geometry",
    open: false,
    controls: [
      {
        type: "button-row",
        label: "Aspect ratio",
        actions: [
          { id: "crop-free", label: "Free" },
          { id: "crop-1-1", label: "1:1" },
          { id: "crop-4-3", label: "4:3" },
          { id: "crop-3-2", label: "3:2" },
          { id: "crop-16-9", label: "16:9" },
          { id: "crop-9-16", label: "9:16" },
        ],
      },
      { type: "range", key: "crop.x", label: "Crop X", min: 0, max: 0.98, step: 0.01, digits: 0, percent: true, default: 0 },
      { type: "range", key: "crop.y", label: "Crop Y", min: 0, max: 0.98, step: 0.01, digits: 0, percent: true, default: 0 },
      { type: "range", key: "crop.w", label: "Crop Width", min: 0.02, max: 1, step: 0.01, digits: 0, percent: true, default: 1 },
      { type: "range", key: "crop.h", label: "Crop Height", min: 0.02, max: 1, step: 0.01, digits: 0, percent: true, default: 1 },
      {
        type: "button-row",
        label: "Rotate",
        actions: [
          { id: "rotate-90", label: "90° CW" },
          { id: "rotate-270", label: "90° CCW" },
          { id: "rotate-180", label: "180°" },
        ],
      },
      { type: "toggle", key: "flipH", label: "Flip horizontally", default: false },
      { type: "toggle", key: "flipV", label: "Flip vertically", default: false },
    ],
  },
]);
