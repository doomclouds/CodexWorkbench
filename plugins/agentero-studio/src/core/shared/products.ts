import { StudioError } from './common.js';
import type { ExportBytes } from './files.js';
import type { ArtifactState, ContentOperation, ProductAdapter, Snapshot } from './model.js';

/** Product-owned creation, rendering and external projections around the shared policies. */
export interface ProductDefinition<C, O extends ContentOperation, A, S> {
  adapter: ProductAdapter<C, O, A, S>;
  title?: string;
  defaultTitle: string;
  create(args: Record<string, unknown>, base?: C): C;
  initialIds(content: C): string[];
  project(snapshot: Snapshot<C>): unknown;
  result(snapshot: Snapshot<C>): Record<string, unknown>;
  read(state: ArtifactState<C, A, S>, mode: string, args: Record<string, unknown>): unknown;
  diff(before: Snapshot<C>, after: Snapshot<C>): Record<string, unknown>;
  rewriteAssetReferences?(content: C, fromArtifactId: string, toArtifactId: string): void;
  validateAsset(mimeType: string): void;
  export(snapshot: Snapshot<C>, format: string, options: Record<string, unknown>, resources?: ExportResources): Promise<ExportBytes>;
  thumbnail?(snapshot: Snapshot<C>, resources: ExportResources): Promise<ExportBytes>;
  decodeLegacy?(value: unknown): ArtifactState<C, A, S> | undefined;
}
export interface ExportResources { assetDataUri(reference: string): Promise<string> }
type RegisteredProduct = ProductDefinition<unknown, ContentOperation, unknown, unknown>;

export class ProductRegistry {
  private readonly entries = new Map<string, RegisteredProduct>();
  register<C, O extends ContentOperation, A, S>(product: ProductDefinition<C, O, A, S>): this {
    const type = product.adapter.type;
    if (this.entries.has(type)) throw new Error(`Duplicate Studio product: ${type}`);
    // Type erasure occurs once at registration; an envelope's type selects the same adapter on every path.
    this.entries.set(type, product as unknown as RegisteredProduct); return this;
  }
  get(type: string): RegisteredProduct {
    const product = this.entries.get(type);
    if (!product) throw new StudioError('UNSUPPORTED_PRODUCT', '此作品类型尚未安装。', { type });
    return product;
  }
  catalog() { return [...this.entries.values()].map(product => ({ type: product.adapter.type, title: product.title ?? product.adapter.type, defaultTitle: product.defaultTitle })); }
  decode(value: unknown): ArtifactState<unknown> {
    for (const product of this.entries.values()) { const decoded = product.decodeLegacy?.(value); if (decoded) return decoded; }
    return value as ArtifactState<unknown>;
  }
  validate(state: ArtifactState<unknown>): void { this.get(state.artifact.type).adapter.validate(state.content); }
}
