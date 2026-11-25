import { documentExtension } from './document/index.js';
import { chartExtension, diagramExtension, htmlExtension } from './embed/index.js';
import { imageExtension, linkExtension, videoExtension } from './media/index.js';
import { stickerExtension } from './sticker/index.js';
import { tableExtension } from './table/index.js';
import {
  connectorExtension,
  noteExtension,
  sectionExtension,
  shapeExtension,
  textExtension,
} from './text/index.js';
import { todoExtension } from './todo/index.js';

export const studioObjectExtensions = Object.freeze([
  shapeExtension,
  sectionExtension,
  connectorExtension,
  textExtension,
  noteExtension,
  stickerExtension,
  htmlExtension,
  diagramExtension,
  chartExtension,
  documentExtension,
  todoExtension,
  tableExtension,
  imageExtension,
  videoExtension,
  linkExtension,
]);
