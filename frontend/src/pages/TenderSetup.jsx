import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';

/**
 * TenderSetup — Extracted criteria review and lock.
 *
 * Pipeline gate:
 *  - Extraction must be complete before this page shows data
 *  - User MUST lock criteria schema before proceeding to Review
 *  - Locked criteria cannot be unlocked (audit trail)
 */
export default function TenderSetup() {
  const navigate = useNavigate();
  const { selectedProject, updateProject, selectedProjectId } = useApp();

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editName, setEditName] = useState('');
  const [showTenderContent, setShowTenderContent] = useState(false);
  const [showBidderContent, setShowBidderContent] = useState(false);

  const criteria = selectedProject?.extractedCriteria || [];
  const locked = selectedProject?.criteriaLocked || false;
  const extractionDone = selectedProject?.extractionStatus === 'complete';

  // Lock the schema
  const handleLockSchema = () => {
    if (!selectedProjectId || criteria.length === 0) return;
    updateProject(selectedProjectId, { criteriaLocked: true });
  };

  const handleStartEdit = (criterion) => {
    if (locked) return;
    setEditingId(criterion.criterion_id);
    setEditValue(criterion.required_value || '');
    setEditName(criterion.name || '');
  };

  const handleSaveEdit = (criterionId) => {
    if (!selectedProjectId) return;
    const updated = criteria.map(c =>
      c.criterion_id === criterionId ? { ...c, required_value: editValue, name: editName } : c
    );
    updateProject(selectedProjectId, { extractedCriteria: updated });
    setEditingId(null);
    setEditValue('');
    setEditName('');
  };

  // Add a criterion manually
  const handleAddCriterion = () => {
    if (locked || !selectedProjectId) return;
    const newCrit = {
      criterion_id: `CRIT_MANUAL_${Date.now().toString().slice(-4)}`,
      name: "New Manual Criterion",
      category: "technical",
      required_value: "Specify value",
      type: "string",
      mandatory: true
    };
    updateProject(selectedProjectId, { extractedCriteria: [...criteria, newCrit] });
    setEditingId(newCrit.criterion_id);
    setEditValue(newCrit.required_value);
    setEditName(newCrit.name);
  };

  // Proceed to review
  const handleProceedToReview = () => {
    if (!locked) return;
    updateProject(selectedProjectId, { status: 'reviewed' });
    navigate('/review');
  };

  // ── NOT EXTRACTED ──
  if (!selectedProject || !extractionDone) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1>Tender Setup</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Extract, review, and lock criteria from the tender document
          </p>
        </div>
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="icon">⚠️</div>
            <h3 style={{ marginBottom: 8 }}>Extraction Required</h3>
            <p>Documents must be uploaded and extraction pipeline must complete before criteria appear here.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/upload')}>
              📤 Go to Upload & Extract
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Category colors
  const catColor = (cat) => {
    if (cat === 'financial') return 'review';
    if (cat === 'technical') return 'pass';
    if (cat === 'compliance') return 'fail';
    return 'review';
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1>Tender Setup</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          Review extracted criteria, adjust if needed, then lock schema
        </p>
      </div>

      {/* Extraction Summary — Show ALL tender document extracted text */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>📄 Extracted Tender Content</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {Object.keys(selectedProject.extractedContent?.tender_documents || {}).length} document(s)
            </span>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setShowTenderContent(v => !v)}
              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            >
              {showTenderContent ? '▲ Hide' : '▼ View Extracted Data'}
            </button>
          </div>
        </div>
        {showTenderContent && (
          selectedProject.extractedContent?.tender_documents ? (
            Object.entries(selectedProject.extractedContent.tender_documents).map(([docName, docData]) => (
              <div key={docName} style={{ marginBottom: 12 }}>
                <div style={{
                  padding: '6px 12px', background: 'var(--accent-light)',
                  borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: '0.8rem',
                  color: 'var(--accent)', marginBottom: 4,
                }}>
                  📎 {docName}
                </div>
                <div style={{
                  fontFamily: 'monospace', fontSize: '0.78rem',
                  whiteSpace: 'pre-wrap', lineHeight: 1.6,
                  maxHeight: 300, overflow: 'auto',
                  padding: '8px 12px', background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}>
                  {docData.text || docData.package?.context_text || 'No text extracted for this document.'}
                </div>
              </div>
            ))
          ) : (
            <div style={{
              fontFamily: 'monospace', fontSize: '0.8rem',
              whiteSpace: 'pre-wrap', lineHeight: 1.6,
              padding: '8px 12px', background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-sm)',
            }}>
              {selectedProject.extractedText || 'No text extracted. Please run extraction from Upload page.'}
            </div>
          )
        )}
      </div>

      {/* Bidder Data */}
      {selectedProject.extractedBidderData?.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3>🏢 Extracted Bidder Data</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {selectedProject.extractedBidderData.length} bidder{selectedProject.extractedBidderData.length > 1 ? 's' : ''}
              </span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setShowBidderContent(v => !v)}
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              >
                {showBidderContent ? '▲ Hide' : '▼ View Extracted Data'}
              </button>
            </div>
          </div>
          {showBidderContent && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {selectedProject.extractedBidderData.map((bd, i) => (
                <div key={i} style={{
                  flex: '1 1 280px', padding: 12,
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-secondary)',
                }}>
                  <strong>{bd.bidder_name || bd.bidder_id}</strong>
                  {bd.extracted_text && (
                    <div style={{
                      fontFamily: 'monospace', fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap', lineHeight: 1.5,
                      maxHeight: 200, overflow: 'auto',
                      padding: '6px 8px', marginTop: 8,
                      background: '#f8fafc', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                    }}>
                      {bd.extracted_text}
                    </div>
                  )}
                  {bd.fields && Object.entries(bd.fields).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} style={{ fontSize: '0.8rem', marginTop: 4 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{k.replace(/_/g, ' ')}:</span>{' '}
                      <span style={{ fontWeight: 500 }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Criteria Extraction Logs — show what happened during extraction */}
      {selectedProject.criteriaExtractionLogs?.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3>📊 Criteria Extraction Log</h3>
            <span style={{
              fontSize: '0.75rem', fontWeight: 700,
              padding: '3px 10px', borderRadius: 4,
              background: selectedProject.criteriaExtractionMethod === 'llm' ? 'var(--pass-bg)' :
                          selectedProject.criteriaExtractionMethod === 'regex' ? 'var(--review-bg)' : 'var(--bg-secondary)',
              color: selectedProject.criteriaExtractionMethod === 'llm' ? 'var(--pass)' :
                     selectedProject.criteriaExtractionMethod === 'regex' ? 'var(--review)' : 'var(--text-muted)',
            }}>
              {selectedProject.criteriaExtractionMethod === 'llm' ? '🤖 AI Extracted' :
               selectedProject.criteriaExtractionMethod === 'regex' ? '📝 Regex Fallback' : '📋 Pipeline'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedProject.criteriaExtractionLogs.map((log, i) => (
              <div key={i} style={{
                fontSize: '0.82rem', padding: '6px 12px', borderRadius: 6,
                background: log.level === 'success' ? 'var(--pass-bg)' :
                            log.level === 'warning' ? 'var(--review-bg)' :
                            log.level === 'error' ? 'var(--fail-bg)' : 'var(--bg-secondary)',
                color: log.level === 'success' ? 'var(--pass)' :
                       log.level === 'warning' ? 'var(--review)' :
                       log.level === 'error' ? 'var(--fail)' : 'var(--text-muted)',
              }}>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Criteria Table */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>📋 Extracted Criteria ({criteria.length})</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {!locked && (
              <button className="btn btn-sm btn-secondary" onClick={handleAddCriterion}>
                ➕ Add Manual Criteria
              </button>
            )}
            {locked ? (
              <span className="verdict pass" style={{ fontSize: '0.8rem' }}>🔒 Schema Locked</span>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={handleLockSchema} disabled={criteria.length === 0}>
                🔒 Lock Schema
              </button>
            )}
          </div>
        </div>

        {criteria.length > 0 ? (
          <table className="data-table" style={{ fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Criterion</th>
                <th>Category</th>
                <th>Required Value</th>
                <th>Type</th>
                <th style={{ width: 70 }}>Mandatory</th>
                {!locked && <th style={{ width: 60 }}></th>}
              </tr>
            </thead>
            <tbody>
              {criteria.map(c => (
                <tr key={c.criterion_id} style={{
                  background: editingId === c.criterion_id ? 'var(--accent-light)' : undefined,
                }}>
                  <td><code style={{ fontSize: '0.75rem' }}>{c.criterion_id}</code></td>
                  <td>
                    {editingId === c.criterion_id ? (
                      <input
                        className="form-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ fontSize: '0.8rem', width: '100%' }}
                        placeholder="Criterion Name"
                      />
                    ) : (
                      <strong>{c.name}</strong>
                    )}
                    {c.description && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {c.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`verdict ${catColor(c.category)}`}>
                      {c.category || 'general'}
                    </span>
                  </td>
                  <td>
                    {editingId === c.criterion_id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          className="form-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          style={{ fontSize: '0.8rem', width: 120 }}
                          autoFocus
                        />
                        <button className="btn btn-sm btn-primary" onClick={() => handleSaveEdit(c.criterion_id)}>✓</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)}>✕</button>
                      </div>
                    ) : (
                      <span style={{ fontWeight: 500 }}>{c.required_value}</span>
                    )}
                  </td>
                  <td>{c.type || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{c.mandatory !== false ? '✅' : '—'}</td>
                  {!locked && (
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleStartEdit(c)} title="Edit">
                        ✏️
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <div className="icon">📋</div>
            <p>No criteria extracted. Check tender documents.</p>
          </div>
        )}
      </div>

      {/* Pipeline Info */}
      {!locked && criteria.length > 0 && (
        <div style={{
          padding: '12px 16px', background: 'var(--review-bg)',
          border: '1px solid #fde68a', borderRadius: 'var(--radius-md)',
          marginBottom: 16, fontSize: '0.85rem', color: 'var(--review)',
        }}>
          ⚠️ Review criteria above. Once locked, the schema cannot be changed. You must lock before proceeding to Review & Correct.
        </div>
      )}

      {/* Proceed Button */}
      <button
        className="btn btn-primary"
        onClick={handleProceedToReview}
        disabled={!locked}
        style={{ padding: '12px 32px', fontSize: '1rem' }}
      >
        {locked ? '📋 Proceed to Review & Correct →' : '🔒 Lock Schema First'}
      </button>
    </div>
  );
}
