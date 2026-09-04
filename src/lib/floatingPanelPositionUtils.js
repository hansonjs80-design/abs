export function getFloatingPanelViewportOffset(rect, viewport = {}, gap = 12) {
  const safeGap = Math.max(0, Number(gap) || 0);
  const viewportLeft = Number(viewport.offsetLeft) || 0;
  const viewportTop = Number(viewport.offsetTop) || 0;
  const viewportWidth = Math.max(0, Number(viewport.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport.height) || 0);
  const minLeft = viewportLeft + safeGap;
  const maxRight = viewportLeft + viewportWidth - safeGap;
  const minTop = viewportTop + safeGap;
  const maxBottom = viewportTop + viewportHeight - safeGap;

  let x = 0;
  let y = 0;
  if (rect.right > maxRight) x = maxRight - rect.right;
  if (rect.left + x < minLeft) x += minLeft - (rect.left + x);
  if (rect.bottom > maxBottom) y = maxBottom - rect.bottom;
  if (rect.top + y < minTop) y += minTop - (rect.top + y);

  return { x, y };
}

export function getAnchoredFloatingPanelLayout({
  panelRect,
  anchorRect,
  viewport = {},
  viewportGap = 12,
  panelGap = 4,
  preferLeft = false,
}) {
  const safeViewportGap = Math.max(0, Number(viewportGap) || 0);
  const safePanelGap = Math.max(0, Number(panelGap) || 0);
  const viewportLeft = Number(viewport.offsetLeft) || 0;
  const viewportWidth = Math.max(0, Number(viewport.width) || 0);
  const minLeft = viewportLeft + safeViewportGap;
  const maxRight = viewportLeft + viewportWidth - safeViewportGap;
  const panelWidth = Math.max(
    0,
    Number(panelRect?.width)
      || (Number(panelRect?.right) - Number(panelRect?.left))
      || 0,
  );
  const leftSpace = Math.max(0, Number(anchorRect?.left) - safePanelGap - minLeft);
  const rightSpace = Math.max(0, maxRight - Number(anchorRect?.right) - safePanelGap);
  const fitsLeft = panelWidth <= leftSpace;
  const fitsRight = panelWidth <= rightSpace;

  let openLeft = Boolean(preferLeft);
  if (fitsLeft !== fitsRight) {
    openLeft = fitsLeft;
  } else if (!fitsLeft && !fitsRight) {
    openLeft = leftSpace >= rightSpace;
  }

  return {
    openLeft,
    maxWidth: openLeft ? leftSpace : rightSpace,
  };
}

export function getBrowserViewport(windowObject) {
  const visualViewport = windowObject?.visualViewport;
  return {
    width: visualViewport?.width ?? windowObject?.innerWidth ?? 0,
    height: visualViewport?.height ?? windowObject?.innerHeight ?? 0,
    offsetLeft: visualViewport?.offsetLeft ?? 0,
    offsetTop: visualViewport?.offsetTop ?? 0,
  };
}
