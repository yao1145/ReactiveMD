/** Inspect the grid itself: outer overflow clipping can hide this from page-width checks. */
export async function gridOverflows(root) {
  return root.evaluate((element) => [...element.querySelectorAll('.local-grid')].flatMap((grid, gridIndex) => {
    const bounds = grid.getBoundingClientRect();
    if (bounds.width === 0 || grid.getClientRects().length === 0) return [];
    return [...grid.children].flatMap((card, cardIndex) => {
      const child = card.getBoundingClientRect();
      if (child.width === 0 || card.getClientRects().length === 0) return [];
      if (child.left >= bounds.left - 1 && child.right <= bounds.right + 1) return [];
      return [{
        grid: gridIndex,
        card: cardIndex,
        containerWidth: Math.round(bounds.width),
        cardWidth: Math.round(child.width),
        overflowLeft: Math.round(Math.max(0, bounds.left - child.left)),
        overflowRight: Math.round(Math.max(0, child.right - bounds.right)),
      }];
    });
  }));
}
