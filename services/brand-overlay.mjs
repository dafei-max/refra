import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

let pngPromise;
let wasmRendererPromise;
let titleFontPromise;

async function pngCodec() {
  if (!pngPromise) pngPromise = import("pngjs").then((module) => module.PNG || module.default?.PNG);
  return pngPromise;
}

async function wasmRenderer() {
  if (!wasmRendererPromise) {
    wasmRendererPromise = Promise.all([
      import("@resvg/resvg-wasm"),
      readFile(new URL("../node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url)),
    ]).then(async ([renderer, wasmBytes]) => {
      await renderer.initWasm(wasmBytes);
      return renderer;
    }).catch((error) => {
      wasmRendererPromise = null;
      throw error;
    });
  }
  return wasmRendererPromise;
}

async function titleFont(fontPath) {
  if (!fontPath) throw new Error("缺少搜索框标题字体");
  if (!titleFontPromise) {
    titleFontPromise = readFile(fontPath)
      .catch((error) => {
        titleFontPromise = null;
        throw error;
      });
  }
  return titleFontPromise;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function decodePng(bytes, label) {
  const PNG = await pngCodec();
  try {
    return PNG.sync.read(bytes);
  } catch (error) {
    throw new Error(`${label}不是有效的 PNG 图片：${error.message}`);
  }
}

function resizeRgba(source, targetWidth) {
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(source.height * width / source.width));
  const data = Buffer.alloc(width * height * 4);
  const xScale = source.width / width;
  const yScale = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, (y + 0.5) * yScale - 0.5);
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const yMix = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, (x + 0.5) * xScale - 0.5);
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const xMix = sourceX - x0;
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = source.data[(y0 * source.width + x0) * 4 + channel];
        const topRight = source.data[(y0 * source.width + x1) * 4 + channel];
        const bottomLeft = source.data[(y1 * source.width + x0) * 4 + channel];
        const bottomRight = source.data[(y1 * source.width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * xMix;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xMix;
        data[destination + channel] = Math.round(top + (bottom - top) * yMix);
      }
    }
  }
  return { width, height, data };
}

function averageLuminance(image, { left, top, width, height }) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  const right = Math.min(image.width, left + width);
  const bottom = Math.min(image.height, top + height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4;
      red += image.data[offset];
      green += image.data[offset + 1];
      blue += image.data[offset + 2];
      count += 1;
    }
  }
  if (!count) return 0;
  return 0.2126 * red / count + 0.7152 * green / count + 0.0722 * blue / count;
}

function compositeOver(base, layer, left, top) {
  for (let y = 0; y < layer.height; y += 1) {
    const destinationY = top + y;
    if (destinationY < 0 || destinationY >= base.height) continue;
    for (let x = 0; x < layer.width; x += 1) {
      const destinationX = left + x;
      if (destinationX < 0 || destinationX >= base.width) continue;
      const sourceOffset = (y * layer.width + x) * 4;
      const destinationOffset = (destinationY * base.width + destinationX) * 4;
      const sourceAlpha = layer.data[sourceOffset + 3] / 255;
      if (sourceAlpha <= 0) continue;
      const destinationAlpha = base.data[destinationOffset + 3] / 255;
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceValue = layer.data[sourceOffset + channel];
        const destinationValue = base.data[destinationOffset + channel];
        base.data[destinationOffset + channel] = outputAlpha > 0
          ? Math.round((sourceValue * sourceAlpha + destinationValue * destinationAlpha * (1 - sourceAlpha)) / outputAlpha)
          : 0;
      }
      base.data[destinationOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
}

function titleWidthUnits(title) {
  return Array.from(title).reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.35;
    if (/^[\x00-\x7F]$/.test(character)) return total + 0.62;
    return total + 1;
  }, 0);
}

function fitTitle(title, maximumWidth, maximumSize, minimumSize) {
  const units = Math.max(1, titleWidthUnits(title));
  const fontSize = Math.max(minimumSize, Math.min(maximumSize, Math.floor(maximumWidth / units)));
  if (units * fontSize <= maximumWidth) return { text: title, fontSize };
  const characters = Array.from(title);
  while (characters.length > 1 && titleWidthUnits(`${characters.join("")}…`) * minimumSize > maximumWidth) {
    characters.pop();
  }
  return { text: `${characters.join("")}…`, fontSize: minimumSize };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function drawSearchTitle(layer, title, fontPath) {
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle) return null;
  const [fontBytes, renderer] = await Promise.all([titleFont(fontPath), wasmRenderer()]);
  const fieldLeft = Math.round(layer.width * 0.335);
  const fieldRight = Math.round(layer.width * 0.916);
  const fieldTop = Math.round(layer.height * 0.642);
  const fieldBottom = Math.round(layer.height * 0.946);
  const maximumWidth = Math.max(1, fieldRight - fieldLeft - Math.round(layer.width * 0.035));
  const maximumSize = Math.max(10, Math.round(layer.width * 0.052));
  const minimumSize = Math.max(8, Math.round(layer.width * 0.032));
  const fitted = fitTitle(normalizedTitle, maximumWidth, maximumSize, minimumSize);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layer.width}" height="${layer.height}">`,
    `<text x="${(fieldLeft + fieldRight) / 2}" y="${(fieldTop + fieldBottom) / 2}"`,
    ` text-anchor="middle" dominant-baseline="central" fill="#121212"`,
    ` font-family="Douyin Sans" font-size="${fitted.fontSize}" font-weight="700">`,
    `${escapeXml(fitted.text)}</text></svg>`,
  ].join("");
  const resvg = new renderer.Resvg(svg, {
    font: {
      fontBuffers: [fontBytes],
      defaultFontFamily: "Douyin Sans",
      sansSerifFamily: "Douyin Sans",
    },
    textRendering: 2,
  });
  const rendered = resvg.render();
  try {
    compositeOver(layer, {
      width: rendered.width,
      height: rendered.height,
      data: Buffer.from(rendered.pixels),
    }, 0, 0);
  } finally {
    rendered.free();
    resvg.free();
  }
  return fitted;
}

async function resizedLayer(assetPath, width, label) {
  return resizeRgba(await decodePng(await readFile(assetPath), label), width);
}

export async function applyBrandOverlays(filePath, options = {}) {
  const includeLogo = options.includeLogo !== false;
  const includeSearch = options.includeSearch !== false;
  if (!includeLogo && !includeSearch) return { logo: null, search: null };

  const base = await decodePng(await readFile(filePath), "源图");
  let logo = null;
  let search = null;

  if (includeLogo && options.darkLogoPath && options.lightLogoPath) {
    const left = clamp(Math.round(options.logoLeft || 0), 0, Math.max(0, base.width - 1));
    const top = clamp(Math.round(options.logoTop || 0), 0, Math.max(0, base.height - 1));
    const width = clamp(Math.round(options.logoWidth || 1), 1, Math.max(1, base.width - left));
    const darkLayer = await resizedLayer(options.darkLogoPath, width, "深色背景 Logo 素材");
    const luminance = averageLuminance(base, { left, top, width, height: darkLayer.height });
    const assetPath = luminance >= 150 ? options.lightLogoPath : options.darkLogoPath;
    const layer = assetPath === options.darkLogoPath
      ? darkLayer
      : await resizedLayer(assetPath, width, "浅色背景 Logo 素材");
    compositeOver(base, layer, left, top);
    logo = { path: assetPath, name: path.basename(assetPath), luminance, left, top, width, height: layer.height };
  }

  if (includeSearch && options.searchLightPath && options.searchDarkPath) {
    const right = Math.max(0, Math.round(options.searchRight || 0));
    const bottom = Math.max(0, Math.round(options.searchBottom || 0));
    const width = Math.min(Math.max(1, Math.round(options.searchWidth || 1)), Math.max(1, base.width - right));
    const lightLayer = await resizedLayer(options.searchLightPath, width, "浅色背景搜索框素材");
    const left = Math.max(0, base.width - right - width);
    const top = Math.max(0, base.height - bottom - lightLayer.height);
    const luminance = averageLuminance(base, { left, top, width, height: lightLayer.height });
    const assetPath = luminance >= 150 ? options.searchLightPath : options.searchDarkPath;
    const layer = assetPath === options.searchLightPath
      ? lightLayer
      : await resizedLayer(assetPath, width, "深色背景搜索框素材");
    const renderedTitle = await drawSearchTitle(layer, options.campaignName, options.fontPath);
    compositeOver(base, layer, left, top);
    search = {
      path: assetPath,
      name: path.basename(assetPath),
      luminance,
      left,
      top,
      width,
      height: layer.height,
      title: renderedTitle?.text || "",
      titleFontSize: renderedTitle?.fontSize || 0,
    };
  }

  const PNG = await pngCodec();
  await writeFile(filePath, PNG.sync.write(base));
  return { logo, search };
}
