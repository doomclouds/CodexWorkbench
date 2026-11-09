import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TranslateResult } from '../../../contracts/reader';
import { callTool } from '../../api';
import { registerBeforeTeardown } from '../../bridge';
import { messageOf } from '../../model';
import { extractPage, layoutRegions } from './extract-pdfjs';
import { browserFonts } from './fonts';
import { layoutReflowDocument } from './layout';
import { type ParagraphLayout, type ReflowPage } from './types';
import { translateProtected } from './translate-protected';
import { abortable, yieldToHost } from '../scheduling';

export interface TranslatedPage { source: ReflowPage; formulas: Map<string, string>; translations: Map<string, string>; layouts: ParagraphLayout[]; error: string; done: boolean }

export function useDocumentTranslation(options: { document: PDFDocumentProxy | null; vaultId: string; paperPath: string; open: boolean; currentPage: number; targetLanguage: string }) {
  const cache = useRef(new Map<number, TranslatedPage>());
  const [pages, setPages] = useState<ReadonlyMap<number, TranslatedPage>>(new Map());
  const [running, setRunning] = useState(false); const [progress, setProgress] = useState(''); const [error, setError] = useState('');
  const [retry, setRetry] = useState(0); const generation = useRef(0);
  const activeAbort = useRef<AbortController | null>(null);
  const currentPage = useRef(options.currentPage); currentPage.current = options.currentPage;
  useEffect(() => registerBeforeTeardown(async () => { activeAbort.current?.abort(); }), []);
  useEffect(() => { cache.current.clear(); setPages(new Map()); generation.current += 1; }, [options.document, options.vaultId, options.paperPath, options.targetLanguage]);
  useEffect(() => {
    if (!options.open || !options.document) { setRunning(false); return; }
    const document = options.document; const controller = new AbortController(); const { signal } = controller; const runId = ++generation.current;
    activeAbort.current = controller;
    const publish = () => { if (!signal.aborted && generation.current === runId) setPages(new Map([...cache.current].map(([page, item]) => [page, { ...item }]))); };
    setRunning(true); setError('');
    const translate = async (text: string) => {
      signal.throwIfAborted();
      const result = await callTool<TranslateResult>('translate_text', { vaultId: options.vaultId, text, to: options.targetLanguage || undefined }, { signal });
      signal.throwIfAborted(); return result.text;
    };
    void (async () => {
      await window.document.fonts.ready; signal.throwIfAborted();
      let rawLayout: unknown;
      try { rawLayout = await callTool('paper_layout', { vaultId: options.vaultId, paperPath: options.paperPath }, { signal }); } catch { rawLayout = { regions: [] }; }
      signal.throwIfAborted();
      const regions = layoutRegions(rawLayout); const fonts = browserFonts();
      const remaining = new Set(Array.from({ length: document.numPages }, (_, index) => index + 1));
      while (remaining.size) {
        await yieldToHost(signal);
        const number = remaining.has(currentPage.current) ? currentPage.current : remaining.values().next().value!;
        remaining.delete(number);
        const old = cache.current.get(number);
        if (old?.done && !old.error) continue;
        setProgress(`第 ${number} / ${document.numPages} 页`);
        let state = old;
        if (!state) {
          const extracted = await extractPage(await abortable(document.getPage(number), signal), regions, signal);
          for (const paragraph of extracted.source.paragraphs) paragraph.characters = []; // Geometry is no longer needed once protected text/formulas are built.
          state = { ...extracted, translations: new Map(), layouts: [], error: '', done: false }; cache.current.set(number, state);
        }
        state.error = '';
        for (const [index, paragraph] of state.source.paragraphs.entries()) {
          await yieldToHost(signal);
          if (state.translations.has(paragraph.id)) continue;
          setProgress(`第 ${number} / ${document.numPages} 页 · 段落 ${index + 1}/${state.source.paragraphs.length}`);
          try {
            const translated = await translateProtected(paragraph, translate, signal);
            const translations = new Map(state.translations).set(paragraph.id, translated);
            const layouts = layoutReflowDocument({ version: 1, pages: [state.source] }, translations, fonts)[0]?.paragraphs ?? [];
            if (layouts.some(layout => !layout.fits)) throw new Error('译文无法放入该页区域，已保留原段落。');
            state.translations = translations; state.layouts = layouts; publish();
          } catch (cause) {
            signal.throwIfAborted(); state.error = messageOf(cause); setError(state.error);
            if ((cause as { code?: string }).code) throw cause;
          }
        }
        state.done = true; publish();
      }
      setProgress('全文翻译已完成；未能拟合的段落保留原文。');
    })().catch(cause => { if (!signal.aborted) setError(messageOf(cause)); }).finally(() => { if (!signal.aborted) setRunning(false); });
    return () => { controller.abort(); if (activeAbort.current === controller) activeAbort.current = null; };
  }, [options.document, options.vaultId, options.paperPath, options.open, options.targetLanguage, retry]);
  return { pages, running, progress, error, retry: () => setRetry(value => value + 1) };
}
