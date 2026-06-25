import { useEffect, useState, useCallback } from 'react';
import { subscribePushNotification } from '../api/stellar.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function webAuthnPost(path, body) {
  const res = await fetch(`${API_BASE}/api/mobile/auth/webauthn/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'WebAuthn request failed');
  return data;
}

/**
 * WebAuthn registration and authentication for mobile PWA.
 * Falls back gracefully when the Web Authentication API is not available.
 *
 * @param {string} userId - The authenticated user ID
 * @returns {{ isSupported, registerBiometric, loginWithBiometric, webAuthnError }}
 */
export function useWebAuthn(userId) {
  const isSupported =
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function';

  const [webAuthnError, setWebAuthnError] = useState(null);

  const registerBiometric = useCallback(
    async (deviceName) => {
      if (!isSupported) throw new Error('WebAuthn is not supported on this device');
      setWebAuthnError(null);
      try {
        // Phase 1: get registration options from server
        const options = await webAuthnPost('register', { userId, deviceName });

        // Convert base64url challenge to ArrayBuffer for the browser API
        const challengeBuffer = Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        const userIdBuffer = Uint8Array.from(atob(options.user.id.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

        const credential = await navigator.credentials.create({
          publicKey: {
            ...options,
            challenge: challengeBuffer,
            user: { ...options.user, id: userIdBuffer },
          },
        });

        if (!credential) throw new Error('Credential creation was cancelled');

        // Encode the public key for transmission
        const publicKey = btoa(String.fromCharCode(...new Uint8Array(credential.response.getPublicKey?.() ?? [])));

        // Phase 2: send credential to server for storage
        return await webAuthnPost('register', {
          userId,
          challengeId: options.challengeId,
          credential: { id: credential.id, publicKey },
          deviceName,
        });
      } catch (err) {
        setWebAuthnError(err.message);
        throw err;
      }
    },
    [userId, isSupported]
  );

  const loginWithBiometric = useCallback(
    async () => {
      if (!isSupported) throw new Error('WebAuthn is not supported on this device');
      setWebAuthnError(null);
      try {
        // Phase 1: get authentication options from server
        const options = await webAuthnPost('authenticate', { userId });

        const challengeBuffer = Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        const allowCredentials = (options.allowCredentials || []).map((c) => ({
          ...c,
          id: Uint8Array.from(atob(c.id.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)),
        }));

        const assertion = await navigator.credentials.get({
          publicKey: {
            ...options,
            challenge: challengeBuffer,
            allowCredentials,
          },
        });

        if (!assertion) throw new Error('Authentication was cancelled');

        const signature = btoa(String.fromCharCode(...new Uint8Array(assertion.response.signature)));

        // Phase 2: verify assertion with server
        return await webAuthnPost('authenticate', {
          userId,
          challengeId: options.challengeId,
          assertion: { credentialId: assertion.id, signature },
        });
      } catch (err) {
        setWebAuthnError(err.message);
        throw err;
      }
    },
    [userId, isSupported]
  );

  return { isSupported, registerBiometric, loginWithBiometric, webAuthnError };
}

const DISMISS_KEY = 'pwa_install_dismissed_at';
const DISMISS_DAYS = 7;

function trackInstallEvent(event) {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'pwa_install_prompt', { action: event });
    }
  } catch (_) {}
}

/**
 * Handles service worker registration, install prompt, update detection,
 * and Web Push subscription.
 * Returns { canInstall, install, isDismissed, dismissInstall, updateAvailable,
 *           applyUpdate, pushEnabled, enablePush }
 */
export function usePWA() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      const ts = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      return ts > 0 && Date.now() - ts < DISMISS_DAYS * 86_400_000;
    } catch {
      return false;
    }
  });
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [swReg, setSwReg] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
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
      })
      .catch(console.error);

    // Capture install prompt
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      trackInstallEvent('shown');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      trackInstallEvent('accepted');
      setInstallPrompt(null);
    } else {
      trackInstallEvent('dismissed_native');
    }
  }, [installPrompt]);

  const dismissInstall = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_) {}
    setDismissed(true);
    trackInstallEvent('dismissed');
  }, []);

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
  const enablePush = useCallback(
    async (publicKey) => {
      if (!swReg || !('PushManager' in window)) return;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const subscription = await swReg.pushManager.subscribe({
          userVisibleOnly: true,
          // In production, replace with your VAPID public key
          applicationServerKey: urlBase64ToUint8Array(
            import.meta.env.VITE_VAPID_PUBLIC_KEY ||
              'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
          ),
        });

        await subscribePushNotification({ subscription, publicKey });
        setPushEnabled(true);
      } catch (err) {
        console.error('Push subscription failed:', err);
      }
    },
    [swReg]
  );

  return {
    canInstall: !!installPrompt,
    install,
    isDismissed: dismissed,
    dismissInstall,
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
