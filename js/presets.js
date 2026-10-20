import {
  LIMITS,
  MODE_IDS,
  STORAGE_KEY,
  deepClone,
} from "./state.js";

function emptyPresets() {
  return { edit: [], ascii: [], pixel: [], grain: [] };
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 48);
}

function validPreset(preset, mode) {
  return Boolean(
    preset
    && typeof preset === "object"
    && typeof preset.id === "string"
    && typeof preset.name === "string"
    && preset.settings
    && typeof preset.settings === "object"
    && preset.mode === mode,
  );
}

export function loadSavedPresets() {
  const result = emptyPresets();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { presets: result, warning: null };
    const parsed = JSON.parse(raw);
    for (const mode of MODE_IDS) {
      const list = Array.isArray(parsed?.[mode]) ? parsed[mode] : [];
      result[mode] = list.filter((preset) => validPreset(preset, mode)).slice(0, LIMITS.MAX_SAVED_PRESETS);
    }
    return { presets: result, warning: null };
  } catch {
    return {
      presets: result,
      warning: "Saved presets could not be read. The studio is using built-in presets.",
    };
  }
}

export function persistSavedPresets(presets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: "Browser storage is unavailable. This preset will last for the current session only.",
    };
  }
}

export function savePreset(presets, mode, name, settings) {
  const label = cleanName(name);
  if (!label) throw new Error("Give the preset a name.");
  if (!MODE_IDS.includes(mode)) throw new Error("Choose a valid mode for this preset.");

  const list = Array.isArray(presets[mode]) ? presets[mode] : [];
  if (list.length >= LIMITS.MAX_SAVED_PRESETS) {
    throw new Error(`You can save up to ${LIMITS.MAX_SAVED_PRESETS} presets per mode.`);
  }
  const duplicate = list.find((preset) => preset.name.toLowerCase() === label.toLowerCase());
  if (duplicate) throw new Error("A preset with that name already exists in this mode.");

  const preset = {
    id: `${mode}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    mode,
    name: label,
    createdAt: Date.now(),
    settings: deepClone(settings),
  };

  return {
    presets: {
      ...presets,
      [mode]: [preset, ...list],
    },
    preset,
  };
}

export function deletePreset(presets, mode, id) {
  if (!MODE_IDS.includes(mode)) return presets;
  return {
    ...presets,
    [mode]: (presets[mode] || []).filter((preset) => preset.id !== id),
  };
}
