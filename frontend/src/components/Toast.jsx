import { useState, useCallback, useRef } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';
import { ToastContext } from './useToast';

const ICONS = {
  info: <Info size={18} />,
  success: <CheckCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  error: <XCircle size={18} />,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const dismissToast = useCallback((id) => {
    // Clear any pending auto-dismiss timer
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  const addToast = useCallback((type, title, message, duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, title, message, exiting: false }]);

    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => dismissToast(id), duration);
    }
    return id;
  }, [dismissToast]);

  // Convenience methods
  const toast = {
    info: (title, msg, dur) => addToast('info', title, msg, dur),
    success: (title, msg, dur) => addToast('success', title, msg, dur),
    warning: (title, msg, dur) => addToast('warning', title, msg, dur),
    error: (title, msg, dur) => addToast('error', title, msg, dur || 6000),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type} ${t.exiting ? 'toast-exit' : ''}`}>
            <span style={{ marginTop: 1 }}>{ICONS[t.type]}</span>
            <div className="toast-content">
              <div className="toast-title">{t.title}</div>
              {t.message && <div className="toast-message">{t.message}</div>}
            </div>
            <button className="toast-close" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
