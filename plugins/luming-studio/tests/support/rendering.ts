import { exportArtifact as exportWithRenderer } from '../../src/core/export.js';
import { captureSavedRegion as captureWithRenderer } from '../../src/core/products/scoped-capture.js';
import { renderSvgPng } from '../../src/infrastructure/png-renderer.js';

export const exportArtifact = exportWithRenderer.bind(undefined, renderSvgPng);
export const captureSavedRegion = captureWithRenderer.bind(undefined, renderSvgPng);
