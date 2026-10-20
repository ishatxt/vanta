const ZOOM_STEPS = [10, 16, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class PreviewController {
  constructor({
    stage,
    frame,
    canvas,
    glCanvas,
    beforeCanvas,
    divider,
    emptyState,
    zoomLabel,
    zoomFit,
    zoom100,
    zoomIn,
    zoomOut,
  }) {
    this.stage = stage;
    this.frame = frame;
    this.canvas = canvas;
    this.glCanvas = glCanvas;
    this.beforeCanvas = beforeCanvas;
    this.divider = divider;
    this.emptyState = emptyState;
    this.zoomLabel = zoomLabel;
    this.zoomFit = zoomFit;
    this.zoom100 = zoom100;
    this.zoomIn = zoomIn;
    this.zoomOut = zoomOut;
    this.zoom = { mode: "fit", percent: 100 };
    this.output = null;
    this.compareEnabled = false;
    this.comparePosition = 50;
    this.showBefore = false;
    this.effectiveScale = 1;
    this.dragging = false;
    this.bind();
  }

  bind() {
    this.zoomFit?.addEventListener("click", () => this.setZoom({ mode: "fit", percent: 100 }));
    this.zoom100?.addEventListener("click", () => this.setZoom({ mode: "percent", percent: 100 }));
    this.zoomIn?.addEventListener("click", () => this.zoomStep(1));
    this.zoomOut?.addEventListener("click", () => this.zoomStep(-1));

    const move = (event) => {
      if (!this.dragging) return;
      const rect = this.frame.getBoundingClientRect();
      if (!rect.width) return;
      const percent = ((event.clientX - rect.left) / rect.width) * 100;
      this.setComparePosition(percent);
    };
    const stop = () => {
      this.dragging = false;
      this.frame.classList.remove("is-dragging-compare");
    };

    this.divider?.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.frame.classList.add("is-dragging-compare");
      this.divider.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    this.divider?.addEventListener("pointermove", move);
    this.divider?.addEventListener("pointerup", stop);
    this.divider?.addEventListener("pointercancel", stop);

    this.frame.addEventListener("pointerdown", (event) => {
      if (!this.compareEnabled) return;
      if (event.target === this.divider || this.divider?.contains(event.target)) return;
      this.dragging = true;
      this.frame.setPointerCapture?.(event.pointerId);
      const rect = this.frame.getBoundingClientRect();
      if (rect.width) this.setComparePosition(((event.clientX - rect.left) / rect.width) * 100);
    });
    this.frame.addEventListener("pointermove", move);
    this.frame.addEventListener("pointerup", stop);
    this.frame.addEventListener("pointercancel", stop);
  }

  setOutput({ canvas = null, gl = false, mode = "edit", asciiMeta = null }) {
    this.output = { mode, asciiMeta, gl };
    this.frame.classList.toggle("is-gl", Boolean(gl));
    this.frame.classList.remove("is-empty");

    if (!gl && canvas) {
      if (this.canvas.width !== canvas.width || this.canvas.height !== canvas.height) {
        this.canvas.width = canvas.width;
        this.canvas.height = canvas.height;
      }
      const ctx = this.canvas.getContext("2d");
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(canvas, 0, 0);
    }

    this.applyDisplay();
  }

  setBeforeCanvas(canvas) {
    if (!canvas) return;
    if (this.beforeCanvas.width !== canvas.width || this.beforeCanvas.height !== canvas.height) {
      this.beforeCanvas.width = canvas.width;
      this.beforeCanvas.height = canvas.height;
    }
    const ctx = this.beforeCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.beforeCanvas.width, this.beforeCanvas.height);
    ctx.drawImage(canvas, 0, 0);
  }

  setEmpty(empty) {
    this.frame.classList.toggle("is-empty", empty);
    if (this.emptyState) this.emptyState.hidden = !empty;
    if (empty) this.output = null;
  }

  setShowBefore(show) {
    this.showBefore = Boolean(show);
    this.frame.classList.toggle("show-before", this.showBefore);
  }

  setCompareEnabled(enabled) {
    this.compareEnabled = Boolean(enabled);
    this.frame.classList.toggle("compare-on", this.compareEnabled);
    this.applyDisplay();
  }

  setComparePosition(percent) {
    this.comparePosition = clamp(percent, 1, 99);
    this.frame.style.setProperty("--compare", `${this.comparePosition}%`);
  }

  setZoom(zoom) {
    this.zoom = {
      mode: zoom.mode === "percent" ? "percent" : "fit",
      percent: clamp(Number(zoom.percent) || 100, 5, 800),
    };
    this.applyDisplay();
  }

  zoomStep(direction) {
    const current = this.effectiveScale * 100;
    if (direction > 0) {
      const next = ZOOM_STEPS.find((step) => step > current + 0.5) ?? 400;
      this.setZoom({ mode: "percent", percent: next });
    } else {
      const next = [...ZOOM_STEPS].reverse().find((step) => step < current - 0.5) ?? 10;
      this.setZoom({ mode: "percent", percent: next });
    }
  }

  getDisplaySize() {
    if (!this.output) return { width: 1, height: 1 };
    if (this.output.gl) {
      return { width: this.glCanvas.width || 1, height: this.glCanvas.height || 1 };
    }
    return { width: this.canvas.width || 1, height: this.canvas.height || 1 };
  }

  applyDisplay() {
    if (!this.output) return;
    const { width, height } = this.getDisplaySize();
    const stageWidth = Math.max(80, this.stage.clientWidth - 48);
    const stageHeight = Math.max(80, this.stage.clientHeight - 48);
    let scale;
    if (this.zoom.mode === "fit") {
      scale = Math.min(stageWidth / width, stageHeight / height);
      scale = clamp(scale, 0.02, 8);
    } else {
      scale = clamp(this.zoom.percent / 100, 0.05, 8);
    }
    this.effectiveScale = scale;
    this.frame.style.width = `${Math.max(1, Math.round(width * scale))}px`;
    this.frame.style.height = `${Math.max(1, Math.round(height * scale))}px`;
    this.frame.classList.toggle("at-fit", this.zoom.mode === "fit");
    this.frame.classList.toggle("at-native", this.zoom.mode === "percent" && Math.abs(this.zoom.percent - 100) < 0.5);
    this.zoomFit?.setAttribute("aria-pressed", String(this.zoom.mode === "fit"));
    this.zoom100?.setAttribute("aria-pressed", String(this.zoom.mode === "percent" && Math.abs(this.zoom.percent - 100) < 0.5));
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  resize() {
    if (this.output) this.applyDisplay();
  }
}
