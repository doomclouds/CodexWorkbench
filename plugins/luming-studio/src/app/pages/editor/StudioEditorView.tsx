import { STUDIO_HOME_TITLE } from '../../../contracts/branding.js';
import './editor-shell.css';
import {
  useRef,
  useState,
  type ComponentType,
  type SubmitEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  MessageSquare,
  Moon,
  RefreshCw,
  Share2,
  Sun,
  Users,
} from 'lucide-react';
import type {
  Actor,
  AgentTaskReleaseTarget,
  Anchor,
  CollaborationRoom,
  Feedback,
  Presence,
  RoomTimer,
  StudioClient,
} from '../../../contracts/studio';
import type {
  ProductActivity,
  ProductAnnotation,
  ProductEditorProps,
  StudioDocument,
  Viewport,
} from '../../product-contract';
import {
  OnlineParticipants,
  SharePanel,
  TimerControl,
  type EditorExportFormat,
  type EditorShareState,
  type ShareRole,
  type SharingAction,
  type SharingOptions,
  type TimerAction,
} from '../../features/collaboration';
import { EditorPopover } from '../../shared/editor-panels';
import type { ProposalOperation } from '../../../contracts/proposals';
import type { CommentAction, CommentActionArguments } from '../../shared/comments/comment-action';
import type { CommentPoint } from '../../shared/comments/comment-target';
import type { SessionStatus } from '../../shared/session-status';
import {
  CommentComposer,
  CommentPopover,
  CommentThread,
  CommentsPanel,
  DocumentAnchorNotice,
  SuggestionPanel,
  type CommentSelection,
} from '../../features/feedback';
import {
  HistoryControl,
  HistoryPreviewControls,
  type VersionHistoryView,
} from '../../features/history';
import { SaveStatus } from '../../shared/SaveStatus';

export type EditorPanel = 'feedback' | 'history' | 'share';
type SaveActivity = Pick<ProductActivity, 'dirty' | 'saving' | 'saveError'>;
interface EditorViewData {
  ProductEditor: ComponentType<ProductEditorProps>;
  productLabel: string;
  exportFormats: readonly { format: Exclude<EditorExportFormat, 'zip'>; label: string }[];
  activeId: string;
  actor: Actor;
  board: StudioDocument | null;
  client: StudioClient;
  busy: string;
  canComment: boolean;
  canEdit: boolean;
  canManage: boolean;
  sessionStatus: SessionStatus;
  resolvedTheme: 'light' | 'dark';
  saveActivity: SaveActivity;
  sync: 'loading' | 'saved' | 'reconnecting';
  panel: EditorPanel | null;
  share: EditorShareState | null;
  sessionShareAccess: EditorShareState['access'];
  history: VersionHistoryView;
  suggestionPreview: StudioDocument | null;
  previewing: boolean;
  clockOffsetMs: number;
  following: string;
  followedPeer?: Presence;
  peers: Presence[];
  peerId: string;
  room: CollaborationRoom;
  roomTimer: RoomTimer | null;
  timerBusy: boolean;
  readingSnapshotId?: string;
  panelViewId?: string;
  externalViewport?: Viewport;
  targetSelection?: string[];
  error: string;
  activeFeedback?: Feedback;
  feedback: Feedback[];
  pendingAttachments: Feedback[];
  attachingId: string;
  selectedFeedback: CommentSelection | null;
  annotation: ProductAnnotation | null;
  annotationActive: boolean;
  commentOpen: boolean;
  commentError: string;
  feedbackText: string;
  attachComment: boolean;
  savedComment: Feedback | null;
  replies: Record<string, string>;
  showResolved: boolean;
}
interface EditorViewActions {
  goHome: () => void;
  submitTitle: (artifactId: string, title: string) => void;
  changeTheme: (theme: 'light' | 'dark') => void;
  togglePanel: (panel: EditorPanel) => void;
  closePanel: () => void;
  handleFollow: (id: string) => void;
  stopFollowing: () => void;
  releaseAgentTask?: (target: AgentTaskReleaseTarget) => Promise<void>;
  changeSharing: (action: SharingAction, options?: SharingOptions) => Promise<boolean>;
  handleCopy: (link: string | undefined, role?: ShareRole) => void;
  exportBoard: (format: EditorExportFormat) => void;
  refreshBoard: () => void;
  handleCanvasArea: (node: HTMLDivElement | null) => void;
  acceptBoard: (board: StudioDocument) => void;
  editorActivityChanged: (activity: ProductActivity) => void;
  selectionChanged: (ids: string[]) => void;
  viewportChanged: (viewport: Viewport) => void;
  cursorMoved: (location: { x: number; y: number } | null) => void;
  readingChanged: (active: boolean, kind?: 'canvas' | 'document') => void;
  changeTimer: (action: TimerAction, durationSeconds?: number, deltaSeconds?: number) => void;
  fail: (cause: unknown) => void;
  inform: (message: string) => void;
  annotate: (annotation: ProductAnnotation) => void;
  changeAnnotationMode: (active: boolean) => void;
  onCommentSurface: (anchor?: Anchor) => boolean;
  commentPoint: (
    anchor: Anchor,
    feedbackId?: string,
    fallback?: CommentPoint,
  ) => CommentPoint | undefined;
  selectFeedback: (item: Feedback, point?: CommentPoint, inList?: boolean) => void;
  changeReplyText: (id: string, text: string) => void;
  feedbackAction: (
    action: CommentAction,
    item: Feedback,
    args?: CommentActionArguments,
  ) => Promise<Feedback | null>;
  attachFeedback: (item: Feedback) => Promise<void>;
  hideCommentDraft: () => void;
  changeCommentText: (text: string) => void;
  changeCommentAttachment: (attach: boolean) => void;
  createFeedback: (event: SubmitEvent) => void;
  changeShowResolved: (show: boolean) => void;
  dismissComment: () => void;
  collapseListedComment: () => void;
  closeCommentsPanel: () => void;
  previewSuggestion: (item: Feedback, operations: ProposalOperation[] | null) => void;
}

export interface StudioEditorViewProps {
  data: EditorViewData;
  actions: EditorViewActions;
}

type EditorSectionProps = { state: EditorViewData & EditorViewActions };

export function StudioEditorView({
  data,
  actions,
  documentFocusActive,
}: StudioEditorViewProps & { documentFocusActive: boolean }) {
  const state = { ...data, ...actions };
  const {
    activeFeedback,
    annotation,
    busy,
    canComment,
    canEdit,
    commentOpen,
    followedPeer,
    following,
    history,
    onCommentSurface,
    selectedFeedback,
    stopFollowing,
  } = state;

  return (
    <>
      <header className="studio-editor-header">
        <StudioEditorTitle state={state} documentFocusActive={documentFocusActive} />
        <StudioEditorActions state={state} />
      </header>
      <HistoryPreviewControls history={history} canEdit={canEdit} busy={!!busy} />
      {following && (
        <div className="studio-follow-banner">
          <Users size={14} />
          <span>
            正在跟随 {followedPeer?.actor.name || '协作者'} 的
            {followedPeer?.actor.kind === 'agent' ? '工作区' : '视角'}
          </span>
          <button className="studio-link-button" onClick={stopFollowing}>
            停止跟随
          </button>
        </div>
      )}
      <StudioWorkspace state={state} />
      {onCommentSurface(annotation?.anchor) && commentOpen && annotation && canComment && (
        <StudioCommentDraft state={state} annotation={annotation} />
      )}
      {onCommentSurface(activeFeedback?.anchor) &&
        activeFeedback &&
        selectedFeedback &&
        !selectedFeedback.inList && (
          <StudioCommentDetails
            state={state}
            activeFeedback={activeFeedback}
            selectedFeedback={selectedFeedback}
          />
        )}{' '}
    </>
  );
}

function StudioEditorTitle({
  state,
  documentFocusActive,
}: EditorSectionProps & { documentFocusActive: boolean }) {
  const {
    board,
    canEdit,
    canManage,
    goHome,
    history,
    productLabel,
    saveActivity,
    sessionStatus,
    submitTitle,
    sync,
  } = state;
  const artifactId = board?.artifact.id;
  const title = board?.artifact.title || '';
  const [edit, setEdit] = useState({ artifactId, title, draft: title });
  const skipTitleBlurRef = useRef(false);
  if (edit.artifactId !== artifactId || edit.title !== title) {
    setEdit({ artifactId, title, draft: title });
  }

  function changeDraft(draft: string) {
    setEdit({ artifactId, title, draft });
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      skipTitleBlurRef.current = true;
      changeDraft(title);
      event.currentTarget.blur();
    }
  }

  function handleTitleBlur() {
    if (skipTitleBlurRef.current) {
      skipTitleBlurRef.current = false;
      return;
    }
    if (!canManage) {
      return;
    }

    const draft = edit.draft.trim();
    if (!draft) {
      changeDraft(title);
      return;
    }
    if (artifactId && draft !== title) {
      submitTitle(artifactId, draft);
    }
  }

  return (
    <div className="studio-editor-title">
      {canManage && !documentFocusActive && (
        <button
          className="studio-icon-button"
          aria-label={`返回 ${STUDIO_HOME_TITLE}`}
          onClick={goHome}
        >
          <ArrowLeft size={20} />
        </button>
      )}
      {!canManage && <Share2 size={22} className="studio-guest-brand" />}
      <input
        aria-label={`${productLabel}名称`}
        value={edit.draft}
        readOnly={!canManage || !!history.preview}
        onChange={(event) => changeDraft(event.currentTarget.value)}
        onKeyDown={handleTitleKeyDown}
        onBlur={handleTitleBlur}
      />
      <SaveStatus activity={saveActivity} sync={sync} session={sessionStatus} canEdit={canEdit} />
    </div>
  );
}

function StudioEditorActions({ state }: EditorSectionProps) {
  const {
    actor,
    board,
    busy,
    canEdit,
    clockOffsetMs,
    closePanel,
    following,
    handleFollow,
    history,
    panel,
    peers,
    previewing,
    releaseAgentTask,
    share,
    sessionShareAccess,
    togglePanel,
  } = state;
  const shareButton = useRef<HTMLButtonElement>(null);

  return (
    <div className="studio-editor-actions">
      <OnlineParticipants
        peers={peers}
        actor={actor}
        following={following}
        document={board}
        clockOffsetMs={clockOffsetMs}
        preview={previewing}
        onReleaseAgentTask={releaseAgentTask}
        onFollow={handleFollow}
      />
      <HistoryControl
        actor={actor}
        currentRevision={board?.artifact.revision || 0}
        busy={!!busy}
        canEdit={canEdit}
        open={panel === 'history'}
        history={history}
        onToggle={() => togglePanel('history')}
        onClose={closePanel}
      />
      <div className="studio-editor-popover-anchor">
        <button
          ref={shareButton}
          className={`studio-button studio-text-button${panel === 'share' ? ' is-active' : ''}`}
          aria-label="分享"
          aria-expanded={panel === 'share'}
          onClick={() => togglePanel('share')}
        >
          <Share2 size={19} />
          <span>分享</span>
          {(share?.access ?? sessionShareAccess) === 'lan' && (
            <span
              className="studio-share-lan-dot"
              role="img"
              aria-label="局域网共享已开启"
              title="局域网共享已开启"
            />
          )}
        </button>
        {panel === 'share' && (
          <EditorPopover
            title={board?.artifact.title || '分享作品'}
            className="studio-share-popover"
            anchorRef={shareButton}
            onClose={closePanel}
          >
            <StudioSharePane state={state} />
          </EditorPopover>
        )}
      </div>
      <StudioCommentControl state={state} />
    </div>
  );
}

function StudioCommentControl({ state }: EditorSectionProps) {
  const {
    annotationActive,
    board,
    canComment,
    changeAnnotationMode,
    closeCommentsPanel,
    feedback,
    panel,
    peerId,
    pendingAttachments,
    previewing,
    togglePanel,
  } = state;
  const commentsButton = useRef<HTMLButtonElement>(null);
  function handleAnnotationPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button === 0) {
      event.preventDefault();
    }
  }

  return (
    <div className="studio-comment-mode-control">
      <button
        className={`studio-icon-button${annotationActive ? ' is-active' : ''}`}
        aria-label="备注"
        title="备注（9）：点击目标添加备注"
        aria-keyshortcuts="9"
        aria-pressed={annotationActive}
        disabled={!board || !canComment || previewing}
        onPointerDown={handleAnnotationPointer}
        onClick={() => changeAnnotationMode(!annotationActive)}
      >
        <MessageSquare size={20} fill={annotationActive ? 'currentColor' : 'none'} />
      </button>
      <div className="studio-editor-popover-anchor">
        <button
          ref={commentsButton}
          className={`studio-icon-button studio-comment-dropdown${pendingAttachments.length ? ' has-requests' : ''}`}
          aria-label="备注列表"
          aria-describedby={pendingAttachments.length ? `${peerId}-pending-attachments` : undefined}
          title={
            pendingAttachments.length
              ? `备注列表 · ${pendingAttachments.length} 条待附加`
              : '备注列表'
          }
          aria-expanded={panel === 'feedback'}
          onClick={() => togglePanel('feedback')}
        >
          <ChevronDown size={15} />
          {pendingAttachments.length > 0 ? (
            <span
              id={`${peerId}-pending-attachments`}
              className="studio-attachment-count"
              role="status"
              aria-label={`${pendingAttachments.length} 条备注待附加`}
            >
              {pendingAttachments.length > 99 ? '99+' : pendingAttachments.length}
            </span>
          ) : (
            feedback.some((item) => item.status !== 'resolved') && (
              <span className="studio-unread-dot" />
            )
          )}
        </button>
        {panel === 'feedback' && (
          <EditorPopover
            title="所有备注"
            className="studio-comments-panel"
            anchorRef={commentsButton}
            onClose={closeCommentsPanel}
            persistent
          >
            <StudioCommentsPane state={state} />
          </EditorPopover>
        )}
      </div>
    </div>
  );
}

function StudioSharePane({ state }: EditorSectionProps) {
  const {
    actor,
    board,
    busy,
    canManage,
    changeSharing,
    client,
    handleCopy,
    exportBoard,
    exportFormats,
    resolvedTheme,
    changeTheme,
    share,
  } = state;
  function handleToggleTheme() {
    changeTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }

  return (
    <div aria-label="分享面板">
      <SharePanel
        title={board?.artifact.title || '作品'}
        actor={actor}
        share={share}
        busy={!!busy}
        exportFormats={exportFormats}
        canBackup={canManage}
        onStart={(access) => changeSharing('start', { access })}
        onReset={(role) => changeSharing('reset', { role })}
        onToggleRole={(role, on) => changeSharing('link', { role, on })}
        onMemberRole={(memberId, role) => changeSharing('role', { memberId, role })}
        onRemoveMember={(memberId) => changeSharing('remove', { memberId })}
        onRestoreMember={(memberId, role) => changeSharing('restore', { memberId, role })}
        onForgetMember={(memberId) => changeSharing('forget', { memberId })}
        canonicalLink={
          share?.canonicalPath && client.baseUrl
            ? new URL(share.canonicalPath, client.baseUrl).href
            : undefined
        }
        onCopy={handleCopy}
        onExport={exportBoard}
        extraContent={
          <div className="studio-editor-secondary">
            <button
              className="studio-button studio-text-button"
              aria-label={resolvedTheme === 'dark' ? '切换为明亮主题' : '切换为暗色主题'}
              onClick={handleToggleTheme}
            >
              {resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}切换为
              {resolvedTheme === 'dark' ? '明亮' : '暗色'}主题
            </button>
          </div>
        }
      />
    </div>
  );
}

function StudioCommentsPane({ state }: EditorSectionProps) {
  const {
    acceptBoard,
    activeId,
    actor,
    attachFeedback,
    attachingId,
    board,
    busy,
    changeReplyText,
    client,
    fail,
    feedback,
    feedbackAction,
    previewSuggestion,
    refreshBoard,
    replies,
    selectFeedback,
    collapseListedComment,
    changeShowResolved,
    showResolved,
  } = state;
  const { activeFeedback, selectedFeedback, onCommentSurface } = state;
  const openFeedbackId =
    selectedFeedback?.inList && onCommentSurface(activeFeedback?.anchor)
      ? activeFeedback?.id
      : undefined;

  return (
    <CommentsPanel
      feedback={feedback}
      actor={actor}
      busy={!!busy}
      attachingId={attachingId}
      showResolved={showResolved}
      onShowResolved={changeShowResolved}
      openFeedbackId={openFeedbackId}
      onOpen={(item) => selectFeedback(item, undefined, true)}
      onCloseFeedback={collapseListedComment}
      replyTextById={replies}
      onReplyTextChange={changeReplyText}
      onAction={feedbackAction}
      onAttach={attachFeedback}
      renderAnchorNotice={(item) => <DocumentAnchorNotice anchor={item.anchor} document={board} />}
      renderSuggestion={(item) => (
        <SuggestionPanel
          feedback={item}
          client={client}
          artifactId={activeId}
          onChanged={acceptBoard}
          onPreview={(operations) => previewSuggestion(item, operations)}
          onRefresh={refreshBoard}
          onError={fail}
        />
      )}
    />
  );
}

function StudioWorkspace({ state }: EditorSectionProps) {
  const {
    ProductEditor,
    actor,
    board,
    handleCanvasArea,
    client,
    clockOffsetMs,
    error,
    history,
    peerId,
    readingChanged,
    refreshBoard,
    resolvedTheme,
    suggestionPreview,
  } = state;
  const { preview } = history;

  return (
    <div className="studio-workspace">
      <div ref={handleCanvasArea} className="studio-canvas-area">
        {board ? (
          <>
            <StudioLiveEditor state={state} board={board} />
            {(preview?.board || suggestionPreview) && (
              <ProductEditor
                key={`preview-${preview?.version.id || 'suggestion'}`}
                document={preview?.board || suggestionPreview!}
                client={client}
                viewTheme={resolvedTheme}
                actor={actor}
                clockOffsetMs={clockOffsetMs}
                readOnly
                preview
                onReadingChange={readingChanged}
                onChanged={() => {}}
                onAnnotate={() => {}}
                onSelectionChange={() => {}}
                onViewportChange={() => {}}
                onCursorMove={() => {}}
                presence={[]}
                selfPeerId={`preview-${peerId}`}
              />
            )}
          </>
        ) : (
          <div className="studio-empty">
            <Loader2 size={28} className="studio-spin" />
            <p>{error ? '作品暂时无法读取' : '正在打开作品'}</p>
            {error && (
              <button className="studio-button" onClick={refreshBoard}>
                <RefreshCw size={16} />
                重新加载
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function visibleAnnotationTarget(
  draft: Anchor | undefined,
  feedback: Anchor | undefined,
  isVisible: (anchor?: Anchor) => boolean,
) {
  if (draft && isVisible(draft)) {
    return draft;
  }

  return isVisible(feedback) ? feedback : undefined;
}

function StudioLiveEditor({ state, board }: EditorSectionProps & { board: StudioDocument }) {
  const {
    ProductEditor,
    acceptBoard,
    activeFeedback,
    actor,
    annotate,
    annotation,
    annotationActive,
    canEdit,
    changeAnnotationMode,
    changeTimer,
    client,
    clockOffsetMs,
    room,
    commentOpen,
    cursorMoved,
    editorActivityChanged,
    fail,
    feedback,
    externalViewport,
    inform,
    onCommentSurface,
    peerId,
    peers,
    previewing,
    readingChanged,
    releaseAgentTask,
    resolvedTheme,
    readingSnapshotId,
    roomTimer,
    savedComment,
    selectFeedback,
    selectionChanged,
    showResolved,
    stopFollowing,
    targetSelection,
    timerBusy,
    panelViewId,
    viewportChanged,
  } = state;
  const draftAnchor = commentOpen ? annotation?.anchor : undefined;
  const annotationTarget = visibleAnnotationTarget(
    draftAnchor,
    activeFeedback?.anchor,
    onCommentSurface,
  );

  return (
    <div className="studio-live-editor" hidden={previewing}>
      <ProductEditor
        key={board.artifact.id}
        document={board}
        viewTheme={resolvedTheme}
        client={client}
        actor={actor}
        clockOffsetMs={clockOffsetMs}
        onChanged={acceptBoard}
        onAnnotate={annotate}
        onError={fail}
        onNotice={inform}
        readOnly={!canEdit || previewing}
        annotationActive={annotationActive && !previewing}
        annotationTarget={annotationTarget}
        onAnnotationModeChange={changeAnnotationMode}
        onSelectionChange={selectionChanged}
        onActivityChange={editorActivityChanged}
        activities={feedback.filter((item) => item.status !== 'resolved' || showResolved)}
        activeFeedbackId={activeFeedback?.id ?? (commentOpen ? savedComment?.id : undefined)}
        onFeedbackSelect={selectFeedback}
        onReadingChange={readingChanged}
        documentControls={
          client.baseUrl && (
            <TimerControl
              timer={roomTimer}
              clockOffsetMs={clockOffsetMs}
              canEdit={canEdit && !previewing}
              busy={timerBusy}
              onAction={changeTimer}
            />
          )
        }
        onViewportChange={viewportChanged}
        onCursorMove={cursorMoved}
        onViewportInteract={stopFollowing}
        room={room}
        presence={peers}
        onReleaseAgentTask={releaseAgentTask}
        selfPeerId={peerId}
        externalViewport={externalViewport}
        externalSelectedIds={targetSelection}
        panelViewId={panelViewId}
        restoreReadingFrom={readingSnapshotId}
      />
    </div>
  );
}

function StudioCommentDraft({
  state,
  annotation,
}: EditorSectionProps & { annotation: ProductAnnotation }) {
  const {
    actor,
    attachComment,
    board,
    busy,
    commentError,
    commentPoint,
    createFeedback,
    feedbackText,
    savedComment,
    changeCommentAttachment,
    hideCommentDraft,
    changeCommentText,
  } = state;
  function handleOutsideDraft() {
    if (!feedbackText.trim() && !savedComment) {
      hideCommentDraft();
    }
  }

  return (
    <CommentPopover
      point={annotation.screenPoint}
      locate={() => commentPoint(annotation.anchor, savedComment?.id, annotation.screenPoint)}
      draft
      showDraftPin={!savedComment}
      pinAuthor={actor}
      label={annotation.label}
      onClose={hideCommentDraft}
      onOutside={handleOutsideDraft}
    >
      <DocumentAnchorNotice anchor={annotation.anchor} document={board} />
      <CommentComposer
        text={feedbackText}
        attach={attachComment}
        busy={busy === 'feedback'}
        saved={!!savedComment}
        error={commentError}
        onTextChange={changeCommentText}
        onAttachChange={changeCommentAttachment}
        onSubmit={createFeedback}
      />
    </CommentPopover>
  );
}

function StudioCommentDetails({
  state,
  activeFeedback,
  selectedFeedback,
}: EditorSectionProps & { activeFeedback: Feedback; selectedFeedback: CommentSelection }) {
  const {
    actor,
    attachFeedback,
    attachingId,
    board,
    busy,
    changeReplyText,
    commentPoint,
    feedbackAction,
    replies,
    dismissComment,
  } = state;

  return (
    <CommentPopover
      point={selectedFeedback.point}
      locate={() => commentPoint(activeFeedback.anchor, activeFeedback.id, selectedFeedback.point)}
      onClose={dismissComment}
    >
      <DocumentAnchorNotice anchor={activeFeedback.anchor} document={board} />
      <CommentThread
        feedback={activeFeedback}
        actor={actor}
        busy={!!busy}
        attaching={attachingId === activeFeedback.id}
        onAction={feedbackAction}
        onAttach={attachFeedback}
        onClose={dismissComment}
        replyText={replies[activeFeedback.id] || ''}
        onReplyTextChange={(value) => changeReplyText(activeFeedback.id, value)}
      />
    </CommentPopover>
  );
}
