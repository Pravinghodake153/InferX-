export default function DiffView({ changes }) {
  if (!changes || changes.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No changes</p>;
  }

  return (
    <div className="diff-view">
      {changes.map((change, i) => (
        <div key={i}>
          <div className="diff-line" style={{ background: 'var(--bg-secondary)', fontWeight: 600, fontSize: '0.75rem' }}>
            {change.criterion_id} — {change.field}
          </div>
          <div className="diff-line removed">
            <span className="prefix">−</span>
            {change.old_value || '(empty)'}
          </div>
          <div className="diff-line added">
            <span className="prefix">+</span>
            {change.new_value || '(empty)'}
          </div>
          {change.reason && (
            <div className="diff-line" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Reason: {change.reason}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
