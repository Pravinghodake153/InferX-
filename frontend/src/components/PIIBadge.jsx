import { useState } from 'react';
import { PIIAPI } from '../services/api';
import { Building2, ClipboardList, IdCard, Phone, Mail, User, Lock, Unlock } from 'lucide-react';

const getIcon = (token, revealed) => {
  if (revealed) return <Unlock size={12} className="inline-icon" />;
  if (token.startsWith('ORG_')) return <Building2 size={12} className="inline-icon" />;
  if (token.startsWith('ID_GSTIN_')) return <ClipboardList size={12} className="inline-icon" />;
  if (token.startsWith('ID_PAN_')) return <IdCard size={12} className="inline-icon" />;
  if (token.startsWith('CONTACT_PHONE_')) return <Phone size={12} className="inline-icon" />;
  if (token.startsWith('CONTACT_EMAIL_')) return <Mail size={12} className="inline-icon" />;
  if (token.startsWith('PERSON_')) return <User size={12} className="inline-icon" />;
  return <Lock size={12} className="inline-icon" />;
};

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
      title={revealed ? 'Revealed • Audit logged' : 'Hover to reveal (logged)'}
    >
      <span className="lock-icon">{getIcon(token, revealed)}</span>
      {loading ? '...' : value}
    </span>
  );
}
