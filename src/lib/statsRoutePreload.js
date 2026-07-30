export const loadShockwaveStatsPage = () => import('../pages/ShockwaveStatsPage.jsx');
export const loadManualTherapyStatsPage = () => import('../pages/ManualTherapyStatsPage.jsx');
export const loadShockwaveStatsView = () => import('../components/shockwave/ShockwaveStatsView.jsx');

const statsRouteLoaders = Object.freeze({
  '/shockwave-stats': () => Promise.all([
    loadShockwaveStatsPage(),
    loadShockwaveStatsView(),
  ]),
  '/manual-therapy-stats': loadManualTherapyStatsPage,
});

export function isStatsRoutePath(path) {
  return Object.prototype.hasOwnProperty.call(statsRouteLoaders, path);
}

export function createRoutePreloader(loaders, { onError } = {}) {
  const preloadPromises = new Map();

  return (path) => {
    const loader = loaders?.[path];
    if (typeof loader !== 'function') return Promise.resolve(false);

    const existingPromise = preloadPromises.get(path);
    if (existingPromise) return existingPromise;

    const preloadPromise = Promise.resolve()
      .then(() => loader())
      .then(() => true)
      .catch((error) => {
        preloadPromises.delete(path);
        onError?.(error, path);
        return false;
      });

    preloadPromises.set(path, preloadPromise);
    return preloadPromise;
  };
}

export const preloadStatsRoute = createRoutePreloader(statsRouteLoaders, {
  onError: (error, path) => {
    console.warn(`통계 화면 사전 로드 실패 (${path}):`, error);
  },
});
