import { whiteboardProduct } from './features/whiteboard/whiteboard';
import type { ProductDescriptor } from './product-contract';

export const products: readonly ProductDescriptor[] = [whiteboardProduct];

export function getProduct(type: string): ProductDescriptor | undefined {
  return products.find((product) => product.id === type);
}
