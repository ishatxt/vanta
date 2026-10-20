import { LIMITS } from "./state.js";

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico|tiff?)$/i;

export function validateImageFile(file) {
  if (!file) return "No image was provided.";
  if (typeof file.size === "number" && file.size === 0) return "That file is empty.";
  if (file.size > LIMITS.MAX_FILE_BYTES) {
    return `That image is too large. The limit is ${Math.round(LIMITS.MAX_FILE_BYTES / (1024 * 1024))} MB.`;
  }
  const type = String(file.type || "").toLowerCase();
  if (!type.startsWith("image/") && !IMAGE_EXTENSION.test(file.name || "")) {
    return "Choose a PNG, JPG, WEBP, GIF, BMP, AVIF, or SVG image.";
  }
  return null;
}

export async function decodeImageFile(file) {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("This browser could not decode that image format."));
      if (image.complete && image.naturalWidth > 0) resolve();
    });

    if (typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        if (!image.naturalWidth || !image.naturalHeight) {
          throw new Error("The image could not be decoded.");
        }
      }
    }

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error("The image has no readable dimensions.");

    if (width > LIMITS.MAX_SOURCE_DIMENSION || height > LIMITS.MAX_SOURCE_DIMENSION) {
      throw new Error(`Images are limited to ${LIMITS.MAX_SOURCE_DIMENSION}px on the longest edge.`);
    }
    if (width * height > LIMITS.MAX_SOURCE_PIXELS) {
      throw new Error("That image has too many pixels. Use a file under 80 megapixels.");
    }

    return {
      image,
      url,
      name: file.name || "clipboard-image.png",
      size: file.size,
      type: file.type || "image/*",
      width,
      height,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function isImageFile(file) {
  return Boolean(file && (String(file.type).startsWith("image/") || IMAGE_EXTENSION.test(file.name || "")));
}

export function initImageLoader({
  fileInput,
  openButtons = [],
  dropOverlay = null,
  onFile,
  onError = () => {},
}) {
  let dragDepth = 0;

  const setDrag = (active) => {
    if (dropOverlay) {
      dropOverlay.classList.toggle("is-dragging", active);
      dropOverlay.setAttribute("aria-hidden", String(!active));
    }
    document.body.classList.toggle("is-dragging", active);
  };

  const handleFile = (file) => {
    if (!file) return;
    Promise.resolve(onFile(file)).catch((error) => {
      onError(error?.message || "The image could not be loaded.");
    });
  };

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) handleFile(file);
  });

  for (const button of openButtons) {
    button?.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });
  }

  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    setDrag(true);
  });

  window.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDrag(true);
  });

  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) setDrag(false);
  });

  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    setDrag(false);
    const files = Array.from(event.dataTransfer?.files || []);
    const file = files.find(isImageFile);
    if (file) handleFile(file);
    else if (files.length) onError("Drop an image file to continue.");
  });

  window.addEventListener("dragend", () => {
    dragDepth = 0;
    setDrag(false);
  });

  document.addEventListener("paste", (event) => {
    if (document.querySelector("dialog[open]")) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) {
      return;
    }
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          handleFile(file);
          break;
        }
      }
    }
  });
}
