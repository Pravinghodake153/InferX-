import { useState } from 'react';
import { PIIAPI } from '../services/api';
import { getTokenIcon } from '../services/pii';

export default function PIIBadge({ token, officerId = 'OFF-001', sessionId = 'default' }) {
  const [value, setValue] = useState(token);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReveal = async () => {
    if (revealed || loading) return;
    setLoading(true);
    try {
      const res = await PIIAPI.reveal({
        token,
        officer_id: officerId,
        context: 'UI hover reveal',
        session_id: sessionId,
      });
      if (res.data.revealed) {
        setValue(res.data.original);
        setRevealed(true);
      }
    } catch (err) {
      console.error('PII reveal failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <span
      className={`pii-badge ${revealed ? 'revealed' : ''}`}
      onMouseEnter={handleReveal}
      title={revealed ? '🔓 Revealed • Audit logged' : '🔒 Hover to reveal (logged)'}
    >
      <span className="lock-icon">{revealed ? '🔓' : getTokenIcon(token)}</span>
      {loading ? '...' : value}
    </span>
  );
}
