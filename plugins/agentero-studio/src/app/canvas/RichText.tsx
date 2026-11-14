import type { ReactNode } from 'react';
import { parseRichText, type RichTextSegment } from '../../core/shared/rich-text.js';
function segmentNode(segment: RichTextSegment): ReactNode {
  let value: ReactNode = segment.text;
  if(segment.type==='code'||segment.code)value=<code>{value}</code>;
  if(segment.type==='italic'||segment.italic)value=<em>{value}</em>;
  if(segment.type==='bold'||segment.bold)value=<strong>{value}</strong>;
  if(segment.type==='link')value=<a href={segment.href} target="_blank" rel="noreferrer" data-native-interactive="true">{value}</a>;
  return value;
}
export default function RichText({ text }: { text: string | undefined }) {
  return <div className="studio-rich-text">{parseRichText(text??'').map((line,index)=><div key={index} style={line.indent ? {paddingLeft:`${line.indent*1.5}em`} : undefined} className={`studio-rich-text-line${line.type!=='paragraph'?' is-list':''}`}>{line.marker&&<span className="studio-list-marker" aria-hidden="true">{line.marker}</span>}<span>{line.segments.map((segment,i)=><span key={i}>{segmentNode(segment)}</span>)}</span></div>)}</div>;
}
