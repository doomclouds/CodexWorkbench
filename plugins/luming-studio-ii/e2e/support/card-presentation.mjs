export function readCardCover(boardButton) {
  return boardButton.evaluate((element) => {
    const image = element.querySelector("img");
    const text = element.textContent;
    if (image?.complete && image.naturalWidth > 0) {
      return {
        state: "ready",
        width: image.naturalWidth,
        height: image.naturalHeight,
        padding: getComputedStyle(image).padding,
      };
    }
    if (text.includes("预览暂不可用")) {
      return { state: "failed" };
    }
    if (image || element.querySelector("[data-preview-pending]") || text.includes("正在加载预览")) {
      return { state: "pending" };
    }

    return { state: "empty" };
  });
}

export function readControlPresentation(locator) {
  return locator.evaluate((element) => {
    let shown = true;
    let background = "rgba(0, 0, 0, 0)";
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const concealed = style.display === "none" || style.visibility !== "visible";
      if (concealed || Number(style.opacity) === 0) {
        shown = false;
      }
      if (background === "rgba(0, 0, 0, 0)") {
        background = style.backgroundColor;
      }
    }

    return {
      shown,
      foreground: getComputedStyle(element).color,
      background,
    };
  });
}
