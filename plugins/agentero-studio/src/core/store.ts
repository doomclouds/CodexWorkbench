import { studioProducts } from './products/index.js';
import { ArtifactStore } from './shared/store.js';
import type { ProductRegistry } from './shared/products.js';

export class StudioStore extends ArtifactStore<unknown> {
  constructor(root?: string, products: ProductRegistry = studioProducts()) { super(root, value => products.decode(value), state => products.validate(state)); }
}
export { atomicWrite, copy, safeId, StudioError } from './shared/common.js';
export { makeHistory } from './shared/history.js';
export type { AssetRecord } from './shared/model.js';
export type ArtifactState = import('./shared/model.js').ArtifactState<unknown>;
