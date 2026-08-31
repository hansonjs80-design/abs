export const LEGACY_SERVICE_WORKER_RELOAD_KEY = 'abs-legacy-service-worker-reload-v1';

function getBrowserContext(browserArg) {
  if (browserArg) return browserArg;
  return typeof window === 'undefined' ? null : window;
}

function armOneTimeReload(browser) {
  try {
    if (browser.sessionStorage.getItem(LEGACY_SERVICE_WORKER_RELOAD_KEY) === '1') {
      return false;
    }
    browser.sessionStorage.setItem(LEGACY_SERVICE_WORKER_RELOAD_KEY, '1');
    return browser.sessionStorage.getItem(LEGACY_SERVICE_WORKER_RELOAD_KEY) === '1';
  } catch {
    return false;
  }
}

function clearOneTimeReload(browser) {
  try {
    browser.sessionStorage.removeItem(LEGACY_SERVICE_WORKER_RELOAD_KEY);
  } catch {
    // The cleanup still succeeds when session storage is blocked.
  }
}

export async function cleanupLegacyServiceWorkerAndCaches(browserArg) {
  const browser = getBrowserContext(browserArg);
  if (!browser) return { controlled: false, registrations: 0, caches: 0, reloaded: false };

  const serviceWorker = browser.navigator?.serviceWorker;
  const controlled = Boolean(serviceWorker?.controller);
  let removedRegistrations = 0;
  let removedCaches = 0;

  if (serviceWorker?.getRegistrations) {
    try {
      const registrations = await serviceWorker.getRegistrations();
      const results = await Promise.allSettled(
        registrations.map((registration) => registration.unregister())
      );
      removedRegistrations = results.filter(
        (result) => result.status === 'fulfilled' && result.value !== false
      ).length;
    } catch {
      // Continue with cache cleanup when registration access is blocked.
    }
  }

  if (browser.caches?.keys) {
    try {
      const cacheNames = await browser.caches.keys();
      const results = await Promise.allSettled(
        cacheNames.map((cacheName) => browser.caches.delete(cacheName))
      );
      removedCaches = results.filter(
        (result) => result.status === 'fulfilled' && result.value !== false
      ).length;
    } catch {
      // A normal online reload can still update the app when cache access fails.
    }
  }

  const shouldReload = controlled && (removedRegistrations > 0 || removedCaches > 0);
  if (shouldReload && armOneTimeReload(browser)) {
    browser.location?.reload?.();
    return {
      controlled,
      registrations: removedRegistrations,
      caches: removedCaches,
      reloaded: true,
    };
  }

  if (!controlled) clearOneTimeReload(browser);
  return {
    controlled,
    registrations: removedRegistrations,
    caches: removedCaches,
    reloaded: false,
  };
}
