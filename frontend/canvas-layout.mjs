export const CANVAS_GRID_COLUMNS = 10;
export const CANVAS_GRID_GAP = 16;
export const CANVAS_GRID_START = Object.freeze({ x: 80, y: 110 });
export const CANVAS_NODE_WIDTH = 260;

export function aspectRatioNumber(value = "3 / 4") {
  const [width, height] = String(value).split(/[:/]/).map(Number);
  return width > 0 && height > 0 ? width / height : 3 / 4;
}

export function estimatedImageNodeHeight(node = {}) {
  const measured = Number(node.measured?.height || node.height);
  if (Number.isFinite(measured) && measured > 0) return measured;
  const ratio = aspectRatioNumber(node.data?.aspectRatio || "3 / 4");
  return 20 + 6 + (CANVAS_NODE_WIDTH / ratio);
}

export function measuredImageNodeWidth(node = {}) {
  const measured = Number(node.measured?.width || node.width);
  return Number.isFinite(measured) && measured > 0 ? measured : CANVAS_NODE_WIDTH;
}

export function nextCanvasNodePosition(nodes = []) {
  const imageNodes = nodes.filter((node) => node?.type === "image");
  if (!imageNodes.length) return { ...CANVAS_GRID_START };

  const index = imageNodes.length;
  const column = index % CANVAS_GRID_COLUMNS;
  const rowStartIndex = index - column;
  if (column > 0) {
    const previous = imageNodes[index - 1];
    const rowStart = imageNodes[rowStartIndex];
    return {
      x: previous.position.x + measuredImageNodeWidth(previous) + CANVAS_GRID_GAP,
      y: rowStart?.position?.y ?? previous.position.y,
    };
  }

  const previousRow = imageNodes.slice(Math.max(0, index - CANVAS_GRID_COLUMNS), index);
  const previousBottom = Math.max(...previousRow.map((node) => node.position.y + estimatedImageNodeHeight(node)));
  return {
    x: imageNodes[0]?.position?.x ?? CANVAS_GRID_START.x,
    y: previousBottom + CANVAS_GRID_GAP,
  };
}

export function centeredLoadingNodePosition({ paneWidth, paneHeight, viewport, aspectRatio = "3 / 4" }) {
  const zoom = Number(viewport?.zoom) > 0 ? Number(viewport.zoom) : 1;
  const viewportX = Number(viewport?.x) || 0;
  const viewportY = Number(viewport?.y) || 0;
  const cardHeight = CANVAS_NODE_WIDTH / aspectRatioNumber(aspectRatio);
  const loadingHeight = 18 + 12 + cardHeight;
  return {
    x: ((Math.max(0, Number(paneWidth) || 0) / 2) - viewportX) / zoom - CANVAS_NODE_WIDTH / 2,
    y: ((Math.max(0, Number(paneHeight) || 0) / 2) - viewportY) / zoom - loadingHeight / 2,
  };
}
