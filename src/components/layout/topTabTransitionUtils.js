function findTabIndex(items, path) {
  return items.findIndex((item) => (
    item.path === '/'
      ? path === '/'
      : item.path === path
  ));
}

export function buildTopTabTransition(items, fromPath, toPath) {
  const fromIndex = findTabIndex(items, fromPath);
  const toIndex = findTabIndex(items, toPath);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;

  const movesRight = toIndex > fromIndex;
  return {
    fromPath,
    toPath,
    direction: movesRight ? 'right' : 'left',
  };
}

export function getTopTabMotionClasses(transition, path) {
  if (!transition) return '';

  if (transition.fromPath === path) {
    return ` top-tab-motion top-tab-motion--outgoing top-tab-motion--move-${transition.direction}`;
  }
  if (transition.toPath === path) {
    return ` top-tab-motion top-tab-motion--incoming top-tab-motion--move-${transition.direction}`;
  }
  return '';
}
