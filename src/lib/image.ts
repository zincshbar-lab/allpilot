"use client";

// Shrinks an uploaded picture into a small square data URL that fits on-chain token metadata.
// JustHoot caps the icon at ~7,000 bytes and nearly.trade at 16 KB, so we aim under 6,900 to fit both.

export const ICON_MAX_CHARS = 6900;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't look like an image."));
    };
    img.src = url;
  });
}

export async function fileToIcon(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please pick an image file (PNG, JPG, WebP, GIF).");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is over 15 MB — pick a smaller one.");
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't resize images here.");

  // center-crop to a square, then try smaller sizes / lower quality until it fits
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  for (const size of [128, 112, 96, 80, 64, 48]) {
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    for (const q of [0.85, 0.7, 0.55, 0.4, 0.3]) {
      const url = canvas.toDataURL("image/webp", q);
      if (url.startsWith("data:image/webp") && url.length <= ICON_MAX_CHARS) return url;
      const jpg = canvas.toDataURL("image/jpeg", q); // browsers without WebP encoding
      if (jpg.length <= ICON_MAX_CHARS) return jpg;
    }
  }
  throw new Error("Couldn't shrink that picture enough — try a simpler image.");
}
