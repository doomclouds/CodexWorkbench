import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectionPathData,
  connectorArrowPoints,
  resolveConnectorRoute,
} from '@codexworkbench/luming-studio-ii-whiteboard-shared/connector-route';
import {
  parseRichText,
  richTextFirstLine,
} from '@codexworkbench/luming-studio-ii-whiteboard-shared/rich-text';
import {
  stickerCatalog,
  stickerDefinition,
  stickerSvgContent,
} from '@codexworkbench/luming-studio-ii-whiteboard-shared/stickers';
import vectors from './whiteboard-behavior-vectors.json' with { type: 'json' };

for (const vector of vectors.connectorRoutes) {
  test(vector.name, () => {
    const points = resolveConnectorRoute(
      vector.start,
      vector.end,
      vector.bends,
      vector.relativeBends,
    );
    assert.deepEqual(points, vector.points);
    assert.equal(connectionPathData(points), vector.svgPath);
    assert.deepEqual(connectorArrowPoints(points, false, vector.strokeWidth), vector.endArrow);
  });
}

for (const vector of vectors.richText) {
  test(vector.name, () => {
    assert.deepEqual(parseRichText(vector.input), vector.lines);
    assert.equal(richTextFirstLine(vector.input), vector.firstLine);
  });
}

for (const { id, graphics, svgParts } of vectors.stickers) {
  test(`resolves the sticker graphics and SVG for ${id}`, () => {
    const definition = stickerDefinition(id);
    const svg = stickerSvgContent(id);
    assert.equal(
      stickerCatalog.some((entry) => entry.id === id),
      graphics !== null,
    );
    assert.deepEqual(definition?.graphics ?? null, graphics);

    if (svgParts === null) {
      assert.equal(svg, undefined);
      return;
    }

    assert.ok(svg);
    for (const part of svgParts) {
      assert.ok(svg.includes(part), part);
    }
  });
}
