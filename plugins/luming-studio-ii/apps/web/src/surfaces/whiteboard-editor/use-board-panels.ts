import { useRef, useState } from 'react';
import type { WhiteboardEditorFeatures } from './board-features.js';

export function useBoardPanels() {
  const suggestionTrigger = useRef<HTMLButtonElement>(null);
  const [lanSharing, setLanSharing] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<HTMLButtonElement>();
  const [historyAnchor, setHistoryAnchor] = useState<HTMLButtonElement | null>(null);
  const [historyPreview, setHistoryPreview] = useState(false);
  const [feedbackAnchor, setFeedbackAnchor] = useState<HTMLButtonElement | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [suggestionAnchor, setSuggestionAnchor] = useState<HTMLButtonElement | null>(null);
  const [suggestionPreview, setSuggestionPreview] = useState(false);

  function closeSuggestions() {
    setSuggestionAnchor(null);
    setSuggestionPreview(false);
  }

  function openSuggestions(anchor: HTMLButtonElement) {
    setExportAnchor(undefined);
    setHistoryAnchor(null);
    setFeedbackOpen(false);
    setSuggestionAnchor((current) => (current === anchor ? null : anchor));
  }

  function openHistory(anchor: HTMLButtonElement) {
    closeSuggestions();
    setExportAnchor(undefined);
    setFeedbackOpen(false);
    setHistoryAnchor((current) => (current === anchor ? null : anchor));
  }

  function toggleFeedback(anchor: HTMLButtonElement) {
    closeSuggestions();
    setExportAnchor(undefined);
    setHistoryAnchor(null);
    setFeedbackAnchor(anchor);
    setFeedbackOpen((open) => !open);
  }

  function openExport(anchor: HTMLButtonElement) {
    closeSuggestions();
    setHistoryAnchor(null);
    setFeedbackOpen(false);
    setExportAnchor((current) => (current === anchor ? undefined : anchor));
  }

  function closeExport() {
    setExportAnchor(undefined);
  }

  function closeHistory() {
    setHistoryAnchor(null);
  }

  function closeAll() {
    closeExport();
    closeHistory();
    closeSuggestions();
    setFeedbackOpen(false);
  }

  function restoreSuggestionsFocus() {
    suggestionTrigger.current?.focus({ preventScroll: true });
  }

  return {
    suggestionTrigger,
    restoreSuggestionsFocus,
    lanSharing,
    setLanSharing,
    exportAnchor,
    historyAnchor,
    historyPreview,
    feedbackAnchor,
    feedbackOpen,
    suggestionAnchor,
    suggestionPreview,
    openSuggestions,
    closeSuggestions,
    setSuggestionPreview,
    openHistory,
    toggleFeedback,
    openExport,
    closeExport,
    closeHistory,
    closeAll,
    setHistoryPreview,
    setFeedbackOpen,
  };
}

export function boardPanelActions(
  features: WhiteboardEditorFeatures,
  panels: ReturnType<typeof useBoardPanels>,
) {
  const standaloneSuggestions = features.renderSuggestions && !features.renderFeedback;
  return {
    onOpenShare: features.renderExport ? panels.openExport : undefined,
    onOpenHistory: features.renderHistory ? panels.openHistory : undefined,
    onToggleFeedback: features.renderFeedback ? panels.toggleFeedback : undefined,
    onOpenSuggestions: standaloneSuggestions ? panels.openSuggestions : undefined,
  };
}
