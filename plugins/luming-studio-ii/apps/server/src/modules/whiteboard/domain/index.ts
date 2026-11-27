export type {
  Actor,
  Appearance,
  BoardAccess,
  BoardHeader,
  BoardObject,
  BoardScene,
  CommandReceipt,
  ConnectorDetail,
  ConnectorEndpoint,
  ConnectorHead,
  ConnectorPort,
  Geometry,
  GeometryDetail,
  JsonObject,
  JsonValue,
  MoveApplied,
  MoveCommand,
  MoveConflict,
  MoveDelta,
  MoveOutcome,
  MoveRejected,
  MoveRejectionReason,
  MoveTarget,
  PayloadRecord,
  PayloadResult,
  Point,
  StoredReceipt,
} from './model.js';
export type {
  BoardExportAsset,
  BoardExportRejection,
  BoardExportSnapshot,
  BoardExportStale,
  ExportBoardCommand,
  ExportBoardResult,
} from './export-types.js';
export { selectExportObjects } from './export-scope.js';
export { renderExportFile } from './export-file.js';
export {
  canAdvanceVersion,
  canTranslate,
  commandSignature,
  hasValidMoveInput,
  translateObject,
} from './movement.js';
export { isSupportedPayload } from './payload.js';
export { sectionContains } from './section.js';
export type {
  BoardChanges,
  BoardEditApplied,
  BoardEditAsset,
  BoardEditConflict,
  BoardEditDecision,
  BoardEditIdentity,
  BoardEditReceipt,
  BoardEditRejected,
  BoardEditRejection,
  BoardVersionCommit,
  BoardVersionKind,
  BoardVersionSummary,
  StoredBoardEditReceipt,
} from './board-edits.js';
export type {
  GeometryLayerDirection,
  GeometryObjectChange,
  GeometryOperation,
  GeometryTransformKind,
} from './geometry-edits.js';
export {
  advanceGeometry,
  connectorAttachmentIds,
  geometryInWorld,
  hasValidConnectorGeometry,
  hasValidEditInk,
  validateCreatedObject,
  validNewObjectId,
} from './geometry-edits.js';
export { initialGeometryPayload, supportsGeometryCreation } from './geometry-edit-payloads.js';
export type {
  ContentOperation,
  TodoContentEdit,
  TodoContentPlacement,
  TodoContentSource,
} from './object-content-edits.js';
export { editDocumentContent } from './object-content-edits-document.js';
export { editTextContent } from './object-content-edits-text.js';
export { editTodoContent } from './object-content-edits-todo.js';
export { editTableContent, tableContentIssue } from './object-content-edits-table.js';
export { editEmbedSource, editEmbedState } from './object-content-edits-embed.js';
export { editImageCrop, editStickerContent } from './object-content-edits-media.js';
export { planImageChanges, type ImageOperation } from './image-edits.js';
export type {
  AcceptBoardSuggestion,
  BoardReviewActor,
  BoardReviewOrigin,
  BoardReviewSource,
  BoardReviewTarget,
  BoardSuggestion,
  BoardSuggestionChoice,
  BoardSuggestionCommandReceipt,
  BoardSuggestionEdit,
  BoardSuggestionList,
  BoardSuggestionOperation,
  BoardSuggestionOptionDraft,
  BoardSuggestionOptionRecord,
  BoardSuggestionPreview,
  CreateBoardReviewSource,
  DecodeBoardSuggestionEdit,
  RejectBoardSuggestion,
  StoredBoardSuggestion,
  SubmitBoardSuggestion,
} from './board-suggestions.js';
export { boardWritePayloadLimit } from './board-edits.js';
