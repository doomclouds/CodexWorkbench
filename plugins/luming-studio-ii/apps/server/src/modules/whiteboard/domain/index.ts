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
  BoardBackupActor,
  BoardBackupArchive,
  BoardBackupAsset,
  BoardBackupDetails,
  BoardBackupHistory,
  BoardBackupMetadata,
  BoardExportAsset,
  BoardExportRejection,
  BoardExportSnapshot,
  BoardExportStale,
  ExportBoardCommand,
  ExportBoardFileCommand,
  ExportBoardResult,
  ExportRenderCommand,
} from './export-types.js';
export {
  maxBoardBackupAssetBytes,
  maxBoardBackupBytes,
  maxExportFileBytes,
} from './export-types.js';
export { selectExportObjects, selectExportRectangle } from './export-scope.js';
export { exportFilename, renderExportFile } from './export-file.js';
export { backupElement, BackupElementError } from './backup-elements.js';
export { legacyBackupFeedback } from './backup-feedback.js';
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
export { adjacentShapeConnector, type BoardCreationAttachment } from './geometry-attachments.js';
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
export { editLinkContent } from './link-content.js';
export {
  archiveImageSource,
  maximumBoardImageBytes,
  planDocumentImageAsset,
  planImageChanges,
  type ImageOperation,
} from './image-edits.js';
export {
  encodeSafeSvgImage,
  looksLikeSvgImage,
  readSafeSvgImage,
  type SafeSvgImage,
} from './svg-image.js';
export { inspectVideo, planVideoChanges, type VideoOperation } from './video-edits.js';
export type {
  AcceptBoardSuggestion,
  BoardReviewActor,
  BoardReviewOrigin,
  BoardReviewSource,
  BoardReviewTarget,
  BoardSuggestion,
  BoardSuggestionChoice,
  BoardSuggestionApplicationState,
  BoardSuggestionClock,
  BoardSuggestionCommandReceipt,
  BoardSuggestionEdit,
  BoardSuggestionFootprint,
  BoardSuggestionList,
  BoardSuggestionOperation,
  BoardSuggestionObjectClocks,
  BoardSuggestionOptionDraft,
  BoardSuggestionOptionRecord,
  BoardSuggestionPreview,
  BoardSuggestionReviewState,
  CreateBoardReviewSource,
  DecodeBoardSuggestionEdit,
  RejectBoardSuggestion,
  StoredBoardSuggestion,
  SubmitBoardSuggestion,
} from './board-suggestions.js';
export { boardWritePayloadLimit } from './board-edits.js';
export { arrangeSelection, selectionFrame } from './geometry-arrange.js';
export {
  objectAllowsStyle,
  styleChangesObjectKind,
  styledObject,
  styledText,
  styleTouchesObject,
  styleTouchesText,
  validStylePatch,
} from './geometry-style.js';
export { clipboardObject } from './clipboard-geometry.js';
export { maximumBoardCustomColors, normalizeBoardCustomColor } from './custom-colors.js';
