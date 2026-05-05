import { useState } from 'react';
import { VarianceAPI } from '../services/api';

export default function VarianceAlert({ data, onResolved }) {
  const [resolving, setResolving] = useState(false);
  const [reason, setReason] = useState('');
  const [resolved, setResolved] = useState(!!data.resolution);

  const statusMap = {
    MINOR_VARIANCE: { cls: 'minor', icon: '⚠️', label: 'Minor Variance' },
    MAJOR_VARIANCE: { cls: 'major', icon: '🚨', label: 'Major Variance' },
    MATCH: { cls: 'match', icon: '✅', label: 'Match' },
    NOT_AVAILABLE: { cls: 'minor', icon: '❓', label: 'No Sandbox Data' },
  };

  const info = statusMap[data.variance_status] || statusMap['NOT_AVAILABLE'];

  const resolve = async (resolution) => {
    if (!reason.trim()) return alert('Reason is mandatory for variance resolution.');
    setResolving(true);
    try {
      await VarianceAPI.resolve({
        variance_id: data.variance_id,
        resolution,
        officer_id: 'OFF-001',
        reason,
      });
      setResolved(true);
      onResolved?.(data.variance_id, resolution);
    } catch (err) {
      console.error('Variance resolution failed:', err);
    } finally {
      setResolving(false);
    }
  };

  if (data.variance_status === 'MATCH' || data.variance_status === 'NOT_AVAILABLE') return null;

  return (
    <div className={`variance-alert ${info.cls}`}>
      <div className="variance-header">
        <strong>{info.icon} {info.label}: {data.criterion_name}</strong>
        {data.numeric_diff_pct !== null && (
          <span style={{ fontSize: '0.8rem' }}>{data.numeric_diff_pct}% difference</span>
        )}
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{data.variance_detail}</p>
      <div className="variance-values">
        <div className="variance-value">
          <label>Document Value</label>
          <strong>{data.document_value || '—'}</strong>
        </div>
        <div className="variance-value">
          <label>Sandbox Value</label>
          <strong>{data.sandbox_value || '—'}</strong>
        </div>
      </div>
      {!resolved && (
        <>
          <input
            className="form-input"
            placeholder="Reason for resolution (mandatory)..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="variance-actions">
            <button className="btn btn-sm btn-primary" onClick={() => resolve('ACCEPT_DOCUMENT')} disabled={resolving}>
              📄 Accept Document
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => resolve('ACCEPT_SANDBOX')} disabled={resolving}>
              🏛️ Accept Sandbox
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => resolve('REVIEW')} disabled={resolving}>
              🔍 Review Later
            </button>
          </div>
        </>
      )}
      {resolved && (
        <p style={{ color: 'var(--pass)', fontWeight: 600, fontSize: '0.85rem' }}>
          ✅ Resolved: {data.resolution || 'Completed'}
        </p>
      )}
    </div>
  );
}
