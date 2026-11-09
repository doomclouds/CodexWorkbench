import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import katex from 'katex';
import { isOrderedList } from '@platejs/list';
import { useTodoListElement, useTodoListElementState } from '@platejs/list/react';
import type { TEquationElement, TLinkElement, TListElement } from 'platejs';
import { NodeApi } from 'platejs';
import { PlateElement, PlateLeaf, useEditorRef, useReadOnly, useSelected, type PlateElementProps, type PlateLeafProps, type RenderNodeWrapper } from 'platejs/react';
import type { NoteAsset } from '../../contracts/reader';
import { callTool } from '../api';
import { messageOf } from '../model';
import { isSafeImageReference } from './markdown-model';

export interface NoteEnvironment { vaultId: string; notePath: string; preview: boolean; onLink(url: string): void }
export const NoteEnvironmentContext = createContext<NoteEnvironment>({ vaultId: '', notePath: '', preview: true, onLink() {} });

function heading(level: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  return function NoteHeading(props: PlateElementProps) { const id = NodeApi.string(props.element).trim().toLocaleLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, ''); return <PlateElement {...props} as={level} attributes={{ ...props.attributes, id }}>{props.children}</PlateElement>; };
}
export const noteHeadings = [heading('h1'), heading('h2'), heading('h3'), heading('h4'), heading('h5'), heading('h6')];
export function NoteParagraph(props: PlateElementProps) { return <PlateElement {...props} as="p">{props.children}</PlateElement>; }
export function NoteQuote(props: PlateElementProps) { return <PlateElement {...props} as="blockquote">{props.children}</PlateElement>; }
export function NoteRule(props: PlateElementProps) { return <PlateElement {...props}><hr contentEditable={false} />{props.children}</PlateElement>; }
export function NoteInlineCode(props: PlateLeafProps) { return <PlateLeaf {...props} as="code" />; }
export function NoteSearchHighlight(props: PlateLeafProps) { return <PlateLeaf {...props} as="mark" className="note-search-highlight" />; }

export function NoteLinkElement(props: PlateElementProps<TLinkElement>) {
  const environment = useContext(NoteEnvironmentContext); const readOnly = useReadOnly();
  return <PlateElement {...props} as="a" attributes={{ ...props.attributes, href: '#', title: `${props.element.url} · ${readOnly ? '点击打开' : 'Ctrl/Cmd + 点击打开'}`, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault(); if (readOnly || event.ctrlKey || event.metaKey) environment.onLink(props.element.url);
  } }}>{props.children}</PlateElement>;
}

export function NoteCodeBlock(props: PlateElementProps) {
  const editor = useEditorRef(); const readOnly = useReadOnly(); const lang = typeof props.element.lang === 'string' ? props.element.lang : '';
  return <PlateElement {...props} as="div" className="note-code-block">
    <div contentEditable={false} className="note-code-toolbar"><span>{lang || '代码'}</span>{!readOnly && <select aria-label="代码语言" value={lang} onChange={event => {
      const path = editor.api.findPath(props.element); if (path) editor.tf.setNodes({ lang: event.target.value }, { at: path });
    }}><option value="">纯文本</option>{['python', 'typescript', 'javascript', 'json', 'bash', 'rust', 'cpp', 'java', 'sql', 'yaml', 'latex', 'markdown'].map(value => <option key={value}>{value}</option>)}</select>}</div>
    <pre><code>{props.children}</code></pre>
  </PlateElement>;
}
export function NoteCodeLine(props: PlateElementProps) { return <PlateElement {...props} as="div">{props.children}</PlateElement>; }
export function NoteCodeSyntax(props: PlateLeafProps) {
  const token = String(props.leaf.tokenType ?? props.leaf.className ?? '').replace(/[^\w\s-]/g, '');
  return <PlateLeaf {...props} className={token ? `note-code-token ${token}` : undefined} />;
}
export function NoteTable(props: PlateElementProps) { return <PlateElement {...props} as="table"><tbody>{props.children}</tbody></PlateElement>; }
export function NoteTableRow(props: PlateElementProps) { return <PlateElement {...props} as="tr">{props.children}</PlateElement>; }
export function NoteTableCell(props: PlateElementProps) { return <PlateElement {...props} as="td">{props.children}</PlateElement>; }
export function NoteTableHeader(props: PlateElementProps) { return <PlateElement {...props} as="th">{props.children}</PlateElement>; }

function Equation({ props, inline }: { props: PlateElementProps<TEquationElement>; inline: boolean }) {
  const editor = useEditorRef(); const selected = useSelected(); const readOnly = useReadOnly();
  const [editing, setEditing] = useState(false); const tex = props.element.texExpression || '';
  const math = useMemo(() => katex.renderToString(tex.trim() || '\\,', { displayMode: !inline, output: 'mathml', throwOnError: false, trust: false }), [tex, inline]);
  useEffect(() => { if (selected && !readOnly) setEditing(true); }, [selected, readOnly]);
  return <PlateElement {...props} as={inline ? 'span' : 'div'} className={inline ? 'note-inline-equation' : 'note-equation'}>
    <span contentEditable={false}>
      <span role={!readOnly ? 'button' : undefined} tabIndex={!readOnly ? 0 : undefined} aria-label={!readOnly ? '编辑 TeX 公式' : undefined} onClick={() => { if (!readOnly) setEditing(value => !value); }} onKeyDown={event => { if (event.key === 'Enter' && !readOnly) setEditing(value => !value); }} dangerouslySetInnerHTML={{ __html: math }} />
      {editing && !readOnly && <textarea aria-label="TeX 公式" value={tex} onBlur={() => setEditing(false)} onChange={event => {
        const at = editor.api.findPath(props.element); if (at) editor.tf.setNodes({ texExpression: event.target.value }, { at });
      }} />}
    </span>{props.children}
  </PlateElement>;
}
export function NoteEquation(props: PlateElementProps<TEquationElement>) { return <Equation props={props} inline={false} />; }
export function NoteInlineEquation(props: PlateElementProps<TEquationElement>) { return <Equation props={props} inline />; }

function TaskItem(props: PlateElementProps) {
  const state = useTodoListElementState({ element: props.element }); const { checkboxProps } = useTodoListElement(state); const readOnly = useReadOnly();
  return <li className={props.element.checked ? 'note-task checked' : 'note-task'}><span contentEditable={false}><input aria-label="任务完成状态" type="checkbox" checked={checkboxProps.checked} disabled={readOnly} onMouseDown={checkboxProps.onMouseDown} onChange={event => checkboxProps.onCheckedChange(event.target.checked)} /></span>{props.children}</li>;
}
export const NoteListWrapper: RenderNodeWrapper = props => {
  if (!props.element.listStyleType) return;
  return child => {
    const node = props.element as TListElement; const ordered = isOrderedList(node); const task = node.listStyleType === 'todo';
    const content: ReactNode = task ? <TaskItem {...child} /> : <li>{child.children}</li>;
    return ordered ? <ol start={node.listStart} className="note-block-list" style={{ listStyleType: node.listStyleType }}>{content}</ol> : <ul className={task ? 'note-task-list' : 'note-block-list'} style={{ listStyleType: task ? 'none' : node.listStyleType }}>{content}</ul>;
  };
};

export function NoteImage(props: PlateElementProps) {
  const { vaultId, notePath, preview } = useContext(NoteEnvironmentContext);
  const source = typeof props.element.url === 'string' ? props.element.url : '';
  const alt = Array.isArray(props.element.caption) ? props.element.caption.map(item => item && typeof item === 'object' && 'text' in item ? String(item.text) : '').join('') : typeof props.element.alt === 'string' ? props.element.alt : '';
  const [url, setUrl] = useState(''); const [error, setError] = useState('');
  useEffect(() => {
    setUrl(''); setError(''); let cancelled = false; let objectUrl = '';
    if (preview || !isSafeImageReference(source)) { setError(preview ? '图片附件仅在连接真实知识库后读取' : '仅显示知识库内的安全图片附件'); return; }
    void callTool<NoteAsset>('note_asset_read', { vaultId, notePath, assetPath: source }).then(asset => {
      if (cancelled) return;
      if (!asset.base64 || asset.totalBytes > 8 * 1024 * 1024 || !/^image\/(png|jpeg|webp|gif|avif)$/.test(asset.mimeType)) throw new Error('图片格式或大小不受支持');
      const bytes = Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0));
      if (bytes.length !== asset.totalBytes) throw new Error('图片附件返回不完整');
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType })); setUrl(objectUrl);
    }).catch(reason => { if (!cancelled) setError(messageOf(reason)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [vaultId, notePath, preview, source]);
  return <PlateElement {...props} className="note-image"><figure contentEditable={false}>{url ? <img src={url} alt={alt} /> : <span className="note-image-status">{error || '正在读取图片…'}</span>}{alt && <figcaption>{alt}</figcaption>}<span className="path-text">{source}</span></figure>{props.children}</PlateElement>;
}
