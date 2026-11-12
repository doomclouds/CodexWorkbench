import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Code, FileCode, ImagePlus, Italic, Link, List, ListChecks, ListOrdered, Quote, Radical, Search, Strikethrough, Table, X } from 'lucide-react';
import { ListStyleType, toggleList } from '@platejs/list';
import { insertTable } from '@platejs/table';
import { ElementApi, KEYS, NodeApi, type TRange } from 'platejs';
import { Plate, PlateContent, useEditorRef, usePlateEditor, type PlateEditor } from 'platejs/react';
import type { NoteAsset } from '../../contracts/reader';
import { callTool } from '../api';
import { messageOf } from '../model';
import { countLiteralMatches, resolveNoteLink, splitNoteMarkdown } from './markdown-model';
import { NoteEnvironmentContext, type NoteEnvironment } from './NoteElements';
import { deserializeNote, noteFindPlugin, notePlugins, serializeNote } from './note-kit';
import './notes.css';

type Mode = 'rich' | 'source' | 'preview';
interface Props {
  value: string; onChange(value: string): void; environment: NoteEnvironment;
  onSave(): void; saveDisabled: boolean;
  imageInsertionDisabled?: boolean;
}
interface InsertAction { insert(markdown: string): void }

export const MarkdownEditor = memo(function MarkdownEditor({ value, onChange, environment, onSave, saveDisabled, imageInsertionDisabled = false }: Props) {
  const [mode, setMode] = useState<Mode>('rich'); const [findOpen, setFindOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<'link' | 'wiki' | null>(null); const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [error, setError] = useState(''); const fileInput = useRef<HTMLInputElement>(null); const source = useRef<HTMLTextAreaElement>(null);
  const insert = useRef<InsertAction | null>(null); const parts = splitNoteMarkdown(value);
  const changeSource = (before: string, after = '', placeholder = '') => {
    const textarea = source.current; if (!textarea) return;
    const start = textarea.selectionStart; const end = textarea.selectionEnd; const selected = value.slice(start, end) || placeholder;
    onChange(value.slice(0, start) + before + selected + after + value.slice(end));
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + before.length, start + before.length + selected.length); });
  };
  const insertMarkdown = (markdown: string) => { if (mode === 'source') changeSource(markdown); else insert.current?.insert(markdown); };

  async function importImage(file: File) {
    if (imageInsertionDisabled) { setError('此文档暂不支持导入图片，请保留已有图片引用。'); return; }
    if (file.size > 8 * 1024 * 1024 || !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) { setError('请选择 8 MiB 以内的 PNG、JPEG、WebP、GIF 或 AVIF 图片。'); return; }
    setAttachmentBusy(true); setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
      for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      const result = await callTool<NoteAsset>('note_asset_import', { vaultId: environment.vaultId, notePath: environment.notePath, fileName: file.name, mimeType: file.type, base64: btoa(binary) });
      insertMarkdown(`\n![${file.name.replace(/[\[\]\n]/g, '')}](${result.markdownPath})\n`);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setAttachmentBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  return <NoteEnvironmentContext.Provider value={environment}>
    <div className="note-editor-shell" onPasteCapture={event => {
      const file = [...event.clipboardData.files].find(item => item.type.startsWith('image/'));
      if (file && mode !== 'preview' && !environment.preview && !attachmentBusy) { event.preventDefault(); event.stopPropagation(); void importImage(file); }
    }} onDragOver={event => { if (mode !== 'preview' && [...event.dataTransfer.types].includes('Files')) event.preventDefault(); }} onDropCapture={event => {
      const file = [...event.dataTransfer.files].find(item => item.type.startsWith('image/'));
      if (file && mode !== 'preview' && !environment.preview && !attachmentBusy) { event.preventDefault(); event.stopPropagation(); void importImage(file); }
    }} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!saveDisabled) onSave(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true); }
      if (event.key === 'Escape') setFindOpen(false);
    }}>
      <div className="note-editor-modes"><div className="note-mode-switch" role="group" aria-label="Markdown 显示方式">{([['rich', '编辑'], ['source', 'Markdown'], ['preview', '预览']] as const).map(([key, label]) => <button key={key} className={mode === key ? 'selected' : ''} disabled={attachmentBusy} aria-pressed={mode === key} onClick={() => { setMode(key); setError(''); }}>{label}</button>)}</div><span className="toolbar-spacer" /><button onClick={() => setFindOpen(value => !value)} aria-label="查找和替换"><Search size={15} /></button><button disabled={saveDisabled} onClick={onSave}>保存</button></div>
      {parts.prefix && mode !== 'source' && <details className="note-metadata"><summary>文档元数据（保持原样）</summary><pre>{parts.prefix}</pre></details>}
      {error && <p className="callout error" role="alert">{error}</p>}
      {mode === 'source' ? <>
        <div className="note-rich-toolbar" role="toolbar" aria-label="Markdown 格式">
          <Tool label="加粗" onClick={() => changeSource('**', '**', '文字')}><Bold size={15} /></Tool><Tool label="斜体" onClick={() => changeSource('*', '*', '文字')}><Italic size={15} /></Tool><Tool label="删除线" onClick={() => changeSource('~~', '~~', '文字')}><Strikethrough size={15} /></Tool><Tool label="行内代码" onClick={() => changeSource('`', '`', 'code')}><Code size={15} /></Tool>
          <select aria-label="标题级别" value="" onChange={event => { changeSource(`${event.target.value} `); }}><option value="" disabled>标题</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={'#'.repeat(level)}>H{level}</option>)}</select>
          <Tool label="无序列表" onClick={() => changeSource('- ')}><List size={15} /></Tool><Tool label="有序列表" onClick={() => changeSource('1. ')}><ListOrdered size={15} /></Tool><Tool label="任务列表" onClick={() => changeSource('- [ ] ')}><ListChecks size={15} /></Tool><Tool label="引用" onClick={() => changeSource('> ')}><Quote size={15} /></Tool>
          <Tool label="代码块" onClick={() => changeSource('\n```\n', '\n```\n', 'code')}><FileCode size={15} /></Tool><Tool label="插入链接" onClick={() => setLinkKind('link')}><Link size={15} /></Tool><Tool label="插入双链或论文引用" onClick={() => setLinkKind('wiki')}>[[ ]]</Tool>
          <Tool label="表格" onClick={() => changeSource('\n| 标题 | 内容 |\n| --- | --- |\n|  |  |\n')}><Table size={15} /></Tool><Tool label="公式" onClick={() => changeSource('\n$$\n', '\n$$\n', 'E = mc^2')}><Radical size={15} /></Tool><Tool label="图片附件" disabled={environment.preview || attachmentBusy || imageInsertionDisabled} onClick={() => fileInput.current?.click()}><ImagePlus size={15} /></Tool>
        </div>
        {findOpen && <SourceFind text={value} onChange={onChange} textarea={source} onClose={() => setFindOpen(false)} />}
        <textarea ref={source} className="markdown-editor note-source-editor" aria-label="笔记 Markdown 内容" value={value} onChange={event => onChange(event.target.value)} spellCheck={false} placeholder="# 阅读笔记" onKeyDown={event => {
          if (event.key === 'Tab') { event.preventDefault(); changeSource('  '); }
          if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) { event.preventDefault(); changeSource(event.key.toLowerCase() === 'b' ? '**' : '*', event.key.toLowerCase() === 'b' ? '**' : '*'); }
        }} />
      </> : <RichNote key={mode} markdown={value} readOnly={mode === 'preview'} onMarkdown={onChange} findOpen={findOpen} onCloseFind={() => setFindOpen(false)} insert={insert} onLink={() => setLinkKind('link')} onWiki={() => setLinkKind('wiki')} onImage={() => fileInput.current?.click()} imageDisabled={environment.preview || attachmentBusy || imageInsertionDisabled} />}
      <input ref={fileInput} type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" aria-label="选择笔记图片附件" onChange={event => { const file = event.target.files?.[0]; if (file) void importImage(file); }} />
      {attachmentBusy && <p className="inline-notice" role="status">正在保存图片附件…</p>}
      {linkKind && <LinkDialog wiki={linkKind === 'wiki'} notePath={environment.notePath} onClose={() => setLinkKind(null)} onInsert={(target, label) => { setLinkKind(null); insertMarkdown(linkKind === 'wiki' ? `[[${target}${label && label !== target ? `|${label}` : ''}]]` : `[${label || target}](${target})`); }} />}
    </div>
  </NoteEnvironmentContext.Provider>;
});

export function MarkdownPreview({ markdown, environment }: { markdown: string; environment: NoteEnvironment }) {
  const insert = useRef<InsertAction | null>(null);
  return <NoteEnvironmentContext.Provider value={environment}><div className="note-editor-shell"><RichNote markdown={markdown} readOnly onMarkdown={() => {}} findOpen={false} onCloseFind={() => {}} insert={insert} onLink={() => {}} onWiki={() => {}} onImage={() => {}} imageDisabled /></div></NoteEnvironmentContext.Provider>;
}

function RichNote({ markdown, readOnly, onMarkdown, findOpen, onCloseFind, insert, onLink, onWiki, onImage, imageDisabled }: {
  markdown: string; readOnly: boolean; onMarkdown(value: string): void; findOpen: boolean; onCloseFind(): void;
  insert: React.RefObject<InsertAction | null>; onLink(): void; onWiki(): void; onImage(): void; imageDisabled: boolean;
}) {
  const editor = usePlateEditor({ plugins: notePlugins, value: instance => deserializeNote(instance, markdown), shouldNormalizeEditor: true }, []);
  const published = useRef(markdown); const prefix = useRef(splitNoteMarkdown(markdown).prefix); const baseline = useRef<string | null>(null); const resetting = useRef(false);
  if (baseline.current === null) baseline.current = serializeNote(editor, prefix.current);
  useEffect(() => {
    if (markdown === published.current) return;
    resetting.current = true; prefix.current = splitNoteMarkdown(markdown).prefix; published.current = markdown;
    editor.tf.setValue(deserializeNote(editor, markdown)); baseline.current = serializeNote(editor, prefix.current); resetting.current = false;
  }, [markdown, editor]);
  useEffect(() => {
    const action = { insert(value: string) { editor.tf.focus(); editor.tf.insertNodes(deserializeNote(editor, value)); } };
    insert.current = action; return () => { if (insert.current === action) insert.current = null; };
  }, [editor, insert]);
  return <Plate editor={editor} onValueChange={() => {
    if (readOnly || resetting.current) return;
    const next = serializeNote(editor, prefix.current); if (next === baseline.current) return;
    baseline.current = next; published.current = next; onMarkdown(next);
  }}>
    {!readOnly && <RichToolbar onLink={onLink} onWiki={onWiki} onImage={onImage} imageDisabled={imageDisabled} />}
    {findOpen && <RichFind readOnly={readOnly} onClose={onCloseFind} />}
    <div className="note-rich-scroll"><PlateContent aria-label={readOnly ? '笔记 Markdown 预览' : '笔记富文本内容'} className="note-rich-content" readOnly={readOnly} placeholder="开始记录想法，或输入 Markdown…" spellCheck={false} /></div>
  </Plate>;
}

function Tool({ label, onClick, children, disabled }: { label: string; onClick(): void; children: ReactNode; disabled?: boolean }) { return <button type="button" aria-label={label} title={label} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button>; }

function RichToolbar({ onLink, onWiki, onImage, imageDisabled }: { onLink(): void; onWiki(): void; onImage(): void; imageDisabled: boolean }) {
  const editor = useEditorRef(); const run = (task: () => void) => { editor.tf.focus(); task(); };
  return <div className="note-rich-toolbar" role="toolbar" aria-label="笔记格式">
    <Tool label="加粗" onClick={() => run(() => editor.tf.toggleMark(KEYS.bold))}><Bold size={15} /></Tool><Tool label="斜体" onClick={() => run(() => editor.tf.toggleMark(KEYS.italic))}><Italic size={15} /></Tool><Tool label="删除线" onClick={() => run(() => editor.tf.toggleMark(KEYS.strikethrough))}><Strikethrough size={15} /></Tool><Tool label="行内代码" onClick={() => run(() => editor.tf.toggleMark(KEYS.code))}><Code size={15} /></Tool>
    <select aria-label="标题级别" value="" onChange={event => run(() => editor.tf.toggleBlock(event.target.value))}><option value="" disabled>标题</option><option value={KEYS.p}>正文</option>{KEYS.heading.map((key, index) => <option key={key} value={key}>H{index + 1}</option>)}</select>
    <Tool label="无序列表" onClick={() => run(() => toggleList(editor, { listStyleType: ListStyleType.Disc }))}><List size={15} /></Tool><Tool label="有序列表" onClick={() => run(() => toggleList(editor, { listStyleType: ListStyleType.Decimal }))}><ListOrdered size={15} /></Tool><Tool label="任务列表" onClick={() => run(() => toggleList(editor, { listStyleType: 'todo' }))}><ListChecks size={15} /></Tool><Tool label="引用" onClick={() => run(() => editor.tf.toggleBlock(KEYS.blockquote))}><Quote size={15} /></Tool>
    <Tool label="代码块" onClick={() => run(() => editor.tf.toggleBlock(KEYS.codeBlock))}><FileCode size={15} /></Tool><Tool label="插入链接" onClick={onLink}><Link size={15} /></Tool><Tool label="插入双链或论文引用" onClick={onWiki}>[[ ]]</Tool>
    <Tool label="表格" onClick={() => run(() => insertTable(editor, { rowCount: 3, colCount: 3 }))}><Table size={15} /></Tool><Tool label="公式" onClick={() => run(() => editor.tf.insertNodes({ type: KEYS.equation, texExpression: 'E = mc^2', children: [{ text: '' }] }))}><Radical size={15} /></Tool><Tool label="图片附件" onClick={onImage} disabled={imageDisabled}><ImagePlus size={15} /></Tool>
  </div>;
}

function matches(editor: PlateEditor, query: string): TRange[] {
  if (!query) return []; const result: TRange[] = [];
  for (const [node, path] of editor.api.nodes({ at: [], match: candidate => ElementApi.isElement(candidate) && editor.api.isBlock(candidate) })) {
    if (!ElementApi.isElement(node) || node.children.some(child => ElementApi.isElement(child) && editor.api.isBlock(child))) continue;
    let offset = 0; const segments = [...NodeApi.texts(node)].map(([leaf, relative]) => { const segment = { path: [...path, ...relative], start: offset, end: offset + leaf.text.length }; offset = segment.end; return segment; });
    if (!segments.length) continue; const text = NodeApi.string(node).toLocaleLowerCase(); const search = query.toLocaleLowerCase();
    const point = (position: number) => { const segment = segments.find(item => position <= item.end) || segments.at(-1)!; return { path: segment.path, offset: position - segment.start }; };
    for (let index = text.indexOf(search); index !== -1; index = text.indexOf(search, index + search.length)) result.push({ anchor: point(index), focus: point(index + search.length) });
  }
  return result;
}

function RichFind({ readOnly, onClose }: { readOnly: boolean; onClose(): void }) {
  const editor = useEditorRef(); const [query, setQuery] = useState(''); const [replacement, setReplacement] = useState(''); const [index, setIndex] = useState(0); const [, refresh] = useState(0);
  const ranges = matches(editor, query);
  useEffect(() => { editor.setOption(noteFindPlugin, 'search', query); editor.api.redecorate(); return () => { editor.setOption(noteFindPlugin, 'search', ''); editor.api.redecorate(); }; }, [editor, query]);
  const go = (next: number) => {
    if (!ranges.length) return; const selected = (next + ranges.length) % ranges.length; setIndex(selected); editor.tf.select(ranges[selected]);
    try { const node = editor.api.node(ranges[selected].anchor.path); if (node) editor.api.toDOMNode(node[0])?.parentElement?.scrollIntoView({ block: 'nearest' }); } catch { /* Slate may be painting a new selection. */ }
  };
  return <div className="note-findbar" role="search"><input autoFocus aria-label="查找笔记内容" placeholder="查找" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); go(index + (event.shiftKey ? -1 : 1)); } }} /><span className="muted">{ranges.length ? `${Math.min(index + 1, ranges.length)}/${ranges.length}` : '0'}</span><button disabled={!ranges.length} aria-label="上一个匹配" onClick={() => go(index - 1)}>↑</button><button disabled={!ranges.length} aria-label="下一个匹配" onClick={() => go(index + 1)}>↓</button>{!readOnly && <><input aria-label="替换为" placeholder="替换为" value={replacement} onChange={event => setReplacement(event.target.value)} /><button disabled={!ranges.length} onClick={() => { const range = ranges[Math.min(index, ranges.length - 1)]; if (range) { editor.tf.select(range); editor.tf.insertText(replacement); refresh(value => value + 1); } }}>替换</button><button disabled={!ranges.length} onClick={() => { editor.tf.withoutNormalizing(() => { for (const range of ranges.toReversed()) { editor.tf.select(range); editor.tf.insertText(replacement); } }); refresh(value => value + 1); }}>全部替换</button></>}<button aria-label="关闭查找" onClick={onClose}><X size={14} /></button></div>;
}

function SourceFind({ text, onChange, textarea, onClose }: { text: string; onChange(value: string): void; textarea: React.RefObject<HTMLTextAreaElement | null>; onClose(): void }) {
  const [query, setQuery] = useState(''); const [replacement, setReplacement] = useState(''); const [position, setPosition] = useState(-1); const count = countLiteralMatches(text, query);
  const go = (backward = false) => {
    if (!query) return; const lowered = text.toLocaleLowerCase(); const search = query.toLocaleLowerCase();
    let next = backward ? lowered.lastIndexOf(search, position < 0 ? text.length : position - 1) : lowered.indexOf(search, position + 1);
    if (next === -1) next = backward ? lowered.lastIndexOf(search) : lowered.indexOf(search);
    if (next !== -1) { setPosition(next); textarea.current?.focus(); textarea.current?.setSelectionRange(next, next + query.length); }
  };
  return <div className="note-findbar" role="search"><input autoFocus aria-label="查找笔记内容" placeholder="查找" value={query} onChange={event => { setQuery(event.target.value); setPosition(-1); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); go(event.shiftKey); } }} /><span className="muted">{count}</span><button disabled={!count} aria-label="上一个匹配" onClick={() => go(true)}>↑</button><button disabled={!count} aria-label="下一个匹配" onClick={() => go()}>↓</button><input aria-label="替换为" placeholder="替换为" value={replacement} onChange={event => setReplacement(event.target.value)} /><button disabled={!count} onClick={() => { if (position < 0) { go(); return; } onChange(text.slice(0, position) + replacement + text.slice(position + query.length)); setPosition(-1); }}>替换</button><button disabled={!count} onClick={() => { const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); onChange(text.replace(new RegExp(escaped, 'gi'), () => replacement)); setPosition(-1); }}>全部替换</button><button aria-label="关闭查找" onClick={onClose}><X size={14} /></button></div>;
}

function LinkDialog({ wiki, notePath, onInsert, onClose }: { wiki: boolean; notePath: string; onInsert(target: string, label: string): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const [target, setTarget] = useState(wiki ? 'notes/' : 'https://'); const [label, setLabel] = useState(''); const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="compact-modal" onCancel={event => { event.preventDefault(); onClose(); }}><form onSubmit={event => {
    event.preventDefault(); const url = wiki ? `workbench-wiki:${encodeURIComponent(target)}` : target;
    if (!resolveNoteLink(url, notePath) || /[\[\]\n|]/.test(target) || /[\[\]\n|]/.test(label)) { setError('请输入安全的网址、notes/ 下笔记路径或 papers/ 下论文路径。'); return; } onInsert(target, label);
  }}><header className="modal-heading"><h2>{wiki ? '插入双链或论文引用' : '插入链接'}</h2><button type="button" className="icon-button" aria-label="关闭链接对话框" onClick={onClose}><X size={16} /></button></header><div className="modal-content"><label>目标<input autoFocus value={target} onChange={event => setTarget(event.target.value)} /></label><label>显示文字<input value={label} onChange={event => setLabel(event.target.value)} /></label><p className="field-help">{wiki ? '例如 notes/方法比较.md 或 papers/ReAct。链接在当前知识库内解析。' : '支持 https、mailto、笔记和论文相对路径。'}</p>{error && <p className="error-text" role="alert">{error}</p>}</div><footer className="modal-footer"><button type="button" onClick={onClose}>取消</button><button className="primary">插入</button></footer></form></dialog>;
}
