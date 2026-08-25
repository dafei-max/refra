import test from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_GRID_GAP,
  CANVAS_GRID_START,
  CANVAS_NODE_WIDTH,
  centeredLoadingNodePosition,
  nextCanvasNodePosition,
} from "../frontend/canvas-layout.mjs";

function appendNode(nodes, height = 380) {
  const position = nextCanvasNodePosition(nodes);
  return [...nodes, {
    id: `node-${nodes.length + 1}`,
    type: "image",
    position,
    measured: { width: CANVAS_NODE_WIDTH, height },
    data: { aspectRatio: "3 / 4" },
  }];
}

test("canvas auto layout uses ten columns with an exact 16px gap", () => {
  let nodes = [];
  for (let index = 0; index < 10; index += 1) nodes = appendNode(nodes, index === 4 ? 420 : 380);

  assert.deepEqual(nodes[0].position, CANVAS_GRID_START);
  for (let index = 1; index < 10; index += 1) {
    assert.equal(nodes[index].position.x - (nodes[index - 1].position.x + CANVAS_NODE_WIDTH), CANVAS_GRID_GAP);
    assert.equal(nodes[index].position.y, CANVAS_GRID_START.y);
  }

  nodes = appendNode(nodes);
  assert.equal(nodes[10].position.x, CANVAS_GRID_START.x);
  assert.equal(nodes[10].position.y, CANVAS_GRID_START.y + 420 + CANVAS_GRID_GAP);

  nodes = appendNode(nodes);
  assert.equal(nodes[11].position.x - (nodes[10].position.x + CANVAS_NODE_WIDTH), CANVAS_GRID_GAP);
  assert.equal(nodes[11].position.y, nodes[10].position.y);
});

test("loading node remains centered while the viewport pans and zooms", () => {
  const position = centeredLoadingNodePosition({
    paneWidth: 1000,
    paneHeight: 800,
    viewport: { x: 100, y: 50, zoom: 2 },
    aspectRatio: "1 / 1",
  });
  const loadingHeight = 18 + 12 + CANVAS_NODE_WIDTH;
  const screenCenterX = position.x * 2 + 100 + (CANVAS_NODE_WIDTH / 2) * 2;
  const screenCenterY = position.y * 2 + 50 + (loadingHeight / 2) * 2;
  assert.equal(screenCenterX, 500);
  assert.equal(screenCenterY, 400);
});
