import { useEffect, useState } from 'react';

// The installable app: the service worker (built by sw-plugin.ts), the "new version ready" signal, the
// install prompt, and asking the browser to keep our storage.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true);
export const isIos = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Ask the browser not to clear our saves under storage pressure. Installed apps usually get it silently. */
export function keepStorage() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}

export function startPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    keepStorage();
    notify();
  });
  if (isStandalone()) keepStorage();
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          w.addEventListener('statechange', () => {
            // A new version finished downloading while an older one runs this page.
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              waiting = w;
              notify();
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) {
          waiting = reg.waiting;
          notify();
        }
        reg.addEventListener('updatefound', () => track(reg.installing));
        // Look for a new deploy now and then while the game stays open.
        setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => {});
    // Reload only when a new version takes over from an old one (the player tapped "Reload"). On a first visit
    // the worker taking control of the page is not an update, and reloading then would throw a brand-new
    // player out of whatever they just started (the tutorial, an online room).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

export interface PwaState {
  /** The browser offers its own install dialog (Chrome, Edge, Android). */
  canPrompt: boolean;
  /** iPhone / iPad Safari: installing is Share → Add to Home Screen. */
  iosManual: boolean;
  installed: boolean;
  updateReady: boolean;
}

export function usePwa(): PwaState & { install: () => Promise<void>; applyUpdate: () => void } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const installed = isStandalone();
  return {
    canPrompt: !!installEvent && !installed,
    iosManual: !installed && isIos(),
    installed,
    updateReady: !!waiting,
    install: async () => {
      if (!installEvent) return;
      await installEvent.prompt();
      await installEvent.userChoice.catch(() => null);
      installEvent = null;
      notify();
    },
    applyUpdate: () => waiting?.postMessage('skipWaiting'),
  };
}
