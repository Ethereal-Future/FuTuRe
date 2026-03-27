import { useEffect, useState, useCallback } from 'react';

/**
 * Handles service worker registration, install prompt, and update detection.
 * Returns { canInstall, install, updateAvailable, applyUpdate }
 */
export function usePWA() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [swReg, setSwReg] = useState(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      setSwReg(reg);

      // Detect update waiting
      const checkUpdate = () => {
        if (reg.waiting) setUpdateAvailable(true);
      };
      checkUpdate();
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', () => {
          if (reg.waiting) setUpdateAvailable(true);
        });
      });
    }).catch(console.error);

    // Capture install prompt
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  }, [installPrompt]);

  const applyUpdate = useCallback(() => {
    if (!swReg?.waiting) return;
    swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  }, [swReg]);

  return {
    canInstall: !!installPrompt,
    install,
    updateAvailable,
    applyUpdate,
  };
}
