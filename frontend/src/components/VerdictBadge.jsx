import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export default function VerdictBadge({ verdict }) {
  const map = {
    PASS: { cls: 'pass', Icon: CheckCircle, label: 'PASS' },
    FAIL: { cls: 'fail', Icon: XCircle, label: 'FAIL' },
    REVIEW: { cls: 'review', Icon: AlertTriangle, label: 'REVIEW' },
    REVIEW_REQUIRED: { cls: 'review', Icon: AlertTriangle, label: 'REVIEW' },
  };

  const info = map[verdict] || map['REVIEW'];
  const { Icon } = info;

  return (
    <span className={`verdict ${info.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <Icon size={13} /> {info.label}
    </span>
  );
}
