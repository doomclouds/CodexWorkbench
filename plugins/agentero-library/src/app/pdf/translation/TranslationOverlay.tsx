import type { PageGeometry } from '../geometry';
import { translationFontFamily } from './fonts';
import type { TranslatedPage } from './useDocumentTranslation';

export function TranslationOverlay({ state, geometry, dark }: { state?: TranslatedPage; geometry: PageGeometry; dark: boolean }) {
  if (!state) return null;
  const point = (x: number, y: number) => geometry.viewport.convertToViewportPoint(geometry.view[0] + x, geometry.view[3] - y);
  const origin = point(0, 0); const x = point(1, 0); const y = point(0, 1);
  const transform = `matrix(${x[0] - origin[0]},${x[1] - origin[1]},${y[0] - origin[0]},${y[1] - origin[1]},${origin[0]},${origin[1]})`;
  return <div className="pdf-translated-layer" data-page-translation style={{ width: geometry.width, height: geometry.height, transform }}>
    {state.layouts.filter(layout => layout.fits).map(layout => <div key={layout.id} className="pdf-translated-region" data-translation-region={layout.id} style={{ left: layout.sourceBox.x, top: layout.sourceBox.y, width: layout.sourceBox.w, height: layout.sourceBox.h, background: dark ? '#000' : '#fff', color: dark ? '#fff' : '#000' }}>
      {layout.units.map((unit, index) => {
        const style = { position: 'absolute' as const, left: unit.x - layout.sourceBox.x, top: unit.y - layout.sourceBox.y - (unit.formula ? unit.height : unit.fontSize * .8), width: unit.width, height: unit.height, fontSize: unit.fontSize, lineHeight: 1, fontFamily: translationFontFamily, fontWeight: unit.font.toLowerCase().includes('bold') ? 700 : 400, fontStyle: unit.font.toLowerCase().includes('italic') ? 'italic' : 'normal', whiteSpace: 'pre' as const, color: dark ? '#fff' : `rgb(${unit.color.r},${unit.color.g},${unit.color.b})` };
        if (unit.formula) return <img key={index} alt={unit.text} draggable={false} src={state.formulas.get(`${layout.id}:${unit.formula.id}`)} style={{ ...style, filter: dark ? 'invert(1) hue-rotate(180deg)' : undefined }} />;
        return <span key={index} style={style}>{unit.text}</span>;
      })}
    </div>)}
  </div>;
}
