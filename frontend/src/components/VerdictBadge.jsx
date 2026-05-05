export default function VerdictBadge({ verdict }) {
  const map = {
    PASS: { cls: 'pass', icon: '✅', label: 'PASS' },
    FAIL: { cls: 'fail', icon: '❌', label: 'FAIL' },
    REVIEW: { cls: 'review', icon: '⚠️', label: 'REVIEW' },
    REVIEW_REQUIRED: { cls: 'review', icon: '⚠️', label: 'REVIEW' },
  };

  const info = map[verdict] || map['REVIEW'];

  return (
    <span className={`verdict ${info.cls}`}>
      {info.icon} {info.label}
    </span>
  );
}
