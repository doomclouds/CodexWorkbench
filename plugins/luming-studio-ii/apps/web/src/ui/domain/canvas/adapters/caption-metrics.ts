const sectionCaptionFontSize = 17;

export const sectionOverview = { fontSize: 12, height: 16, gap: 4, minimumWidth: 30 };

export function usesSectionOverview(zoom: number) {
  return zoom < 1 && sectionCaptionFontSize * zoom < sectionOverview.fontSize;
}

export function showsIdleHtmlCaption(width: number, zoom: number) {
  return zoom >= 0.5 && width * zoom >= 96;
}
