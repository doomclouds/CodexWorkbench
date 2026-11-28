const inkFor = {
  initial: ".studio-reading-marker svg path",
  ii: ".whiteboard-viewing__ink path",
};

export function readViewingInk(page, studio) {
  const selector = inkFor[studio.edition];
  if (!selector) {
    throw new Error("Unknown Studio edition for the viewing ink overlay.");
  }

  return page.locator(selector).evaluateAll((paths) => ({
    count: paths.length,
    drawing: paths.filter((path) => path.matches(".is-drawing,[data-drawing]")).length,
    fading: paths.filter((path) => path.matches(".is-fading,[data-fading]")).length,
  }));
}
