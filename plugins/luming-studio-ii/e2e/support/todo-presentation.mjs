export function readTodoPresentation(card, studio) {
  return card.evaluate((region, legacy) => {
    const world = region.closest(legacy ? ".studio-canvas-world" : ".studio-canvas__world");
    const zoom = world ? new DOMMatrixReadOnly(getComputedStyle(world).transform).a : 1;
    const selectors = legacy
      ? {
          title: ".studio-todo-title,.studio-todo-title-button,.studio-todo-title-input",
          count: ".studio-todo-count",
          task: ".studio-todo-item :is(.studio-todo-item-text,.studio-todo-input)",
          row: ".studio-todo-item",
          checkbox: ".studio-todo-check",
          checkboxHit: ".studio-todo-check",
          add: ".studio-todo-add :is(button,input)",
        }
      : {
          title: ".studio-object-todo__title > *",
          count: ".studio-object-todo__count",
          task: ".studio-object-todo__task > *",
          row: ".studio-object-todo__row",
          checkbox: ".studio-object-todo__checked > input",
          checkboxHit: "label.studio-object-todo__checked",
          add: ".studio-object-todo__add :is(button,input)",
        };

    function measure(selector) {
      const node = region.querySelector(selector);
      if (!node) {
        return null;
      }

      const { x, y, width, height } = node.getBoundingClientRect();
      const style = getComputedStyle(node);

      return { x, y, width, height, screenFont: Number.parseFloat(style.fontSize) * zoom };
    }

    return {
      zoom,
      title: measure(selectors.title),
      count: measure(selectors.count),
      task: measure(selectors.task),
      row: measure(selectors.row),
      checkbox: measure(selectors.checkbox),
      checkboxHit: measure(selectors.checkboxHit),
      add: measure(selectors.add),
    };
  }, studio.edition === "initial");
}
