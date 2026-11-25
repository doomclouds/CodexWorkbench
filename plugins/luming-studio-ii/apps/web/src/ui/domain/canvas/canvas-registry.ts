import { builtInObjectExtensions } from './adapters/index.js';
import type { CanvasObjectExtension, CanvasObjectKind, CanvasObjectRegistry } from './contracts.js';

export function createCanvasObjectRegistry(
  extensions: readonly CanvasObjectExtension[] | undefined,
): CanvasObjectRegistry {
  const byKind = new Map(builtInObjectExtensions.map((extension) => [extension.kind, extension]));
  const customized = new Set<CanvasObjectKind>();
  for (const extension of extensions ?? []) {
    const { kind, placement, capabilities } = extension;
    if (customized.has(kind)) {
      throw new Error('Canvas object extension is registered twice: ' + kind);
    }
    if (placement && placement.kind !== kind) {
      throw new Error(
        'Canvas object placement kind differs from the registered extension: ' + kind,
      );
    }

    customized.add(kind);
    byKind.set(
      kind,
      Object.freeze({ ...extension, capabilities: Object.freeze({ ...capabilities }) }),
    );
  }

  return { get: (kind) => byKind.get(kind) };
}
