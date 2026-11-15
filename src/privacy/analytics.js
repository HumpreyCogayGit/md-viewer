// Consent-based analytics. Nothing is loaded or sent unless the user explicitly allows it.
import { KEYS, readJson, writeJson } from '../editor/storage.js';

export const ANALYTICS_ID = import.meta.env?.VITE_GA_ID ?? 'G-905EDD1XJW';

export const getConsent = (storage) => readJson(KEYS.consent, null, storage); // 'granted' | 'denied' | null
export const setConsent = (value, storage) => writeJson(KEYS.consent, value, storage);

let loaded = false;

export function enableAnalytics(id = ANALYTICS_ID, doc = globalThis.document, win = globalThis.window) {
  if (!id || !doc || !win) return false;
  win[`ga-disable-${id}`] = false;
  if (loaded) return true;
  loaded = true;
  win.dataLayer = win.dataLayer || [];
  win.gtag = function gtag() {
    win.dataLayer.push(arguments);
  };
  win.gtag('js', new Date());
  // Never send page content; anonymize IP and avoid ad personalisation signals.
  win.gtag('config', id, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  doc.head.appendChild(script);
  return true;
}

export function disableAnalytics(id = ANALYTICS_ID, win = globalThis.window) {
  if (win) win[`ga-disable-${id}`] = true;
}

export const analyticsLoaded = () => loaded;
