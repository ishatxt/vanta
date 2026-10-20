import {
  ASCII_CHARSETS,
  EDIT_PRESETS,
  GRAIN_PRESETS,
  LIMITS,
  MODES,
  PIXEL_PALETTES,
  PREVIEW_MAX_DIMENSION,
  REDUCED_MOTION,
  createDefaultSettings,
  deepClone,
  getMode,
  state,
} from "./state.js";
import { decodeImageFile, initImageLoader } from "./image-loader.js";
import {
  applyAdjustments,
  getOutputSize,
  limitExportSize,
  renderGeometry,
} from "./image-pipeline.js";
import { History } from "./history.js";
import {
  deletePreset as removeSavedPreset,
  loadSavedPresets,
  persistSavedPresets,
  savePreset as createSavedPreset,
} from "./presets.js";
import { PreviewController } from "./preview.js";
import {
  buildInspector,
  closeDialog,
  openDialog,
  readPath,
  refreshInspector,
  resetGroupToDefaults,
  setStatus,
  showToast,
  writePath,
} from "./ui.js";
import {
  EDIT_GROUPS,
  applyEditPreset,
  rotateCrop,
  setCropRatio,
} from "./modes/edit.js";
import {
  ASCII_GROUPS,
  generateAsciiGrid,
  gridToText,
  renderAsciiCanvas,
} from "./modes/ascii.js";
import { PIXEL_GROUPS, pixelateCanvas } from "./modes/pixel.js";
import {
  GRAIN_GROUPS,
  GrainLabEngine,
  applyGrainPreset,
  isWebGL2Available,
  renderGrainFallback,
} from "./modes/grain-lab.js";
import {
  buildExport,
  downloadBlob,
  exportFilename,
  formatsForMode,
} from "./export.js";

const $ = (id) => document.getElementById(id);

const GROUPS_BY_MODE = {
  edit: EDIT_GROUPS,
  ascii: ASCII_GROUPS,
  pixel: PIXEL_GROUPS,
  grain: GRAIN_GROUPS,
};

const FORMAT_NOTES = {
  png: "Lossless export. Transparency is preserved where the current mode supports it.",
  jpeg: "JPG flattens transparency onto black. Use the quality control for smaller files.",
  webp: "WEBP uses modern compression. The browser must support WEBP encoding.",
  txt: "Plain text export uses the shared ASCII character grid and exact line breaks.",
  svg: "SVG export keeps the ASCII artwork as scalable, color-aware text.",
};

const app = {
  preview: null,
  history: new History(LIMITS.MAX_HISTORY),
  grainEngine: null,
  grainUnavailable: false,
  fallbackWarned: false,
  grainRaf: 0,
  grainTime: 12,
  baseCanvas: null,
  geometryCanvas: null,
  fullGeometrySize: { width: 0, height: 0 },
  cache: { geometryKey: "", baseKey: "" },
  asciiGrid: null,
  asciiMeta: null,
  renderPending: false,
  renderFrame: 0,
  resizeTimer: 0,
  exportFormat: "png",
  exportQuality: 92,
  exportBusy: false,
  presetMode: "edit",
};

const dom = {
  fileInput: $("file-input"),
  btnOpen: $("btn-open"),
  btnOpenEmpty: $("btn-open-empty"),
  btnUndo: $("btn-undo"),
  btnRedo: $("btn-redo"),
  btnBefore: $("btn-before"),
  btnCompare: $("btn-compare"),
  btnExport: $("btn-export"),
  btnSettings: $("btn-settings"),
  settingsMenu: $("settings-menu"),
  menuSavePreset: $("menu-save-preset"),
  menuResetAll: $("menu-reset-all"),
  menuShortcuts: $("menu-shortcuts"),
  menuPauseGrain: $("menu-pause-grain"),
  modeButtons: Array.from(document.querySelectorAll(".mode-btn[data-mode]")),
  stageMode: $("stage-mode"),
  stageDescription: $("stage-description"),
  imageDimensions: $("image-dimensions"),
  previewScroll: $("preview-scroll"),
  previewFrame: $("preview-frame"),
  previewCanvas: $("preview-canvas"),
  glCanvas: $("gl-canvas"),
  beforeCanvas: $("before-canvas"),
  compareDivider: $("compare-divider"),
  emptyState: $("empty-state"),
  previewBadge: $("preview-badge"),
  zoomLabel: $("zoom-label"),
  zoomFit: $("zoom-fit"),
  zoom100: $("zoom-100"),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  renderStatus: $("render-status"),
  renderMetrics: $("render-metrics"),
  inspector: $("inspector"),
  inspectorTitle: $("inspector-title"),
  inspectorSubtitle: $("inspector-subtitle"),
  inspectorBody: $("inspector-body"),
  btnInspectorToggle: $("btn-inspector-toggle"),
  btnInspectorClose: $("btn-inspector-close"),
  btnResetAll: $("btn-reset-all"),
  btnSavePreset: $("btn-save-preset"),
  presetStrip: $("preset-strip"),
  btnPresetSaveMini: $("btn-preset-save-mini"),
  modeIndicator: $("mode-indicator"),
  statusMessage: $("status-message"),
  statusDetail: $("status-detail"),
  dropOverlay: $("drop-overlay"),
  exportDialog: $("export-dialog"),
  exportForm: $("export-form"),
  exportClose: $("export-close"),
  exportCancel: $("export-cancel"),
  exportRun: $("export-run"),
  exportSummary: $("export-summary"),
  exportFormats: $("export-formats"),
  exportQualityRow: $("export-quality-row"),
  exportQuality: $("export-quality"),
  exportQualityValue: $("export-quality-value"),
  exportNote: $("export-note"),
  textDialog: $("text-dialog"),
  textSummary: $("text-summary"),
  asciiText: $("ascii-text"),
  textClose: $("text-close"),
  textCloseBottom: $("text-close-bottom"),
  textCopy: $("text-copy"),
  textDownload: $("text-download"),
  presetDialog: $("preset-dialog"),
  presetForm: $("preset-form"),
  presetClose: $("preset-close"),
  presetCancel: $("preset-cancel"),
  presetSave: $("preset-save"),
  presetName: $("preset-name"),
  presetSubtitle: $("preset-subtitle"),
  presetError: $("preset-error"),
  shortcutsDialog: $("shortcuts-dialog"),
  shortcutsClose: $("shortcuts-close"),
  shortcutsDone: $("shortcuts-done"),
};

function captureSnapshot() {
  return {
    mode: state.mode,
    settings: deepClone(state.settings),
  };
}

function updateHistoryButtons() {
  dom.btnUndo.disabled = !app.history.canUndo;
  dom.btnRedo.disabled = !app.history.canRedo;
}

function commitHistory() {
  app.history.commit(captureSnapshot());
  updateHistoryButtons();
}

function normalizeModeSettings(modeId, incoming) {
  const defaults = createDefaultSettings();
  const result = deepClone(defaults[modeId]);
  if (!incoming || typeof incoming !== "object") return result;

  const groups = GROUPS_BY_MODE[modeId] || [];
  for (const group of groups) {
    for (const control of group.controls) {
      if (!control.key) continue;
      const value = readPath(incoming, control.key, undefined);
      if (value === undefined) continue;

      if (control.type === "range") {
        const number = Number(value);
        if (Number.isFinite(number)) {
          writePath(result, control.key, Math.min(control.max, Math.max(control.min, number)));
        }
      } else if (control.type === "toggle") {
        writePath(result, control.key, Boolean(value));
      } else if (control.type === "select") {
        const valid = (control.options || []).some((option) => option.value === value);
        if (valid) writePath(result, control.key, value);
      } else if (control.type === "color") {
        if (/^#[0-9a-f]{6}$/i.test(String(value))) writePath(result, control.key, String(value));
      } else if (control.type === "text") {
        writePath(result, control.key, String(value).slice(0, 2000));
      }
    }
  }
  return result;
}

function normalizeSettings(incoming) {
  const normalized = {};
  for (const mode of MODES) {
    normalized[mode.id] = normalizeModeSettings(mode.id, incoming?.[mode.id]);
  }
  return normalized;
}

function updateStatus(message, { busy = false, tone = "" } = {}) {
  setStatus(dom.renderStatus, message, { busy, tone });
  dom.statusMessage.textContent = message;
}

function updateControls() {
  const hasImage = Boolean(state.source);
  dom.btnExport.disabled = !hasImage || app.exportBusy;
  dom.btnBefore.disabled = !hasImage;
  dom.btnCompare.disabled = !hasImage;
  dom.btnBefore.setAttribute("aria-pressed", String(state.showBefore));
  dom.btnCompare.setAttribute("aria-pressed", String(state.compare.enabled));
  updateHistoryButtons();
}

function syncGrainPauseMenu() {
  const paused = !state.settings.grain.animate;
  dom.menuPauseGrain.setAttribute("aria-checked", String(paused));
  dom.menuPauseGrain.textContent = paused ? "Resume animated grain" : "Pause animated grain";
}

function syncModeUI({ rebuild = true } = {}) {
  const mode = getMode();
  for (const button of dom.modeButtons) {
    const active = button.dataset.mode === mode.id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  dom.stageMode.textContent = mode.label;
  dom.stageDescription.textContent = mode.description;
  dom.modeIndicator.textContent = mode.short;
  dom.inspectorTitle.textContent = mode.label;
  dom.inspectorSubtitle.textContent = mode.description;
  if (rebuild) buildModeInspector();
  syncGrainPauseMenu();
}

function buildModeInspector({ resetScroll = false } = {}) {
  buildInspector({
    container: dom.inspectorBody,
    groups: GROUPS_BY_MODE[state.mode],
    settings: state.settings[state.mode],
    onChange: handleSettingChange,
    onCommit: handleSettingCommit,
    onAction: handleInspectorAction,
    onResetGroup: resetInspectorGroup,
  });
  if (resetScroll) dom.inspectorBody.scrollTop = 0;
}

function handleSettingChange(key, value) {
  if (state.mode === "ascii" && key === "charsetPreset") {
    const charset = ASCII_CHARSETS.find((item) => item.id === value);
    if (charset) {
      state.settings.ascii.charset = charset.charset;
      refreshInspector(dom.inspectorBody, state.settings.ascii);
    }
  }
  if (key === "animate") syncGrainPauseMenu();
  scheduleRender();
}

function handleSettingCommit() {
  syncGrainPauseMenu();
  renderPresetStrip();
  commitHistory();
}

function resetInspectorGroup(group) {
  const settings = state.settings[state.mode];
  resetGroupToDefaults(settings, group);
  if (state.mode === "ascii" && group.id === "characters") {
    const charset = ASCII_CHARSETS.find((item) => item.id === state.settings.ascii.charsetPreset);
    if (charset) state.settings.ascii.charset = charset.charset;
  }
  refreshInspector(dom.inspectorBody, settings);
  syncGrainPauseMenu();
  commitHistory();
  renderPresetStrip();
  scheduleRender();
  showToast(`${group.label} reset.`, { tone: "info", timeout: 2200 });
}

function setMode(modeId) {
  if (!MODES.some((mode) => mode.id === modeId) || state.mode === modeId) return;
  state.mode = modeId;
  if (modeId !== "ascii" && dom.textDialog.open) closeDialog(dom.textDialog);
  closeSettingsMenu();
  syncModeUI();
  buildModeInspector({ resetScroll: true });
  renderPresetStrip();
  updateControls();
  commitHistory();
  if (state.source) {
    updateStatus(`Switching to ${getMode().label}…`);
    scheduleRender();
  } else {
    updateStatus(`${getMode().label} mode · open an image`);
  }
}

function scheduleRender() {
  if (!state.source || app.renderPending) return;
  app.renderPending = true;
  app.renderFrame = requestAnimationFrame(() => {
    app.renderPending = false;
    app.renderFrame = 0;
    renderPreview();
  });
}

function ensureGrainEngine() {
  if (app.grainEngine) return app.grainEngine;
  if (app.grainUnavailable) return null;
  if (!isWebGL2Available()) {
    app.grainUnavailable = true;
    if (!app.fallbackWarned) {
      app.fallbackWarned = true;
      showToast("WebGL 2 is unavailable. Grain Lab is using the Canvas fallback.", {
        tone: "warning",
        timeout: 6000,
      });
    }
    return null;
  }
  try {
    app.grainEngine = new GrainLabEngine(dom.glCanvas, {
      onContextLost: handleGrainContextLost,
    });
    return app.grainEngine;
  } catch (error) {
    console.warn("VANTA Grain Lab WebGL initialisation failed:", error);
    app.grainUnavailable = true;
    if (!app.fallbackWarned) {
      app.fallbackWarned = true;
      showToast("WebGL shaders could not start. Grain Lab is using the Canvas fallback.", {
        tone: "warning",
        timeout: 6000,
      });
    }
    return null;
  }
}

function handleGrainContextLost() {
  app.grainEngine = null;
  app.grainUnavailable = true;
  stopGrainLoop();
  showToast("WebGL context was lost. Grain Lab switched to the Canvas fallback.", {
    tone: "warning",
    timeout: 6000,
  });
  if (state.mode === "grain") scheduleRender();
}

function stopGrainLoop() {
  if (app.grainRaf) cancelAnimationFrame(app.grainRaf);
  app.grainRaf = 0;
}

function startGrainLoop() {
  stopGrainLoop();
  if (
    !state.source
    || state.mode !== "grain"
    || !app.grainEngine
    || app.grainEngine.lost
    || app.grainUnavailable
    || app.exportBusy
    || REDUCED_MOTION
    || document.hidden
  ) {
    return;
  }
  const grain = state.settings.grain;
  if (!grain.animate || grain.grainIntensity <= 0) return;

  let last = 0;
  const frame = (timestamp) => {
    if (
      !state.source
      || state.mode !== "grain"
      || !app.grainEngine
      || app.grainEngine.lost
      || !state.settings.grain.animate
    ) {
      app.grainRaf = 0;
      return;
    }
    if (timestamp - last >= 66) {
      last = timestamp;
      app.grainTime += 0.06;
      app.grainEngine.render(app.baseCanvas, state.settings.grain, {
        width: app.baseCanvas.width,
        height: app.baseCanvas.height,
        sourceKey: app.cache.baseKey,
        time: app.grainTime,
      });
    }
    app.grainRaf = requestAnimationFrame(frame);
  };
  app.grainRaf = requestAnimationFrame(frame);
}

function geometryKey() {
  const edit = state.settings.edit;
  return `${state.sourceToken}:${JSON.stringify({
    crop: edit.crop,
    rotation: edit.rotation,
    flipH: edit.flipH,
    flipV: edit.flipV,
  })}`;
}

function renderPreview() {
  if (!state.source) return;
  const started = performance.now();
  stopGrainLoop();

  try {
    const geometryKeyValue = geometryKey();
    if (!app.geometryCanvas || app.cache.geometryKey !== geometryKeyValue) {
      app.geometryCanvas = renderGeometry(
        state.source.image,
        state.settings.edit,
        PREVIEW_MAX_DIMENSION,
      );
      app.cache.geometryKey = geometryKeyValue;
      app.preview.setBeforeCanvas(app.geometryCanvas);
      app.cache.baseKey = "";
    }

    const edit = state.settings.edit;
    const baseKey = `${geometryKeyValue}:${JSON.stringify(edit)}`;
    if (!app.baseCanvas || app.cache.baseKey !== baseKey) {
      app.baseCanvas = applyAdjustments(app.geometryCanvas, edit);
      app.cache.baseKey = baseKey;
    }

    app.fullGeometrySize = getOutputSize(state.source.image, edit);
    let detail = "";

    if (state.mode === "edit") {
      app.preview.setOutput({ canvas: app.baseCanvas, mode: "edit" });
      detail = `${app.baseCanvas.width} × ${app.baseCanvas.height} edit preview`;
    } else if (state.mode === "ascii") {
      const grid = generateAsciiGrid(app.baseCanvas, state.settings.ascii);
      const meta = renderAsciiCanvas(grid, state.settings.ascii, {
        targetWidth: app.baseCanvas.width,
      });
      app.asciiGrid = grid;
      app.asciiMeta = meta;
      state.lastAsciiGrid = grid;
      app.preview.setOutput({ canvas: meta.canvas, mode: "ascii", asciiMeta: meta });
      detail = `${grid.cols} × ${grid.rows} characters`;
      updateTextDialogIfOpen();
    } else if (state.mode === "pixel") {
      const pixel = pixelateCanvas(app.baseCanvas, state.settings.pixel, {
        targetWidth: app.baseCanvas.width,
        referenceWidth: app.fullGeometrySize.width,
      });
      app.preview.setOutput({ canvas: pixel.canvas, mode: "pixel" });
      detail = `${pixel.smallWidth} × ${pixel.smallHeight} pixel grid · ${pixel.paletteSize} colors`;
    } else if (state.mode === "grain") {
      const engine = ensureGrainEngine();
      let rendered = false;
      if (engine) {
        rendered = engine.render(app.baseCanvas, state.settings.grain, {
          width: app.baseCanvas.width,
          height: app.baseCanvas.height,
          sourceKey: app.cache.baseKey,
          time: app.grainTime,
        });
      }
      if (rendered) {
        app.preview.setOutput({ gl: true, mode: "grain" });
        detail = "WebGL film pipeline";
      } else {
        const fallback = renderGrainFallback(
          app.baseCanvas,
          state.settings.grain,
          app.baseCanvas.width,
          app.baseCanvas.height,
        );
        app.preview.setOutput({ canvas: fallback, mode: "grain" });
        detail = "Canvas fallback";
      }
    }

    const elapsed = performance.now() - started;
    state.lastRenderMs = elapsed;
    const display = app.preview.getDisplaySize();
    dom.previewBadge.hidden = false;
    dom.previewBadge.textContent = `${display.width} × ${display.height} · ${getMode().short}`;
    dom.imageDimensions.textContent = `${state.source.width} × ${state.source.height}px source`;
    dom.renderMetrics.textContent = `Preview ${app.baseCanvas.width}×${app.baseCanvas.height} · ${elapsed.toFixed(0)} ms`;
    dom.statusDetail.textContent = detail;
    updateStatus("Preview ready", { tone: "success" });
    startGrainLoop();
  } catch (error) {
    console.error("VANTA preview render failed:", error);
    updateStatus("Preview failed", { tone: "error" });
    showToast(error?.message || "The preview could not be rendered.", { tone: "error" });
  }
}

function updateTextDialogIfOpen() {
  if (!dom.textDialog.open || !app.asciiGrid) return;
  dom.asciiText.value = gridToText(app.asciiGrid);
  dom.textSummary.textContent = `${app.asciiGrid.cols} columns × ${app.asciiGrid.rows} rows · shared character grid`;
}

function updateCompareButtons() {
  dom.btnBefore.setAttribute("aria-pressed", String(state.showBefore));
  dom.btnCompare.setAttribute("aria-pressed", String(state.compare.enabled));
}

function toggleBefore() {
  if (!state.source) return;
  state.showBefore = !state.showBefore;
  if (state.showBefore) {
    state.compare.enabled = false;
    app.preview.setCompareEnabled(false);
  }
  app.preview.setShowBefore(state.showBefore);
  updateCompareButtons();
}

function toggleCompare() {
  if (!state.source) return;
  state.compare.enabled = !state.compare.enabled;
  if (state.compare.enabled) {
    state.showBefore = false;
    app.preview.setShowBefore(false);
  }
  app.preview.setCompareEnabled(state.compare.enabled);
  updateCompareButtons();
}

function undo() {
  const snapshot = app.history.undo();
  if (!snapshot) {
    showToast("Nothing to undo.", { tone: "info", timeout: 1800 });
    return;
  }
  applySnapshot(snapshot);
  updateStatus("Undid last change");
}

function redo() {
  const snapshot = app.history.redo();
  if (!snapshot) {
    showToast("Nothing to redo.", { tone: "info", timeout: 1800 });
    return;
  }
  applySnapshot(snapshot);
  updateStatus("Redid change");
}

function applySnapshot(snapshot) {
  state.mode = MODES.some((mode) => mode.id === snapshot.mode) ? snapshot.mode : "edit";
  state.settings = normalizeSettings(snapshot.settings);
  if (state.mode !== "ascii" && dom.textDialog.open) closeDialog(dom.textDialog);
  syncModeUI();
  buildModeInspector();
  renderPresetStrip();
  updateControls();
  scheduleRender();
}

async function loadImageFile(file) {
  updateStatus("Reading image…", { busy: true });
  try {
    const loaded = await decodeImageFile(file);
    URL.revokeObjectURL(loaded.url);
    state.source = {
      image: loaded.image,
      name: loaded.name,
      type: loaded.type,
      size: loaded.size,
      width: loaded.width,
      height: loaded.height,
    };
    state.sourceToken += 1;
    app.geometryCanvas = null;
    app.baseCanvas = null;
    app.cache.geometryKey = "";
    app.cache.baseKey = "";
    app.asciiGrid = null;
    app.asciiMeta = null;
    state.lastAsciiGrid = null;
    app.grainTime = 12;
    state.showBefore = false;
    state.compare.enabled = false;
    app.preview.setShowBefore(false);
    app.preview.setCompareEnabled(false);
    updateCompareButtons();
    app.preview.setEmpty(false);
    if (dom.textDialog.open) closeDialog(dom.textDialog);
    app.history.reset(captureSnapshot());
    updateControls();
    renderPresetStrip();
    dom.imageDimensions.textContent = `${loaded.width} × ${loaded.height}px source`;
    scheduleRender();
    showToast(`Loaded ${loaded.name} · ${loaded.width} × ${loaded.height}.`, {
      tone: "success",
      timeout: 3200,
    });
  } catch (error) {
    updateStatus("Image load failed", { tone: "error" });
    showToast(error?.message || "The image could not be loaded.", { tone: "error", timeout: 6000 });
  }
}

function resetAllSettings() {
  state.settings = createDefaultSettings();
  if (REDUCED_MOTION) state.settings.grain.animate = false;
  buildModeInspector({ resetScroll: true });
  renderPresetStrip();
  syncGrainPauseMenu();
  commitHistory();
  scheduleRender();
  showToast("All settings reset.", { tone: "info", timeout: 2400 });
}

function openInspector() {
  dom.inspector.classList.add("is-open");
  document.body.classList.add("inspector-open");
  dom.btnInspectorToggle.setAttribute("aria-expanded", "true");
}

function closeInspector() {
  dom.inspector.classList.remove("is-open");
  document.body.classList.remove("inspector-open");
  dom.btnInspectorToggle.setAttribute("aria-expanded", "false");
}

function openSettingsMenu() {
  dom.settingsMenu.hidden = false;
  dom.btnSettings.setAttribute("aria-expanded", "true");
}

function closeSettingsMenu() {
  dom.settingsMenu.hidden = true;
  dom.btnSettings.setAttribute("aria-expanded", "false");
}

function toggleSettingsMenu() {
  if (dom.settingsMenu.hidden) openSettingsMenu();
  else closeSettingsMenu();
}

function presetListForMode(modeId) {
  if (modeId === "edit") {
    return EDIT_PRESETS.map((preset) => ({
      kind: "edit",
      id: preset.id,
      label: preset.label,
      settings: preset.settings,
    }));
  }
  if (modeId === "ascii") {
    return ASCII_CHARSETS.map((preset) => ({
      kind: "charset",
      id: preset.id,
      label: preset.label,
      charset: preset.charset,
    }));
  }
  if (modeId === "pixel") {
    return PIXEL_PALETTES
      .filter((palette) => palette.id !== "custom")
      .map((palette) => ({
        kind: "palette",
        id: palette.id,
        label: palette.label,
        colors: palette.colors,
      }));
  }
  return GRAIN_PRESETS.map((preset) => ({
    kind: "grain",
    id: preset.id,
    label: preset.label,
    settings: preset.settings,
  }));
}

function isBuiltinPresetActive(item) {
  if (item.kind === "charset") return state.settings.ascii.charsetPreset === item.id;
  if (item.kind === "palette") return state.settings.pixel.palette === item.id;
  if (item.kind === "edit") {
    const preset = EDIT_PRESETS.find((entry) => entry.id === item.id);
    if (!preset) return false;
    if (!Object.keys(preset.settings).length) {
      const defaults = createDefaultSettings().edit;
      const keys = [
        "exposure", "brightness", "contrast", "saturation", "temperature", "tint",
        "highlights", "shadows", "sharpening", "fade", "vignette",
      ];
      return keys.every((key) => state.settings.edit[key] === defaults[key]);
    }
    return Object.entries(preset.settings).every(([key, value]) => (
      readPath(state.settings.edit, key) === value
    ));
  }
  if (item.kind === "grain") {
    const preset = GRAIN_PRESETS.find((entry) => entry.id === item.id);
    if (!preset) return false;
    return Object.entries(preset.settings).every(([key, value]) => (
      readPath(state.settings.grain, key) === value
    ));
  }
  return false;
}

function isSavedPresetActive(preset) {
  try {
    const normalized = normalizeModeSettings(state.mode, preset.settings);
    return JSON.stringify(normalized) === JSON.stringify(state.settings[state.mode]);
  } catch {
    return false;
  }
}

function renderPresetStrip() {
  dom.presetStrip.replaceChildren();
  for (const item of presetListForMode(state.mode)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `preset-chip${isBuiltinPresetActive(item) ? " is-active" : ""}`;
    button.textContent = item.label;
    button.title = `Apply ${item.label}`;
    button.addEventListener("click", () => applyBuiltinPreset(item));
    dom.presetStrip.appendChild(button);
  }

  for (const preset of state.savedPresets[state.mode] || []) {
    const wrap = document.createElement("span");
    wrap.className = "preset-chip-wrap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `preset-chip${isSavedPresetActive(preset) ? " is-active" : ""}`;
    button.textContent = preset.name;
    button.title = `Apply saved preset ${preset.name}`;
    button.addEventListener("click", () => applySavedPreset(preset));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "preset-delete";
    remove.textContent = "×";
    remove.title = `Delete preset ${preset.name}`;
    remove.setAttribute("aria-label", `Delete preset ${preset.name}`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSavedPreset(preset);
    });
    wrap.appendChild(button);
    wrap.appendChild(remove);
    dom.presetStrip.appendChild(wrap);
  }
}

function applyBuiltinPreset(item) {
  if (item.kind === "edit") {
    state.settings.edit = applyEditPreset(state.settings.edit, item.id);
    buildModeInspector();
  } else if (item.kind === "charset") {
    state.settings.ascii.charsetPreset = item.id;
    state.settings.ascii.charset = item.charset;
    refreshInspector(dom.inspectorBody, state.settings.ascii);
  } else if (item.kind === "palette") {
    state.settings.pixel.palette = item.id;
    if (item.colors?.length) {
      state.settings.pixel.paletteSize = Math.min(
        state.settings.pixel.paletteSize,
        Math.max(2, item.colors.length),
      );
    }
    refreshInspector(dom.inspectorBody, state.settings.pixel);
  } else if (item.kind === "grain") {
    state.settings.grain = applyGrainPreset(state.settings.grain, item.id);
    buildModeInspector();
  }
  renderPresetStrip();
  commitHistory();
  scheduleRender();
  showToast(`${item.label} applied.`, { tone: "success", timeout: 2200 });
}

function applySavedPreset(preset) {
  state.settings[state.mode] = normalizeModeSettings(state.mode, preset.settings);
  buildModeInspector();
  renderPresetStrip();
  commitHistory();
  scheduleRender();
  showToast(`Preset ${preset.name} applied.`, { tone: "success", timeout: 2200 });
}

function deleteSavedPreset(preset) {
  state.savedPresets = removeSavedPreset(state.savedPresets, state.mode, preset.id);
  const persisted = persistSavedPresets(state.savedPresets);
  if (!persisted.ok) showToast(persisted.error, { tone: "warning", timeout: 5000 });
  renderPresetStrip();
  showToast(`Preset ${preset.name} deleted.`, { tone: "info", timeout: 2200 });
}

function openPresetDialog() {
  closeSettingsMenu();
  app.presetMode = state.mode;
  dom.presetSubtitle.textContent = `Save the current ${getMode(app.presetMode).label} settings in this browser.`;
  dom.presetName.value = "";
  dom.presetError.textContent = "";
  openDialog(dom.presetDialog);
  window.setTimeout(() => dom.presetName.focus(), 30);
}

function savePresetFromDialog() {
  try {
    const result = createSavedPreset(
      state.savedPresets,
      app.presetMode,
      dom.presetName.value,
      state.settings[app.presetMode],
    );
    state.savedPresets = result.presets;
    const persisted = persistSavedPresets(state.savedPresets);
    renderPresetStrip();
    closeDialog(dom.presetDialog);
    if (!persisted.ok) showToast(persisted.error, { tone: "warning", timeout: 6000 });
    else showToast(`Preset ${result.preset.name} saved.`, { tone: "success", timeout: 2400 });
  } catch (error) {
    dom.presetError.textContent = error?.message || "The preset could not be saved.";
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

function ensureAsciiGrid() {
  if (!app.asciiGrid && state.source && state.mode === "ascii") renderPreview();
  return app.asciiGrid;
}

function openAsciiTextDialog() {
  if (!state.source) {
    showToast("Open an image before viewing ASCII text.", { tone: "warning" });
    return;
  }
  if (state.mode !== "ascii") {
    showToast("Switch to ASCII mode to view the character grid.", { tone: "warning" });
    return;
  }
  const grid = ensureAsciiGrid();
  if (!grid) return;
  updateTextDialogIfOpen();
  openDialog(dom.textDialog);
  window.setTimeout(() => dom.asciiText.focus(), 30);
}

async function copyAsciiText() {
  const grid = ensureAsciiGrid();
  if (!grid) {
    showToast("No ASCII grid is available yet.", { tone: "warning" });
    return;
  }
  const text = gridToText(grid);
  const copied = await copyText(text);
  if (copied) showToast("ASCII text copied to clipboard.", { tone: "success", timeout: 2200 });
  else showToast("Clipboard access was blocked by the browser.", { tone: "error" });
}

function downloadAsciiText() {
  if (!state.source) return;
  const grid = ensureAsciiGrid();
  if (!grid) return;
  const blob = new Blob([gridToText(grid)], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, exportFilename(state, "txt"));
  showToast("ASCII text downloaded.", { tone: "success", timeout: 2200 });
}

function handleInspectorAction(actionId) {
  if (actionId.startsWith("crop-")) {
    if (!state.source) {
      showToast("Open an image before cropping.", { tone: "warning" });
      return;
    }
    const ratios = {
      "crop-free": null,
      "crop-1-1": 1,
      "crop-4-3": 4 / 3,
      "crop-3-2": 3 / 2,
      "crop-16-9": 16 / 9,
      "crop-9-16": 9 / 16,
    };
    const ratio = ratios[actionId];
    state.settings.edit = setCropRatio(state.settings.edit, ratio, state.source);
    buildModeInspector();
    commitHistory();
    scheduleRender();
    return;
  }

  if (actionId.startsWith("rotate-")) {
    if (!state.source) {
      showToast("Open an image before rotating.", { tone: "warning" });
      return;
    }
    const direction = actionId === "rotate-270" ? 270 : actionId === "rotate-180" ? 180 : 90;
    state.settings.edit = rotateCrop(state.settings.edit, direction);
    buildModeInspector();
    commitHistory();
    scheduleRender();
    return;
  }

  if (actionId === "ascii-open-text") {
    openAsciiTextDialog();
    return;
  }
  if (actionId === "ascii-copy-text") {
    copyAsciiText();
    return;
  }
  if (actionId.startsWith("grain-preset-")) {
    const presetId = actionId.slice("grain-preset-".length);
    const preset = GRAIN_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    state.settings.grain = applyGrainPreset(state.settings.grain, presetId);
    buildModeInspector();
    renderPresetStrip();
    commitHistory();
    scheduleRender();
    showToast(`${preset.label} film stock applied.`, { tone: "success", timeout: 2400 });
  }
}

function updateExportSummary() {
  dom.exportSummary.replaceChildren();
  if (!state.source) return;
  const full = getOutputSize(state.source.image, state.settings.edit);
  const limited = limitExportSize(full);
  const title = document.createElement("strong");
  title.textContent = state.source.name;
  const dimensions = document.createElement("span");
  dimensions.textContent = `${full.width} × ${full.height}px · ${getMode().label}`;
  dom.exportSummary.appendChild(title);
  dom.exportSummary.appendChild(dimensions);
  if (limited.scale < 0.999) {
    const note = document.createElement("span");
    note.textContent = `Large source: capped to ${limited.width} × ${limited.height}px for a safe browser export.`;
    dom.exportSummary.appendChild(note);
  }
}

function updateExportNote() {
  const info = [...formatsForMode(state.mode)].find((format) => format.id === app.exportFormat);
  dom.exportNote.textContent = FORMAT_NOTES[app.exportFormat] || info?.note || "";
  dom.exportQualityRow.hidden = !["jpeg", "webp"].includes(app.exportFormat);
  dom.exportQualityValue.textContent = `${app.exportQuality}%`;
}

function selectExportFormat(formatId) {
  app.exportFormat = formatId;
  for (const button of dom.exportFormats.querySelectorAll(".format-card")) {
    button.classList.toggle("is-selected", button.dataset.format === formatId);
    button.setAttribute("aria-pressed", String(button.dataset.format === formatId));
  }
  updateExportNote();
}

function renderExportFormats() {
  dom.exportFormats.replaceChildren();
  for (const format of formatsForMode(state.mode)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "format-card";
    button.dataset.format = format.id;
    button.setAttribute("aria-pressed", "false");
    const strong = document.createElement("strong");
    strong.textContent = format.label;
    const note = document.createElement("span");
    note.textContent = format.note;
    button.appendChild(strong);
    button.appendChild(note);
    button.addEventListener("click", () => selectExportFormat(format.id));
    dom.exportFormats.appendChild(button);
  }
  selectExportFormat(app.exportFormat);
}

function openExportDialog() {
  if (!state.source) {
    showToast("Open an image before exporting.", { tone: "warning" });
    return;
  }
  closeSettingsMenu();
  app.exportFormat = "png";
  updateExportSummary();
  renderExportFormats();
  updateExportNote();
  openDialog(dom.exportDialog);
}

async function runExport() {
  if (!state.source || app.exportBusy) return;
  app.exportBusy = true;
  updateControls();
  dom.exportRun.disabled = true;
  dom.exportCancel.disabled = true;
  stopGrainLoop();
  updateStatus("Rendering export from source…", { busy: true });
  try {
    const snapshot = {
      source: state.source,
      mode: state.mode,
      settings: deepClone(state.settings),
    };
    const result = await buildExport({
      state: snapshot,
      format: app.exportFormat,
      quality: app.exportQuality / 100,
      onProgress: (message) => {
        dom.exportNote.textContent = message;
        updateStatus(message, { busy: true });
      },
    });
    downloadBlob(result.blob, result.filename);
    closeDialog(dom.exportDialog);
    updateStatus(`Exported ${result.format.toUpperCase()}`, { tone: "success" });
    showToast(
      `Exported ${result.width} × ${result.height} ${result.format.toUpperCase()} · ${result.filename}`,
      { tone: "success", timeout: 5000 },
    );
  } catch (error) {
    console.error("VANTA export failed:", error);
    dom.exportNote.textContent = error?.message || "The export could not be generated.";
    updateStatus("Export failed", { tone: "error" });
    showToast(error?.message || "The export could not be generated.", {
      tone: "error",
      timeout: 6500,
    });
  } finally {
    app.exportBusy = false;
    dom.exportRun.disabled = false;
    dom.exportCancel.disabled = false;
    updateControls();
    if (state.mode === "grain" && state.source) scheduleRender();
  }
}

function handleKeydown(event) {
  const target = event.target;
  const isTyping = target instanceof Element && Boolean(
    target.closest("input[type='text'], input[type='color'], textarea, select, [contenteditable='true']"),
  );
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (event.key === "Escape") {
    closeSettingsMenu();
    return;
  }

  if (command && key === "o") {
    event.preventDefault();
    dom.fileInput.click();
    return;
  }
  if (command && key === "z") {
    if (isTyping) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && key === "y") {
    if (isTyping) return;
    event.preventDefault();
    redo();
    return;
  }
  if (command && key === "s") {
    event.preventDefault();
    openPresetDialog();
    return;
  }
  if (command && key === "e") {
    event.preventDefault();
    openExportDialog();
    return;
  }
  if (command || event.altKey || isTyping) return;

  if (event.code === "Digit0") {
    event.preventDefault();
    if (event.shiftKey) app.preview.setZoom({ mode: "percent", percent: 100 });
    else app.preview.setZoom({ mode: "fit", percent: 100 });
    return;
  }
  if (event.code === "Digit1" || event.code === "Digit2" || event.code === "Digit3" || event.code === "Digit4") {
    const index = Number(event.code.slice(-1)) - 1;
    if (MODES[index]) setMode(MODES[index].id);
    return;
  }
  if (event.key === "[" || event.key === "]") {
    event.preventDefault();
    app.preview.zoomStep(event.key === "]" ? 1 : -1);
    return;
  }
  if (key === "b") {
    event.preventDefault();
    toggleBefore();
    return;
  }
  if (key === "c") {
    event.preventDefault();
    toggleCompare();
  }
}

function bindEvents() {
  for (const button of dom.modeButtons) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }

  dom.btnUndo.addEventListener("click", undo);
  dom.btnRedo.addEventListener("click", redo);
  dom.btnBefore.addEventListener("click", toggleBefore);
  dom.btnCompare.addEventListener("click", toggleCompare);
  dom.btnExport.addEventListener("click", openExportDialog);
  dom.btnResetAll.addEventListener("click", resetAllSettings);
  dom.btnSavePreset.addEventListener("click", openPresetDialog);
  dom.btnPresetSaveMini.addEventListener("click", openPresetDialog);

  dom.btnSettings.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettingsMenu();
  });
  dom.menuSavePreset.addEventListener("click", openPresetDialog);
  dom.menuResetAll.addEventListener("click", () => {
    closeSettingsMenu();
    resetAllSettings();
  });
  dom.menuShortcuts.addEventListener("click", () => {
    closeSettingsMenu();
    openDialog(dom.shortcutsDialog);
  });
  dom.menuPauseGrain.addEventListener("click", () => {
    state.settings.grain.animate = !state.settings.grain.animate;
    syncGrainPauseMenu();
    closeSettingsMenu();
    commitHistory();
    scheduleRender();
    showToast(
      state.settings.grain.animate ? "Animated grain resumed." : "Animated grain paused.",
      { tone: "info", timeout: 2200 },
    );
  });

  dom.btnInspectorToggle.addEventListener("click", openInspector);
  dom.btnInspectorClose.addEventListener("click", closeInspector);

  dom.exportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runExport();
  });
  dom.exportClose.addEventListener("click", () => closeDialog(dom.exportDialog));
  dom.exportCancel.addEventListener("click", () => closeDialog(dom.exportDialog));
  dom.exportRun.addEventListener("click", runExport);
  dom.exportQuality.addEventListener("input", () => {
    app.exportQuality = Number(dom.exportQuality.value);
    dom.exportQualityValue.textContent = `${app.exportQuality}%`;
  });

  dom.textClose.addEventListener("click", () => closeDialog(dom.textDialog));
  dom.textCloseBottom.addEventListener("click", () => closeDialog(dom.textDialog));
  dom.textCopy.addEventListener("click", copyAsciiText);
  dom.textDownload.addEventListener("click", downloadAsciiText);

  dom.presetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    savePresetFromDialog();
  });
  dom.presetClose.addEventListener("click", () => closeDialog(dom.presetDialog));
  dom.presetCancel.addEventListener("click", () => closeDialog(dom.presetDialog));
  dom.presetSave.addEventListener("click", savePresetFromDialog);
  dom.presetName.addEventListener("input", () => {
    dom.presetError.textContent = "";
  });

  dom.shortcutsClose.addEventListener("click", () => closeDialog(dom.shortcutsDialog));
  dom.shortcutsDone.addEventListener("click", () => closeDialog(dom.shortcutsDialog));

  document.addEventListener("pointerdown", (event) => {
    if (dom.settingsMenu.hidden) return;
    if (dom.settingsMenu.contains(event.target) || dom.btnSettings.contains(event.target)) return;
    closeSettingsMenu();
  });

  document.addEventListener("keydown", handleKeydown);

  window.addEventListener("resize", () => {
    window.clearTimeout(app.resizeTimer);
    app.resizeTimer = window.setTimeout(() => {
      app.preview.resize();
      if (window.innerWidth > 900) closeInspector();
    }, 80);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopGrainLoop();
    } else if (state.mode === "grain" && state.source) {
      scheduleRender();
    }
  });

  window.addEventListener("beforeunload", () => {
    stopGrainLoop();
    app.grainEngine?.dispose();
  });
}

function init() {
  if (REDUCED_MOTION) state.settings.grain.animate = false;

  const saved = loadSavedPresets();
  state.savedPresets = saved.presets;

  app.preview = new PreviewController({
    stage: dom.previewScroll,
    frame: dom.previewFrame,
    canvas: dom.previewCanvas,
    glCanvas: dom.glCanvas,
    beforeCanvas: dom.beforeCanvas,
    divider: dom.compareDivider,
    emptyState: dom.emptyState,
    zoomLabel: dom.zoomLabel,
    zoomFit: dom.zoomFit,
    zoom100: dom.zoom100,
    zoomIn: dom.zoomIn,
    zoomOut: dom.zoomOut,
  });

  app.history.reset(captureSnapshot());
  bindEvents();
  initImageLoader({
    fileInput: dom.fileInput,
    openButtons: [dom.btnOpen, dom.btnOpenEmpty],
    dropOverlay: dom.dropOverlay,
    onFile: loadImageFile,
    onError: (message) => showToast(message, { tone: "error" }),
  });

  syncModeUI();
  buildModeInspector();
  renderPresetStrip();
  app.preview.setEmpty(true);
  app.preview.setShowBefore(false);
  app.preview.setCompareEnabled(false);
  updateCompareButtons();
  updateControls();
  syncGrainPauseMenu();
  updateStatus("Open an image to begin");
  dom.previewBadge.hidden = true;
  dom.imageDimensions.textContent = "No image loaded";

  if (saved.warning) {
    window.setTimeout(() => showToast(saved.warning, { tone: "warning", timeout: 6000 }), 450);
  }
}

init();
