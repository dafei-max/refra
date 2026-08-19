import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeMarkup(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textUnits(value) {
  return [...value].reduce((total, character) => total + (/^[\x00-\x7F]$/.test(character) ? 0.56 : 1), 0);
}

function fittedTitle(value, maxWidth, preferredSize) {
  let title = String(value || "").replace(/\s+/g, " ").trim();
  if (!title) return { text: "", fontSize: preferredSize };
  let fontSize = Math.max(10, Math.min(preferredSize, Math.floor(maxWidth / Math.max(1, textUnits(title)))));
  if (textUnits(title) * fontSize <= maxWidth) return { text: title, fontSize };
  const suffix = "…";
  while (title && (textUnits(title) + textUnits(suffix)) * fontSize > maxWidth) title = title.slice(0, -1);
  return { text: title ? `${title}${suffix}` : "", fontSize };
}

let embeddedFontPromise;

async function embeddedFont(fontPath) {
  if (!embeddedFontPromise) embeddedFontPromise = readFile(fontPath).then((font) => font.toString("base64"));
  return embeddedFontPromise;
}

async function averageLuminance(image, { left, top, width, height }) {
  if (width <= 0 || height <= 0) return 0;
  const { channels } = await sharp(image).extract({ left, top, width, height }).stats();
  const [red = {}, green = {}, blue = {}] = channels;
  return 0.2126 * Number(red.mean || 0) + 0.7152 * Number(green.mean || 0) + 0.0722 * Number(blue.mean || 0);
}

async function resizedLayer(assetPath, width) {
  return sharp(await readFile(assetPath))
    .resize({ width, kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function addSearchTitle(layer, title, fontPath) {
  const left = Math.round(layer.info.width * 0.40);
  const top = Math.round(layer.info.height * 0.68);
  const width = Math.max(1, Math.round(layer.info.width * 0.84) - left);
  const height = Math.max(1, Math.round(layer.info.height * 0.95) - top);
  const fitted = fittedTitle(title, width, Math.max(10, Math.round(layer.info.width * 0.052)));
  if (!fitted.text) return layer.data;
  const fontData = await embeddedFont(fontPath);
  const textSvg = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    "<style>@font-face{font-family:DouyinSans;src:url(data:font/otf;base64,",
    fontData,
    ") format('opentype')}</style>",
    `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central" font-family="DouyinSans" font-size="${fitted.fontSize}" fill="#121212">`,
    escapeMarkup(fitted.text),
    "</text></svg>",
  ].join(""));
  return sharp(layer.data)
    .composite([{
      input: textSvg,
      left,
      top,
    }])
    .png()
    .toBuffer();
}

export async function applyBrandOverlays(filePath, options = {}) {
  const includeLogo = options.includeLogo !== false;
  const includeSearch = options.includeSearch !== false;
  if (!includeLogo && !includeSearch) return { logo: null, search: null };

  const normalized = await sharp(await readFile(filePath))
    .rotate()
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  const baseWidth = normalized.info.width;
  const baseHeight = normalized.info.height;
  const composites = [];
  let logo = null;
  let search = null;

  if (includeLogo && options.darkLogoPath && options.lightLogoPath) {
    const left = clamp(Math.round(options.logoLeft || 0), 0, Math.max(0, baseWidth - 1));
    const top = clamp(Math.round(options.logoTop || 0), 0, Math.max(0, baseHeight - 1));
    const width = clamp(Math.round(options.logoWidth || 1), 1, Math.max(1, baseWidth - left));
    const probe = await resizedLayer(options.darkLogoPath, width);
    const sampleHeight = Math.min(probe.info.height, baseHeight - top);
    const luminance = await averageLuminance(normalized.data, { left, top, width, height: sampleHeight });
    const assetPath = luminance >= 150 ? options.lightLogoPath : options.darkLogoPath;
    const layer = assetPath === options.darkLogoPath ? probe : await resizedLayer(assetPath, width);
    composites.push({ input: layer.data, left, top, blend: "over" });
    logo = { path: assetPath, name: path.basename(assetPath), luminance, left, top, width, height: layer.info.height };
  }

  if (includeSearch && options.searchLightPath && options.searchDarkPath) {
    const right = Math.max(0, Math.round(options.searchRight || 0));
    const bottom = Math.max(0, Math.round(options.searchBottom || 0));
    const requestedWidth = Math.max(1, Math.round(options.searchWidth || 1));
    const width = Math.min(requestedWidth, Math.max(1, baseWidth - right));
    const probe = await resizedLayer(options.searchLightPath, width);
    const left = Math.max(0, baseWidth - right - width);
    const top = Math.max(0, baseHeight - bottom - probe.info.height);
    const sampleHeight = Math.min(probe.info.height, baseHeight - top);
    const luminance = await averageLuminance(normalized.data, { left, top, width, height: sampleHeight });
    const assetPath = luminance >= 150 ? options.searchLightPath : options.searchDarkPath;
    const layer = assetPath === options.searchLightPath ? probe : await resizedLayer(assetPath, width);
    const input = await addSearchTitle(layer, options.campaignName, options.fontPath);
    composites.push({ input, left, top, blend: "over" });
    search = { path: assetPath, name: path.basename(assetPath), luminance, left, top, width, height: layer.info.height };
  }

  const output = composites.length
    ? await sharp(normalized.data).composite(composites).png().toBuffer()
    : normalized.data;
  await writeFile(filePath, output);
  return { logo, search };
}
