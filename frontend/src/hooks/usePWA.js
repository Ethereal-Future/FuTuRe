import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

/**
 * Handles service worker registration, install prompt, update detection,
 * and Web Push subscription.
 * Returns { canInstall, install, updateAvailable, applyUpdate, pushEnabled, enablePush }
 */
export function usePWA() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [swReg, setSwReg] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(false);

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

  /**
   * Request push permission, subscribe via the SW, and POST the subscription
   * to the backend. Requires the user to be authenticated (JWT in cookie/header).
   * @param {string} [publicKey] - Stellar public key to associate with the subscription
   */
  const enablePush = useCallback(async (publicKey) => {
    if (!swReg || !('PushManager' in window)) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const subscription = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        // In production, replace with your VAPID public key
        applicationServerKey: urlBase64ToUint8Array(
          import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
        ),
      });

      await axios.post('/api/notifications/push/subscribe', { subscription, publicKey });
      setPushEnabled(true);
    } catch (err) {
      console.error('Push subscription failed:', err);
    }
  }, [swReg]);

  return {
    canInstall: !!installPrompt,
    install,
    updateAvailable,
    applyUpdate,
    pushEnabled,
    enablePush,
  };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
