import { ProductRegistry } from '../shared/products.js';
import { whiteboardProduct } from './whiteboard.js';

export function studioProducts(): ProductRegistry {
  return new ProductRegistry().register(whiteboardProduct);
}
