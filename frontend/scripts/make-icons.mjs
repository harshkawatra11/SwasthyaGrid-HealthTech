#!/usr/bin/env node
// Generates the browser tab icon (icon.png) and Apple touch icon
// (apple-icon.png) from the brand logo, padded onto a transparent square
// canvas so the gear mark is never clipped or stretched.
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.join(root, "public", "brand", "swasthyagrid-logo.png");
const appDir = path.join(root, "src", "app");

async function makeIcon(size, outName) {
  const padding = Math.round(size * 0.08);
  const inner = size - padding * 2;
  const resized = await sharp(source)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, top: padding, left: padding }])
    .png()
    .toFile(path.join(appDir, outName));
  console.log(`wrote ${outName} (${size}x${size})`);
}

await makeIcon(512, "icon.png");
await makeIcon(180, "apple-icon.png");
