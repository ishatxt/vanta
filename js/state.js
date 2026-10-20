export const APP_VERSION = "4.0.0";

export const MODES = Object.freeze([
  {
    id: "edit",
    label: "Edit",
    short: "EDIT",
    description: "Non-destructive photo adjustments, crop, rotate, and film looks.",
  },
  {
    id: "ascii",
    label: "ASCII",
    short: "ASCII",
    description: "Convert the shared image into a font-aware character grid.",
  },
  {
    id: "pixel",
    label: "Pixel",
    short: "PIXEL",
    description: "Downsample, quantize, dither, and reconstruct crisp pixel art.",
  },
  {
    id: "grain",
    label: "Grain Lab",
    short: "GRAIN",
    description: "WebGL film grain, halftone, bloom, aberration, and film finishing.",
  },
]);

export const MODE_IDS = Object.freeze(MODES.map((mode) => mode.id));

export const LIMITS = Object.freeze({
  MAX_FILE_BYTES: 60 * 1024 * 1024,
  MAX_SOURCE_DIMENSION: 12000,
  MAX_SOURCE_PIXELS: 80_000_000,
  PREVIEW_MAX_DIMENSION: 1600,
  MAX_EXPORT_PIXELS: 36_000_000,
  MAX_EXPORT_DIMENSION: 7000,
  MAX_GRID_COLS: 360,
  MAX_GRID_ROWS: 480,
  MAX_GRID_CELLS: 80_000,
  MAX_HISTORY: 60,
  MAX_PRESET_FILE_BYTES: 512 * 1024,
  MAX_SAVED_PRESETS: 80,
});

export const PREVIEW_MAX_DIMENSION = LIMITS.PREVIEW_MAX_DIMENSION;

export const FONTS = Object.freeze([
  {
    id: "JetBrains Mono",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", "Cascadia Code", "Courier New", monospace',
  },
  {
    id: "Courier New",
    label: "Courier New",
    stack: '"Courier New", Courier, monospace',
  },
  {
    id: "Lucida Console",
    label: "Lucida Console",
    stack: '"Lucida Console", Monaco, monospace',
  },
  {
    id: "monospace",
    label: "System Monospace",
    stack: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  },
]);

export const FONT_IDS = Object.freeze(FONTS.map((font) => font.id));

export const DEFAULT_EDIT = Object.freeze({
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  sharpening: 0,
  fade: 0,
  vignette: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  rotation: 0,
  flipH: false,
  flipV: false,
});

export const DEFAULT_ASCII = Object.freeze({
  charset: "@#S%?*+;:,. ",
  charsetPreset: "classic",
  columns: 140,
  brightness: 0,
  contrast: 0,
  invert: false,
  colorMode: "mono",
  fgColor: "#e9eff7",
  bgColor: "#050607",
  customStart: "#00ff9d",
  customEnd: "#f5f7ff",
  font: "JetBrains Mono",
  bold: false,
  grainFinish: 0,
});

export const DEFAULT_PIXEL = Object.freeze({
  blockSize: 8,
  palette: "classic8",
  paletteSize: 16,
  customColors: "#1a1c2c,#5d275d,#b13e53,#ef7d57,#ffcd75,#a7f070,#38b764,#257179",
  dither: 0.35,
  gridOverlay: false,
  brightness: 0,
  contrast: 0,
  edgePreserve: true,
  transparent: false,
  grainFinish: 0,
});

export const DEFAULT_GRAIN = Object.freeze({
  grainIntensity: 0.12,
  grainSize: 0.003,
  ditherLevels: 8,
  ditherStrength: 0,
  halftoneSize: 0.002,
  halftoneContrast: 1.5,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  hueShift: 0,
  chromaStrength: 0.01,
  chromaFalloff: 1.5,
  pixelateSize: 0.002,
  vignette: 0.35,
  bloomIntensity: 0.35,
  bloomRadius: 2.5,
  bloomThreshold: 0.6,
  exposure: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  halation: 0,
  lightLeak: 0,
  dust: 0,
  animate: true,
});

export const DEFAULT_SETTINGS = Object.freeze({
  edit: DEFAULT_EDIT,
  ascii: DEFAULT_ASCII,
  pixel: DEFAULT_PIXEL,
  grain: DEFAULT_GRAIN,
});

export const EDIT_PRESETS = Object.freeze([
  { id: "natural", label: "Natural", settings: {} },
  {
    id: "cinematic",
    label: "Cinematic",
    settings: {
      contrast: 14,
      saturation: -8,
      temperature: -6,
      tint: 3,
      shadows: 12,
      highlights: -18,
      fade: 8,
      vignette: 22,
    },
  },
  {
    id: "warm-film",
    label: "Warm Film",
    settings: {
      temperature: 24,
      tint: 5,
      saturation: -6,
      contrast: 9,
      highlights: -12,
      shadows: 8,
      fade: 14,
      vignette: 16,
    },
  },
  {
    id: "cool-film",
    label: "Cool Film",
    settings: {
      temperature: -22,
      tint: -4,
      saturation: -4,
      contrast: 10,
      shadows: 10,
      highlights: -10,
      fade: 10,
      vignette: 14,
    },
  },
  {
    id: "noir",
    label: "Noir",
    settings: {
      saturation: -100,
      contrast: 32,
      shadows: -12,
      highlights: 6,
      fade: 4,
      vignette: 30,
    },
  },
  {
    id: "faded-analog",
    label: "Faded Analog",
    settings: {
      saturation: -18,
      contrast: -12,
      fade: 32,
      temperature: 10,
      tint: 4,
      highlights: -8,
      vignette: 18,
    },
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    settings: { contrast: 42, saturation: 8, highlights: -14, shadows: 8, sharpening: 24 },
  },
  {
    id: "soft-matte",
    label: "Soft Matte",
    settings: {
      contrast: -16,
      saturation: -10,
      fade: 24,
      shadows: 22,
      highlights: -20,
      vignette: 8,
    },
  },
]);

export const ASCII_CHARSETS = Object.freeze([
  { id: "classic", label: "Classic", charset: "@#S%?*+;:,. " },
  { id: "dense", label: "Dense", charset: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. " },
  { id: "blocks", label: "Blocks", charset: "█▓▒░ " },
  { id: "minimal", label: "Minimal", charset: "#+-. " },
  { id: "terminal", label: "Terminal", charset: "0123456789ABCDEF@#%*+=-:. " },
  { id: "binary", label: "Binary", charset: "10 " },
]);

export const ASCII_COLOR_MODES = Object.freeze([
  { id: "mono", label: "Monochrome" },
  { id: "source", label: "Source Color" },
  { id: "terminal", label: "Terminal Green" },
  { id: "amber", label: "Amber CRT" },
  { id: "custom", label: "Custom Palette" },
]);

export const PIXEL_PALETTES = Object.freeze([
  {
    id: "classic8",
    label: "Classic 8-bit",
    colors: ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57"],
  },
  {
    id: "gameboy",
    label: "Game Boy",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  },
  {
    id: "nes",
    label: "NES",
    colors: ["#000000", "#fcfcfc", "#f8f8f8", "#bcbcbc", "#7c7c7c", "#a4e4fc", "#3cbcfc", "#0078f8", "#0000fc", "#b8b8f8", "#6888fc", "#0058f8", "#0000bc", "#f8b8f8", "#f878f8", "#d800cc", "#940084", "#f8a4c0", "#f85898", "#e40058", "#a80020", "#f0d0b0", "#f87858", "#f83800", "#a81000", "#fce0a8", "#fca044", "#e45c10", "#881400", "#f8d878", "#f8b800", "#ac7c00", "#503000", "#d8f878", "#b8f818", "#00b800", "#00a800", "#005800", "#b8f8b8", "#58d854", "#00a844", "#006800"],
  },
  {
    id: "warm-retro",
    label: "Warm Retro",
    colors: ["#201513", "#3b2119", "#6f3b24", "#a85a32", "#d68a4c", "#f2c879", "#f7e7bd", "#fff8e8", "#6b2d2d", "#a44b3f", "#d9785f"],
  },
  {
    id: "cyberpunk",
    label: "Cool Cyberpunk",
    colors: ["#050510", "#0b1030", "#141b5c", "#243a9c", "#2f6fe4", "#39c6ff", "#7af7ff", "#d8ffff", "#2a0a4a", "#7b1fa2", "#d500f9", "#ff2fb3"],
  },
  {
    id: "grayscale",
    label: "Grayscale",
    colors: ["#000000", "#202020", "#404040", "#606060", "#808080", "#a0a0a0", "#c0c0c0", "#e0e0e0", "#ffffff"],
  },
  {
    id: "custom",
    label: "Custom",
    colors: [],
  },
]);

export const PIXEL_PALETTE_IDS = Object.freeze(PIXEL_PALETTES.map((palette) => palette.id));

export const GRAIN_PRESETS = Object.freeze([
  { id: "clean", label: "Clean Scan", settings: { grainIntensity: 0.03, grainSize: 0.003, halftoneSize: 0.001, bloomIntensity: 0.15, fade: 0, vignette: 0.18 } },
  { id: "fine", label: "Fine Grain", settings: { grainIntensity: 0.1, grainSize: 0.002, halftoneSize: 0.001, bloomIntensity: 0.3, fade: 4, vignette: 0.3 } },
  { id: "35mm", label: "35mm Film", settings: { grainIntensity: 0.18, grainSize: 0.005, halftoneSize: 0.001, bloomIntensity: 0.45, fade: 12, halation: 0.25, vignette: 0.55, temperature: 6 } },
  { id: "16mm", label: "16mm Push", settings: { grainIntensity: 0.28, grainSize: 0.008, halftoneSize: 0.001, bloomIntensity: 0.55, fade: 18, halation: 0.4, vignette: 0.7, contrast: 1.1 } },
  { id: "expired", label: "Expired Stock", settings: { grainIntensity: 0.22, grainSize: 0.006, halftoneSize: 0.001, bloomIntensity: 0.35, fade: 28, halation: 0.3, lightLeak: 0.2, vignette: 0.6, temperature: 14, tint: 4 } },
  { id: "noir", label: "Noir Lab", settings: { grainIntensity: 0.2, grainSize: 0.004, halftoneSize: 0.001, saturation: 0, contrast: 1.25, bloomIntensity: 0.35, fade: 6, vignette: 0.75 } },
  { id: "arcade", label: "Arcade Halftone", settings: { grainIntensity: 0.08, grainSize: 0.004, halftoneSize: 0.012, halftoneContrast: 2.2, ditherLevels: 4, ditherStrength: 0.8, bloomIntensity: 0.6, fade: 0, vignette: 0.4 } },
]);

export const REDUCED_MOTION = typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const STORAGE_KEY = "vanta.studio.presets.v1";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function createDefaultSettings() {
  return deepClone(DEFAULT_SETTINGS);
}

export function createInitialState() {
  return {
    source: null,
    sourceToken: 0,
    mode: "edit",
    settings: createDefaultSettings(),
    zoom: { mode: "fit", percent: 100 },
    compare: { enabled: false, position: 50 },
    showBefore: false,
    inspectorOpen: true,
    inspectorSections: {},
    savedPresets: { edit: [], ascii: [], pixel: [], grain: [] },
    rendering: false,
    exportBusy: false,
    lastRenderMs: 0,
    lastOutput: null,
    lastAsciiGrid: null,
    lastMeta: null,
    baseCanvas: null,
    geometryCanvas: null,
    beforeCanvas: null,
    cache: {
      sourceKey: "",
      geometryKey: "",
      editKey: "",
      baseKey: "",
    },
    dirty: {
      geometry: true,
      edit: true,
      mode: true,
      display: true,
    },
  };
}

export const state = createInitialState();

export function getMode(modeId = state.mode) {
  return MODES.find((mode) => mode.id === modeId) || MODES[0];
}

export function getFont(fontId) {
  return FONTS.find((font) => font.id === fontId) || FONTS[0];
}
