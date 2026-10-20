export function readPath(target, path, fallback = 0) {
  const parts = String(path).split(".");
  let cursor = target;
  for (const part of parts) {
    if (cursor == null) return fallback;
    cursor = cursor[part];
  }
  return cursor ?? fallback;
}

export function writePath(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
  return target;
}

function formatValue(control, value) {
  if (control.percent) return `${Math.round(Number(value) * 100)}%`;
  if (typeof value === "number") {
    const digits = Number.isInteger(control.digits) ? control.digits : 0;
    return `${value.toFixed(digits)}${control.suffix || ""}`;
  }
  return String(value ?? "");
}

function fillPercent(control, value) {
  const min = Number(control.min);
  const max = Number(control.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0;
  return Math.min(100, Math.max(0, ((Number(value) - min) / (max - min)) * 100));
}

function makeLabel(control, valueElement) {
  const label = document.createElement("div");
  label.className = "control-label";
  const text = document.createElement("label");
  text.textContent = control.label;
  if (control.type === "range" || control.type === "select" || control.type === "text" || control.type === "color") {
    const id = `control-${Math.random().toString(36).slice(2, 9)}`;
    text.htmlFor = id;
    control.__id = id;
  }
  label.appendChild(text);
  if (valueElement) label.appendChild(valueElement);
  return label;
}

function buildRange(control, settings, handlers) {
  const row = document.createElement("div");
  row.className = "control control-range";
  const value = readPath(settings, control.key, control.default ?? 0);
  const valueElement = document.createElement("output");
  valueElement.className = "control-value";
  valueElement.textContent = formatValue(control, value);
  row.appendChild(makeLabel(control, valueElement));

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = control.__id;
  slider.min = control.min;
  slider.max = control.max;
  slider.step = control.step;
  slider.value = value;
  slider.dataset.kind = "range";
  slider.dataset.path = control.key;
  slider.dataset.percent = control.percent ? "true" : "false";
  slider.dataset.digits = String(control.digits ?? 0);
  slider.dataset.suffix = control.suffix || "";
  slider.style.setProperty("--fill", `${fillPercent(control, value)}%`);

  slider.addEventListener("input", () => {
    const next = Number.parseFloat(slider.value);
    writePath(settings, control.key, next);
    valueElement.textContent = formatValue(control, next);
    slider.style.setProperty("--fill", `${fillPercent(control, next)}%`);
    handlers.onChange(control.key, next, control);
  });
  slider.addEventListener("change", () => {
    handlers.onCommit(control.key, Number.parseFloat(slider.value), control);
  });
  row.appendChild(slider);
  return row;
}

function buildSelect(control, settings, handlers) {
  const row = document.createElement("div");
  row.className = "control control-select";
  row.appendChild(makeLabel(control));
  const select = document.createElement("select");
  select.id = control.__id;
  select.dataset.kind = "select";
  select.dataset.path = control.key;
  for (const option of control.options || []) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  select.value = readPath(settings, control.key, control.default);
  select.addEventListener("change", () => {
    writePath(settings, control.key, select.value);
    handlers.onChange(control.key, select.value, control);
    handlers.onCommit(control.key, select.value, control);
  });
  row.appendChild(select);
  return row;
}

function buildToggle(control, settings, handlers) {
  const row = document.createElement("div");
  row.className = "control control-toggle";
  const label = document.createElement("label");
  label.className = "toggle-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.kind = "toggle";
  input.dataset.path = control.key;
  input.checked = Boolean(readPath(settings, control.key, control.default));
  const text = document.createElement("span");
  text.textContent = control.label;
  input.addEventListener("change", () => {
    writePath(settings, control.key, input.checked);
    handlers.onChange(control.key, input.checked, control);
    handlers.onCommit(control.key, input.checked, control);
  });
  label.appendChild(input);
  label.appendChild(text);
  row.appendChild(label);
  return row;
}

function buildText(control, settings, handlers) {
  const row = document.createElement("div");
  row.className = "control control-text";
  row.appendChild(makeLabel(control));
  const input = document.createElement("input");
  input.type = "text";
  input.id = control.__id;
  input.dataset.kind = "text";
  input.dataset.path = control.key;
  input.placeholder = control.placeholder || "";
  input.spellcheck = false;
  input.value = readPath(settings, control.key, control.default ?? "");
  input.addEventListener("input", () => {
    writePath(settings, control.key, input.value);
    handlers.onChange(control.key, input.value, control);
  });
  input.addEventListener("change", () => {
    handlers.onCommit(control.key, input.value, control);
  });
  row.appendChild(input);
  return row;
}

function buildColor(control, settings, handlers) {
  const row = document.createElement("div");
  row.className = "control control-color";
  const value = readPath(settings, control.key, control.default ?? "#000000");
  const valueElement = document.createElement("output");
  valueElement.className = "control-value color-value";
  valueElement.textContent = value;
  row.appendChild(makeLabel(control, valueElement));

  const wrap = document.createElement("div");
  wrap.className = "color-input-wrap";
  const input = document.createElement("input");
  input.type = "color";
  input.id = control.__id;
  input.dataset.kind = "color";
  input.dataset.path = control.key;
  input.value = value;
  input.addEventListener("input", () => {
    writePath(settings, control.key, input.value);
    valueElement.textContent = input.value;
    handlers.onChange(control.key, input.value, control);
  });
  input.addEventListener("change", () => {
    handlers.onCommit(control.key, input.value, control);
  });
  wrap.appendChild(input);
  row.appendChild(wrap);
  return row;
}

function buildButtonRow(control, settings, handlers) {
  const row = document.createElement("div");
  row.className = "control control-buttons";
  const label = document.createElement("div");
  label.className = "control-label";
  const text = document.createElement("span");
  text.textContent = control.label;
  label.appendChild(text);
  row.appendChild(label);

  const buttons = document.createElement("div");
  buttons.className = "button-row";
  for (const action of control.actions || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip-button";
    button.textContent = action.label;
    button.addEventListener("click", () => handlers.onAction(action.id, action, control));
    buttons.appendChild(button);
  }
  row.appendChild(buttons);
  return row;
}

function buildControl(control, settings, handlers) {
  switch (control.type) {
    case "select":
      return buildSelect(control, settings, handlers);
    case "toggle":
      return buildToggle(control, settings, handlers);
    case "text":
      return buildText(control, settings, handlers);
    case "color":
      return buildColor(control, settings, handlers);
    case "button-row":
      return buildButtonRow(control, settings, handlers);
    case "range":
    default:
      return buildRange(control, settings, handlers);
  }
}

export function buildInspector({
  container,
  groups,
  settings,
  onChange,
  onCommit,
  onAction,
  onResetGroup,
}) {
  const fragment = document.createDocumentFragment();
  const handlers = { onChange, onCommit, onAction };
  for (const group of groups) {
    const details = document.createElement("details");
    details.className = "inspector-group";
    details.dataset.group = group.id;
    details.open = Boolean(group.open);
    if (group.open) details.dataset.wasOpen = "true";

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = group.label;
    summary.appendChild(title);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "group-reset";
    reset.title = `Reset ${group.label}`;
    reset.setAttribute("aria-label", `Reset ${group.label}`);
    reset.textContent = "Reset";
    reset.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onResetGroup(group);
    });
    summary.appendChild(reset);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "inspector-group-body";
    for (const control of group.controls) {
      body.appendChild(buildControl(control, settings, handlers));
    }
    details.appendChild(body);
    fragment.appendChild(details);
  }
  container.replaceChildren(fragment);
}

export function refreshInspector(container, settings) {
  for (const input of container.querySelectorAll("[data-kind][data-path]")) {
    const path = input.dataset.path;
    const kind = input.dataset.kind;
    const value = readPath(settings, path);
    if (kind === "range") {
      input.value = value;
      input.style.setProperty("--fill", `${fillPercent(
        {
          min: Number(input.min),
          max: Number(input.max),
        },
        value,
      )}%`);
      const output = input.closest(".control")?.querySelector(".control-value");
      if (output) {
        if (input.dataset.percent === "true") {
          output.textContent = `${Math.round(Number(value) * 100)}%`;
        } else if (typeof value === "number") {
          output.textContent = `${value.toFixed(Number(input.dataset.digits) || 0)}${input.dataset.suffix || ""}`;
        } else {
          output.textContent = String(value ?? "");
        }
      }
    } else if (kind === "toggle") {
      input.checked = Boolean(value);
    } else {
      input.value = value ?? "";
      const output = input.closest(".control")?.querySelector(".color-value");
      if (output) output.textContent = value ?? "";
    }
  }
}

export function resetGroupToDefaults(settings, group) {
  for (const control of group.controls) {
    if (control.type === "button-row" || control.key == null) continue;
    writePath(settings, control.key, control.default);
  }
  return settings;
}

export function groupMatchesSettings(group, settings) {
  return group.controls.some((control) => {
    if (control.key == null) return false;
    return JSON.stringify(readPath(settings, control.key)) !== JSON.stringify(control.default);
  });
}

let toastTimer = null;

export function showToast(message, { tone = "info", timeout = 3600 } = {}) {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.textContent = message;
  region.replaceChildren(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 220);
  }, timeout);
}

export function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

export function setStatus(element, message, { busy = false, tone = "" } = {}) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-busy", Boolean(busy));
  element.dataset.tone = tone;
}
