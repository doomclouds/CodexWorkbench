import { parseRichText } from '../../core/shared/rich-text.js';

export default function RichText({ text }: { text: string | undefined }) {
  return <div className="studio-rich-text">{parseRichText(text ?? '').map((line, index) => <div key={index} className={`studio-rich-text-line${line.type !== 'paragraph' ? ' is-list' : ''}`}>{line.marker && <span className="studio-list-marker" aria-hidden="true">{line.marker}</span>}<span>{line.segments.map((segment, segmentIndex) => segment.type === 'bold' ? <strong key={segmentIndex}>{segment.text}</strong> : segment.type === 'italic' ? <em key={segmentIndex}>{segment.text}</em> : segment.type === 'code' ? <code key={segmentIndex}>{segment.text}</code> : segment.type === 'link' ? <a key={segmentIndex} href={segment.href} target="_blank" rel="noreferrer" data-native-interactive="true">{segment.text}</a> : <span key={segmentIndex}>{segment.text}</span>)}</span></div>)}</div>;
}
