// Offline support: register the service worker in production builds only.
export function registerServiceWorker({
  enabled = import.meta.env.PROD,
  nav = globalThis.navigator,
  win = globalThis.window,
} = {}) {
  if (!enabled || !nav?.serviceWorker || !win) return false;
  win.addEventListener('load', () => {
    nav.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is optional; the app works without it.
    });
  });
  return true;
}
