import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

const NOTIFICATION_COLORS = {
  transaction: '#3b82f6',
  security: '#ef4444',
  system: '#6b7280',
  promotion: '#8b5cf6',
};

function NotificationItem({ notification, onMarkAsRead }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onClick={() => !notification.read && onMarkAsRead(notification.id)}
      style={{
        padding: '12px',
        borderLeft: `4px solid ${NOTIFICATION_COLORS[notification.type] || '#6b7280'}`,
        background: notification.read ? '#f9fafb' : '#f0f9ff',
        borderRadius: '4px',
        cursor: notification.read ? 'default' : 'pointer',
        transition: 'background-color 0.2s',
        marginBottom: '8px',
      }}
      onMouseEnter={(e) => {
        if (!notification.read) e.currentTarget.style.background = '#dbeafe';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = notification.read ? '#f9fafb' : '#f0f9ff';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          {notification.title && (
            <p style={{
              margin: '0 0 4px 0',
              fontSize: '0.9rem',
              fontWeight: notification.read ? 400 : 600,
              color: '#1f2937',
            }}>
              {notification.title}
            </p>
          )}
          <p style={{
            margin: 0,
            fontSize: '0.85rem',
            color: '#666',
            lineHeight: 1.4,
          }}>
            {notification.body}
          </p>
          <p style={{
            margin: '4px 0 0 0',
            fontSize: '0.75rem',
            color: '#999',
          }}>
            {new Date(notification.createdAt).toLocaleTimeString()}
          </p>
        </div>
        {!notification.read && (
          <div style={{
            width: 8,
            height: 8,
            background: '#3b82f6',
            borderRadius: '50%',
            flexShrink: 0,
          }} />
        )}
      </div>
    </motion.div>
  );
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [markingAsRead, setMarkingAsRead] = useState(null);
  const dropdownRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/notifications');
      setNotifications(data || []);
      const unread = (data || []).filter((n) => !n.read).length;
      setUnreadCount(unread);
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    // Poll for notifications every 10 seconds
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleMarkAsRead = async (notificationId) => {
    setMarkingAsRead(notificationId);
    try {
      await axios.patch(`/api/notifications/${notificationId}/read`);
      
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, read: true } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    } finally {
      setMarkingAsRead(null);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await axios.post('/api/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const recentNotifications = notifications.slice(0, 5);

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          fontSize: '1.5rem',
          cursor: 'pointer',
          padding: '4px 8px',
          color: '#666',
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#2563eb'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        🔔
        {unreadCount > 0 && (
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              background: '#ef4444',
              color: '#fff',
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              border: '2px solid white',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </motion.div>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '8px',
              width: '360px',
              maxHeight: '500px',
              background: '#fff',
              borderRadius: '8px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                Notifications
              </h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '0.75rem',
                    color: '#2563eb',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Mark all as read
                </button>
              )}
            </div>

            {/* Content */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px',
            }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#999' }}>
                  Loading...
                </div>
              ) : recentNotifications.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '24px',
                  color: '#999',
                  fontSize: '0.9rem',
                }}>
                  No notifications yet. You're all caught up! 🎉
                </div>
              ) : (
                <div>
                  {recentNotifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={handleMarkAsRead}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {recentNotifications.length > 0 && (
              <div style={{
                borderTop: '1px solid #e5e7eb',
                padding: '10px 16px',
                textAlign: 'center',
              }}>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                  onClick={() => setIsOpen(false)}
                >
                  View All Notifications
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
