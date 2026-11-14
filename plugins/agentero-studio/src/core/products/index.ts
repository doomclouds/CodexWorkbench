import { ProductRegistry } from '../shared/products.js';
import { whiteboardProduct } from './whiteboard.js';

/** Register each installed product here; all products share the same store and policies. */
export function studioProducts(): ProductRegistry { return new ProductRegistry().register(whiteboardProduct); }
