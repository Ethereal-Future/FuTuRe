import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client.js';

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkSupport = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setSupported(false);
        return;
      }

      setSupported(true);
      setPermission(Notification.permission);

      try {
        // Check if already subscribed
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(!!sub);
      } catch (err) {
        console.error('Error checking push subscription:', err);
      }
    };

    checkSupport();
  }, []);

  const subscribe = useCallback(async (publicKey) => {
    if (!supported) {
      setError('Push notifications not supported');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      // Request permission
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== 'granted') {
          setError('Notification permission denied');
          setLoading(false);
          return false;
        }
      }

      // Get service worker
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        // Create new subscription with VAPID public key if available
        const options = { userVisibleOnly: true };
        // Note: In production, include vapidPublicKey from environment
        // const vapidPublicKey = process.env.REACT_APP_VAPID_PUBLIC_KEY;
        // if (vapidPublicKey) {
        //   options.applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        // }

        sub = await reg.pushManager.subscribe(options);
      }

      // Save subscription to backend
      await apiClient.post('/api/notifications/push/subscribe', {
        subscription: sub.toJSON(),
        publicKey,
      });

      setSubscribed(true);

      // Start monitoring for payments
      await startMonitoring(publicKey);

      return true;
    } catch (err) {
      const message = err?.response?.data?.error || err.message || 'Failed to subscribe';
      setError(message);
      console.error('Push subscription error:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supported]);

  const unsubscribe = useCallback(async (publicKey) => {
    setLoading(true);
    setError(null);

    try {
      // Stop monitoring
      await stopMonitoring(publicKey);

      // Unsubscribe from push
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }

      setSubscribed(false);
      return true;
    } catch (err) {
      const message = err?.response?.data?.error || err.message || 'Failed to unsubscribe';
      setError(message);
      console.error('Push unsubscription error:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const startMonitoring = useCallback(async (publicKey) => {
    try {
      await apiClient.post('/api/notifications/push/monitor', { publicKey });
      setMonitoring(true);
      return true;
    } catch (err) {
      console.error('Failed to start monitoring:', err);
      return false;
    }
  }, []);

  const stopMonitoring = useCallback(async (publicKey) => {
    try {
      await apiClient.delete(`/api/notifications/push/monitor/${publicKey}`);
      setMonitoring(false);
      return true;
    } catch (err) {
      console.error('Failed to stop monitoring:', err);
      return false;
    }
  }, []);

  const checkMonitoring = useCallback(async (publicKey) => {
    try {
      const { data } = await apiClient.get(`/api/notifications/push/monitor/${publicKey}`);
      setMonitoring(data.monitoring);
      return data.monitoring;
    } catch (err) {
      console.error('Failed to check monitoring status:', err);
      return false;
    }
  }, []);

  return {
    supported,
    permission,
    subscribed,
    monitoring,
    loading,
    error,
    subscribe,
    unsubscribe,
    startMonitoring,
    stopMonitoring,
    checkMonitoring,
  };
}
