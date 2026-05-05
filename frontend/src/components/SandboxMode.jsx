import { useState, useMemo } from 'react';
import { SandboxAPI, AuditAPI } from '../services/api';
import { useApp } from '../context/useApp';

/**
 * SandboxMode — UBID-compliant sandbox data ingestion.
 *
 * Rules enforced:
 *  - All entities identified by UBID only (no custom IDs)
 *  - UBID visible on every record
 *  - Sandbox data tagged [SANDBOX] for source tracking
 *  - Every fetch is audit-logged
 *  - No raw PII sent to LLM — sandbox data passes through PII masking layer
 *  - Same fetch → same result (idempotent)
 *  - No source system modification
 */
export default function SandboxMode({ onIngest }) {
  const { selectedProjectId, updateProject, addProject } = useApp();

  // ── Fetch State ──
  const [tenders, setTenders] = useState([]);
  const [bidders, setBidders] = useState([]);
  const [loadingTenders, setLoadingTenders] = useState(false);
  const [loadingBidders, setLoadingBidders] = useState(false);

  // ── Selection State (UBID-based only) ──
  const [selectedTenderUbid, setSelectedTenderUbid] = useState(null);
  const [selectedBidderUbids, setSelectedBidderUbids] = useState([]);

  // ── Ingestion State ──
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState('');
  const [ingested, setIngested] = useState(false);

  // ── Audit: Log sandbox fetch ──
  const logSandboxFetch = async (action, count, ubids = []) => {
    try {
      await AuditAPI.getLogs({ limit: 1 }); // Verify audit is reachable
      // The actual audit logging happens server-side on the sandbox endpoints.
      // Additional client-side log for traceability:
      console.info(`[AUDIT] ${action} | officer=OFF-001 | count=${count} | ubids=${ubids.join(',')}`);
    } catch {
      console.warn('Audit endpoint unreachable, continuing with local log');
    }
  };

  // ── Fetch Tenders ──
  const handleFetchTenders = async () => {
    setLoadingTenders(true);
    setError('');
    try {
      const res = await SandboxAPI.getTenders();
      const fetchedTenders = res.data.tenders || [];
      setTenders(fetchedTenders);

      // Audit log
      const ubids = fetchedTenders.map(t => t.ubid).filter(Boolean);
      await logSandboxFetch('SANDBOX_FETCH_TENDERS', fetchedTenders.length, ubids);
    } catch (err) {
      setError('Failed to fetch tenders from sandbox API.');
      console.error(err);
    } finally {
      setLoadingTenders(false);
    }
  };

  // ── Fetch Bidders ──
  const handleFetchBidders = async () => {
    setLoadingBidders(true);
    setError('');
    try {
      let res;
      if (selectedTenderUbid) {
        res = await SandboxAPI.getBiddersForTender(selectedTenderUbid);
      } else {
        res = await SandboxAPI.getBidders();
      }
      const fetchedBidders = res.data.bidders || [];
      setBidders(fetchedBidders);

      // Audit log
      const ubids = fetchedBidders.map(b => b.ubid).filter(Boolean);
      await logSandboxFetch('SANDBOX_FETCH_BIDDERS', fetchedBidders.length, ubids);
    } catch (err) {
      setError('Failed to fetch bidders from sandbox API.');
      console.error(err);
    } finally {
      setLoadingBidders(false);
    }
  };

  // ── Toggle Bidder Selection ──
  const toggleBidder = (ubid) => {
    setSelectedBidderUbids(prev =>
      prev.includes(ubid) ? prev.filter(u => u !== ubid) : [...prev, ubid]
    );
  };

  // ── Select Tender ──
  const handleSelectTender = (ubid) => {
    setSelectedTenderUbid(prev => prev === ubid ? null : ubid);
    setSelectedBidderUbids([]); // Reset bidder selections on tender change
  };

  // ── Selected Data (derived) ──
  const selectedTender = useMemo(() =>
    tenders.find(t => t.ubid === selectedTenderUbid),
    [tenders, selectedTenderUbid]
  );

  const selectedBidders = useMemo(() =>
    bidders.filter(b => selectedBidderUbids.includes(b.ubid)),
    [bidders, selectedBidderUbids]
  );

  const canIngest = selectedTenderUbid && selectedBidderUbids.length > 0;

  // ── Ingest into Pipeline ──
  const handleIngest = async () => {
    if (!canIngest) return;
    setIngesting(true);
    setError('');

    try {
      // Ensure project exists
      let projId = selectedProjectId;
      if (!projId) {
        const tenderName = selectedTender?.name || selectedTender?.tender_name || 'Sandbox Tender';
        projId = addProject({ name: tenderName });
      }

      // Build sandbox data payload with source tags
      const sandboxPayload = {
        source: 'SANDBOX',
        tender_ubid: selectedTenderUbid,
        tender: {
          ...selectedTender,
          _source: 'SANDBOX',
          _ubid: selectedTenderUbid,
        },
        bidders: selectedBidders.map(b => ({
          ...b,
          _source: 'SANDBOX',
          _ubid: b.ubid,
        })),
        bidder_ubids: selectedBidderUbids,
      };

      // Store in project state
      updateProject(projId, {
        status: 'uploaded',
        sandboxMode: true,
        sandboxData: sandboxPayload,
        sandboxTenderUbid: selectedTenderUbid,
        sandboxBidderUbids: selectedBidderUbids,
      });

      // Audit log: ingestion
      await logSandboxFetch(
        'SANDBOX_INGEST',
        1 + selectedBidderUbids.length,
        [selectedTenderUbid, ...selectedBidderUbids]
      );

      setIngested(true);

      // Notify parent
      if (onIngest) onIngest(sandboxPayload);
    } catch (err) {
      setError('Failed to ingest sandbox data.');
      console.error(err);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div>
      {/* ── Fetch Controls ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>🌐 Sandbox API</h3>
          <span className="header-badge mock">Sandbox (Synthetic Data)</span>
        </div>

        {/* Interoperability Label — TASK 3 */}
        <div style={{
          padding: '8px 14px', background: 'var(--accent-light)',
          borderRadius: 'var(--radius-sm)', marginBottom: 14,
          border: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: '1rem' }}>🔗</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Interoperability Layer
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            (UBID-based, external schema — read-only)
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            className="btn btn-primary"
            onClick={handleFetchTenders}
            disabled={loadingTenders}
          >
            {loadingTenders ? (
              <><span className="spinner" style={{ width: 14, height: 14 }}></span> Fetching...</>
            ) : (
              '📋 Fetch Tenders'
            )}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleFetchBidders}
            disabled={loadingBidders}
          >
            {loadingBidders ? (
              <><span className="spinner" style={{ width: 14, height: 14 }}></span> Fetching...</>
            ) : (
              '🏢 Fetch Bidders'
            )}
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          All sandbox fetches are audit-logged. UBIDs are used as the sole identifier. No source system modification.
        </p>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '12px 16px', background: 'var(--fail-bg)', border: '1px solid #fecaca',
          borderRadius: 'var(--radius-md)', color: 'var(--fail)', marginBottom: 16, fontSize: '0.875rem',
        }}>
          ❌ {error}
        </div>
      )}

      {/* ── Sandbox Tenders Table ── */}
      {tenders.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3>📋 Sandbox Tenders</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {tenders.length} tenders • Select one
            </span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Tender Name</th>
                <th>Authority</th>
                <th>Value</th>
                <th>UBID</th>
                <th>Type</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {tenders.map(t => {
                const ubid = t.ubid || '';
                const isSelected = selectedTenderUbid === ubid;
                const name = t.name || t.tender_name || '—';
                const authority = t.authority || t.issuing_authority || '—';
                const value = t.estimated_value || '—';

                return (
                  <tr
                    key={ubid}
                    onClick={() => handleSelectTender(ubid)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'var(--accent-light)' : undefined,
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    <td>
                      <input
                        type="radio"
                        checked={isSelected}
                        onChange={() => handleSelectTender(ubid)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td><strong>{name}</strong></td>
                    <td>{authority}</td>
                    <td>{value}</td>
                    <td>
                      <code
                        title={ubid}
                        style={{
                          fontSize: '0.7rem', padding: '2px 6px',
                          background: 'var(--pii-bg)', color: 'var(--pii-token)',
                          borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                          cursor: 'help',
                        }}
                      >
                        {ubid.length > 18 ? ubid.slice(0, 18) + '…' : ubid}
                      </code>
                    </td>
                    <td>
                      <span className="header-badge mock">{t.tender_type || 'Open'}</span>
                    </td>
                    <td>
                      <span className="header-badge mock">SANDBOX</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Sandbox Bidders Table ── */}
      {bidders.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3>🏢 Sandbox Bidders</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {bidders.length} bidders • Select one or more
            </span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Bidder Name</th>
                <th>Category</th>
                <th>Turnover</th>
                <th>UBID</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {bidders.map(b => {
                const ubid = b.ubid || '';
                const isSelected = selectedBidderUbids.includes(ubid);
                const name = b.name || b.company_name || '—';

                return (
                  <tr
                    key={ubid}
                    onClick={() => toggleBidder(ubid)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'var(--accent-light)' : undefined,
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleBidder(ubid)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td><strong>{name}</strong></td>
                    <td>{b.category || '—'}</td>
                    <td>{b.annual_turnover || b.turnover || '—'}</td>
                    <td>
                      <code
                        title={ubid}
                        style={{
                          fontSize: '0.7rem', padding: '2px 6px',
                          background: 'var(--pii-bg)', color: 'var(--pii-token)',
                          borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                          cursor: 'help',
                        }}
                      >
                        {ubid.length > 18 ? ubid.slice(0, 18) + '…' : ubid}
                      </code>
                    </td>
                    <td>
                      <span className="header-badge mock">SANDBOX</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Selection Summary + Ingest ── */}
      {(selectedTenderUbid || selectedBidderUbids.length > 0) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3>✅ Selection Summary</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: '0.8rem', width: 80 }}>Tender:</span>
              {selectedTender ? (
                <span>
                  {selectedTender.name || selectedTender.tender_name}
                  <code style={{
                    marginLeft: 8, fontSize: '0.7rem', padding: '1px 4px',
                    background: 'var(--pii-bg)', color: 'var(--pii-token)',
                    borderRadius: 3,
                  }}>
                    {selectedTenderUbid}
                  </code>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>None selected</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: '0.8rem', width: 80, flexShrink: 0 }}>Bidders:</span>
              {selectedBidders.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedBidders.map(b => (
                    <div key={b.ubid} style={{
                      padding: '2px 8px', background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)',
                      fontSize: '0.8rem',
                    }}>
                      {b.name || b.company_name}
                      <code style={{
                        marginLeft: 4, fontSize: '0.65rem',
                        color: 'var(--pii-token)',
                      }}>
                        {b.ubid?.slice(-8)}
                      </code>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>None selected</span>
              )}
            </div>
          </div>

          {/* Pipeline note */}
          <div style={{
            padding: '8px 12px', background: 'var(--review-bg)',
            borderRadius: 'var(--radius-sm)', marginBottom: 12,
            fontSize: '0.75rem', color: 'var(--review)',
            border: '1px solid #fde68a',
          }}>
            ⚠️ Sandbox data will pass through PII masking before reaching the LLM. No raw PII will be exposed.
          </div>

          {ingested ? (
            <div style={{
              padding: '12px 16px', background: 'var(--pass-bg)',
              border: '1px solid #bbf7d0', borderRadius: 'var(--radius-sm)',
              color: 'var(--pass)', fontSize: '0.85rem',
            }}>
              ✅ Sandbox data ingested successfully. Proceed to Review & Correct.
            </div>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleIngest}
              disabled={!canIngest || ingesting}
              style={{ padding: '10px 24px' }}
            >
              {ingesting ? (
                <><span className="spinner" style={{ width: 14, height: 14 }}></span> Ingesting...</>
              ) : (
                `🔗 Ingest Selected Data (${1 + selectedBidderUbids.length} records via UBID)`
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
