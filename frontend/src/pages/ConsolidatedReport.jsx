import { useState } from 'react';
import { useApp } from '../context/useApp';
import { useToast } from '../components/useToast';
import VerdictBadge from '../components/VerdictBadge';
import ConsolidatedGraphs from '../components/ConsolidatedGraphs';
import { AlertTriangle, BarChart, CheckSquare, Square, XCircle, Hourglass, Zap, ClipboardList, Search, Lock, FileText, Table, RefreshCw, StopCircle } from 'lucide-react';
import { ProjectAPI } from '../services/api';

const API = import.meta.env.VITE_API_URL || '';

export default function ConsolidatedReport() {
  const { selectedProject, updateProject, activeProcess, startProcess, clearProcess } = useApp();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState(selectedProject?.consolidatedReport || null);
  const [error, setError] = useState('');
  const [selectedBidder, setSelectedBidder] = useState(null);
  const [abortController, setAbortController] = useState(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [hydratedExtraction, setHydratedExtraction] = useState(null);
  const toast = useToast();

  const isSandbox = selectedProject?.sandboxMode;
  const bidders = isSandbox 
    ? (selectedProject?.sandboxData?.bidders || []) 
    : (selectedProject?.bidders || []);
    
  // Use hydrated extraction data from MongoDB if local state is empty
  const tenderText = selectedProject?.extractedText || hydratedExtraction?.tender_text || '';
  const bidderData = selectedProject?.extractedBidderData?.length > 0 
    ? selectedProject.extractedBidderData 
    : (hydratedExtraction?.bidder_data || []);

  const canRun = tenderText && bidders.length > 0 && bidderData.length > 0;

  // ── Hydrate extraction data and consolidated report from MongoDB on load ──
  useState(() => {
    if (!selectedProject?.id) return;
    
    // Hydrate extraction data if missing from local state
    if (!selectedProject?.extractedText || !selectedProject?.extractedBidderData?.length) {
      ProjectAPI.getExtraction(selectedProject.id)
        .then(res => {
          if (res.data) {
            setHydratedExtraction(res.data);
            console.log('[Consolidated] Hydrated extraction from MongoDB');
          }
        })
        .catch(err => console.warn('[Consolidated] MongoDB extraction hydration failed:', err?.message));
    }

    // Hydrate consolidated report if missing
    if (!report) {
      ProjectAPI.getConsolidated(selectedProject.id)
        .then(res => {
          if (res.data?.report) {
            setReport(res.data.report);
            console.log('[Consolidated] Hydrated report from MongoDB');
          }
        })
        .catch(() => { /* No report yet — expected */ });
    }
  });

  const handleRunConsolidated = async (forceOverride = false) => {
    if (!canRun) return;

    // Process conflict guard
    if (!forceOverride && activeProcess) {
      setShowConflictModal(true);
      return;
    }

    setLoading(true);
    setError('');
    setProgress('Preparing bidder data...');
    startProcess('consolidated', { projectId: selectedProject?.id });

    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Build request from extracted data
      const bidderPayloads = bidders.map((b) => {
        const bId = isSandbox ? (b.ubid || b._ubid) : b.id;
        const bName = b.name || b.company_name || 'Bidder';
        const extracted = bidderData.find(d => d.bidder_id === bId);
        
        // In sandbox mode, if the strict ID match fails, fall back to index matching if length is exactly 1
        const extractedText = extracted?.extracted_text 
          || (isSandbox && bidders.length === 1 && bidderData.length === 1 ? bidderData[0].extracted_text : '');
          
        return {
          bidder_id: bId,
          bidder_name: bName,
          bidder_text: extractedText,
        };
      }).filter(b => b.bidder_text);

      if (bidderPayloads.length === 0) {
        setError('No bidder documents have extracted text. Please run extraction from the Upload page first.');
        setLoading(false);
        return;
      }

      // Get officer-approved criteria (decoupled architecture)
      const approvedCriteria = selectedProject.extractedCriteria || [];
      
      let currentReport = report || null;
      let existingBidderIds = currentReport ? currentReport.bidder_results.map(r => r.bidder_id) : [];
      
      // If user clicked re-run, report is null, so existingBidderIds is empty
      let biddersToProcess = bidderPayloads.filter(b => !existingBidderIds.includes(b.bidder_id));

      if (biddersToProcess.length === 0) {
        setProgress('All bidders are already evaluated.');
        setLoading(false);
        return;
      }

      // Process step-wise (1 bidder at a time) to avoid 15000 max token limits
      for (let i = 0; i < biddersToProcess.length; i++) {
        if (controller.signal.aborted) break;
        const b = biddersToProcess[i];
        setProgress(`⚡ Evaluating bidder ${i + 1} of ${biddersToProcess.length}: ${b.bidder_name}...`);

        const payload = {
          tender_text: tenderText,
          bidders: [b],
          criteria: approvedCriteria.length > 0 ? approvedCriteria : (currentReport ? currentReport.criteria : null)
        };

        const res = await fetch(`${API}/api/evaluate/consolidated`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Server error on bidder ${b.bidder_name}: ${res.status}`);
        }
        
        const data = await res.json();
        
        // Merge results incrementally
        if (!currentReport) {
          currentReport = data;
        } else {
          currentReport = {
             ...currentReport,
             bidder_results: [...currentReport.bidder_results, ...(data.bidder_results || [])],
             bidder_count: currentReport.bidder_count + (data.bidder_count || 0),
             summary: {
                eligible: currentReport.summary.eligible + data.summary.eligible,
                not_eligible: currentReport.summary.not_eligible + data.summary.not_eligible,
                review_required: currentReport.summary.review_required + data.summary.review_required,
             }
          };
        }
        
        setReport({ ...currentReport }); // force re-render
        if (selectedProject) {
          updateProject(selectedProject.id, { consolidatedReport: currentReport });
          
          // Save to MongoDB (persistent, no size limit)
          try {
            await ProjectAPI.saveConsolidated(selectedProject.id, currentReport);
          } catch (mongoErr) {
            console.warn('[Consolidated] MongoDB save failed:', mongoErr?.message);
          }
        }
      }

      setProgress('');
      toast.success('Consolidated Report Ready', `Evaluated ${biddersToProcess.length} bidder(s) successfully.`);
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Evaluation stopped by user.');
        toast.warning('Stopped', 'Consolidated evaluation was stopped by user.');
      } else {
        setError(err.message || 'Evaluation failed. Check backend logs.');
        toast.error('Evaluation Failed', err.message || 'Check backend logs.');
      }
    } finally {
      setLoading(false);
      setAbortController(null);
      clearProcess();
    }
  };

  const handleStopEvaluation = async () => {
    if (abortController) {
      abortController.abort();
    }
    // Also hit the backend to force LLM processes to abort instantly
    try {
      await fetch(`${API}/api/evaluate/stop`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to notify backend to stop evaluation', e);
    }
  };

  // ── Verdict color helper ──
  const verdictStyle = (verdict) => {
    if (verdict === 'ELIGIBLE') return { background: '#dcfce7', color: '#166534' };
    if (verdict === 'NOT_ELIGIBLE') return { background: '#fecaca', color: '#991b1b' };
    return { background: '#fef3c7', color: '#92400e' };
  };

  if (!selectedProject) {
    return (
      <div>
        <h1>Consolidated Report</h1>
        <div className="card">
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="icon" style={{ color: 'var(--fail)', marginBottom: 16 }}><AlertTriangle size={48} /></div>
            <h3>No Project Selected</h3>
            <p>Select a project from the Dashboard first.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1>Consolidated Bidder Report</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          Multi-bidder comparison — {bidders.length} bidder(s) vs 1 tender
        </p>
      </div>

      {/* Run Button OR Incremental Button */}
      {(!report || (report.bidder_results?.length < bidders.length)) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BarChart size={20} /> Run Consolidated Evaluation</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: tenderText ? 'var(--pass)' : 'var(--text-muted)', display: 'flex' }}>{tenderText ? <CheckSquare size={16} /> : <Square size={16} />}</span> Tender text extracted ({tenderText.length.toLocaleString()} chars)
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: bidders.length > 0 ? 'var(--pass)' : 'var(--text-muted)', display: 'flex' }}>{bidders.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}</span> {bidders.length} bidder(s) registered
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: bidderData.length > 0 ? 'var(--pass)' : 'var(--text-muted)', display: 'flex' }}>{bidderData.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}</span> {bidderData.length} bidder document(s) extracted
            </div>
          </div>

          {error && <div style={{ padding: '12px 16px', background: 'var(--fail-bg)', color: 'var(--fail)', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><XCircle size={16} /> {error}</div>}
          {progress && <div style={{ padding: '12px 16px', background: 'var(--review-bg)', color: 'var(--review)', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><Hourglass size={16} /> {progress}</div>}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="btn btn-primary"
              onClick={handleRunConsolidated}
              disabled={!canRun || loading}
              style={{ padding: '12px 32px', fontSize: '1rem', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Zap size={18} />
              {loading ? 'Running Evaluation Step-Wise...' : (!report ? `Evaluate All ${bidders.length} Bidders` : `Evaluate ${bidders.length - report.bidder_results.length} New Bidder(s)`)}
            </button>

            {loading && (
              <button
                className="btn btn-outline"
                onClick={handleStopEvaluation}
                style={{ padding: '12px 24px', fontSize: '1rem', color: 'var(--fail)', borderColor: 'var(--fail)', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Square size={18} /> Stop Evaluation
              </button>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {report && (
        <>
          {/* Summary Cards */}
          <div className="card-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card pass">
              <div className="stat-value">{report.summary.eligible}</div>
              <div className="stat-label">Eligible</div>
            </div>
            <div className="stat-card" style={{ borderColor: 'var(--fail)' }}>
              <div className="stat-value" style={{ color: 'var(--fail)' }}>{report.summary.not_eligible}</div>
              <div className="stat-label">Not Eligible</div>
            </div>
            <div className="stat-card review">
              <div className="stat-value">{report.summary.review_required}</div>
              <div className="stat-label">Review Required</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{report.bidder_count}</div>
              <div className="stat-label">Total Bidders</div>
            </div>
          </div>

          {/* ── GRAPHS (Comparative Analytics) ── */}
          <ConsolidatedGraphs report={report} />

          {/* Bidder Comparison Matrix */}
          <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
            <div className="card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ClipboardList size={20} /> Bidder Comparison Matrix</h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Rows = Criteria, Columns = Bidders
              </span>
            </div>
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table className="data-table" style={{ fontSize: '0.8rem', minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--bg-primary)', zIndex: 2, minWidth: 180 }}>Criterion</th>
                    {report.bidder_results.map((b) => (
                      <th key={b.bidder_id} style={{ textAlign: 'center', minWidth: 140 }}>
                        <div style={{ fontWeight: 700 }}>{b.bidder_name}</div>
                        <div style={{
                          fontSize: '0.7rem', fontWeight: 700, marginTop: 4,
                          padding: '2px 8px', borderRadius: 4, display: 'inline-block',
                          ...verdictStyle(b.verdict)
                        }}>
                          {b.verdict?.replace('_', ' ')}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(report.criteria || []).map((c) => (
                    <tr key={c.criterion_id}>
                      <td style={{ position: 'sticky', left: 0, background: 'var(--bg-primary)', zIndex: 1, fontWeight: 600 }}>
                        <div>{c.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          Req: {c.required_value || '—'}
                          {c.mandatory === false && <span style={{ marginLeft: 6, color: 'var(--review)', fontStyle: 'italic' }}>(Optional)</span>}
                        </div>
                      </td>
                      {report.bidder_results.map((b) => {
                        const ev = (b.evaluation || []).find(e => e.criterion_id === c.criterion_id);
                        return (
                          <td key={b.bidder_id} style={{ textAlign: 'center' }}>
                            {ev ? (
                              <>
                                <div style={{ fontSize: '0.75rem', marginBottom: 4 }}>{ev.evidence_found || '—'}</div>
                                <VerdictBadge verdict={ev.result} />
                              </>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-Bidder Detail Cards */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Search size={20} /> Bidder Details</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {report.bidder_results.map((b) => (
                  <button
                    key={b.bidder_id}
                    className={`btn btn-sm ${selectedBidder === b.bidder_id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setSelectedBidder(selectedBidder === b.bidder_id ? null : b.bidder_id)}
                  >
                    {b.bidder_name}
                  </button>
                ))}
              </div>
            </div>

            {selectedBidder && (() => {
              const b = report.bidder_results.find(r => r.bidder_id === selectedBidder);
              if (!b) return null;
              return (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--pass)' }}>{b.pass_count}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>PASS</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--fail)' }}>{b.fail_count}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>FAIL</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--review)' }}>{b.review_count}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>REVIEW</div>
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto', width: '100%' }}>
                    <table className="data-table" style={{ fontSize: '0.85rem', minWidth: 800 }}>
                      <thead>
                        <tr>
                          <th>Criterion</th>
                          <th>Required</th>
                          <th>Found</th>
                          <th>Confidence</th>
                          <th>Verdict</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(b.evaluation || []).map((e, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{e.criteria_name}</td>
                            <td>{e.required_value || '—'}</td>
                            <td>{e.evidence_found || '—'}</td>
                            <td>{e.confidence}</td>
                            <td><VerdictBadge verdict={e.result} /></td>
                            <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: 300 }}>{e.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Verification */}
                  {b.verification?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <h4 style={{ fontSize: '0.85rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Lock size={16} /> Identifier Verification</h4>
                      {b.verification.map((v, i) => (
                        <div key={i} style={{ fontSize: '0.8rem', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: v.status === 'FORMAT_VALID' ? 'var(--pass)' : 'var(--fail)', display: 'flex' }}>
                            {v.status === 'FORMAT_VALID' ? <CheckSquare size={14} /> : <XCircle size={14} />}
                          </span>
                          <strong>{v.identifier_type}</strong>: {v.identifier} — {v.details}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Issues */}
                  {b.issues?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <h4 style={{ fontSize: '0.85rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fail)' }}><AlertTriangle size={16} /> Vigilance Alerts</h4>
                      {b.issues.map((issue, i) => (
                        <div key={i} style={{ fontSize: '0.8rem', marginBottom: 4, padding: '4px 8px', background: issue.severity === 'HIGH' ? '#fecaca' : '#fef3c7', borderRadius: 4 }}>
                          [{issue.severity}] {issue.issue_type}: {issue.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={async () => {
                try {
                  const res = await fetch(`${API}/api/export/consolidated`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
                  });
                  if (!res.ok) throw new Error('Export failed');
                  const blob = await res.blob(); const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = 'InferX_Consolidated_Report.pdf'; a.click(); URL.revokeObjectURL(url);
                } catch (err) { alert('Export failed: ' + err.message); }
              }}
            >
              <FileText size={16} /> Export Consolidated PDF
            </button>
            <button
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={async () => {
                try {
                  const res = await fetch(`${API}/api/export/excel`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
                  });
                  if (!res.ok) throw new Error('Export failed');
                  const blob = await res.blob(); const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `InferX_Matrix_${report.summary?.evaluated_at || Date.now()}.xlsx`; a.click(); URL.revokeObjectURL(url);
                } catch (err) { alert('Export failed: ' + err.message); }
              }}
            >
              <Table size={16} /> Export Matrix (XLSX)
            </button>
            <button
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={async () => {
                try {
                  const res = await fetch(`${API}/api/export/audit`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
                  });
                  if (!res.ok) throw new Error('Export failed');
                  const blob = await res.blob(); const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `InferX_AuditLog_${report.summary?.evaluated_at || Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
                } catch (err) { alert('Export failed: ' + err.message); }
              }}
            >
              <Lock size={16} /> Export Audit Log (JSON)
            </button>
            <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setReport(null); setSelectedBidder(null); }}>
              <RefreshCw size={16} /> Re-run Evaluation
            </button>
          </div>
        </>
      )}

      {/* ── PROCESS CONFLICT MODAL ── */}
      {showConflictModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '90%', maxWidth: 500, padding: 24 }}>
            <h3 style={{ margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--review)' }}>
              <AlertTriangle size={20} /> Process Already Running
            </h3>
            <p style={{ marginBottom: 8 }}>
              A <strong>{activeProcess?.type}</strong> process is currently running 
              (started {activeProcess?.startedAt ? new Date(activeProcess.startedAt).toLocaleTimeString() : 'recently'}).
            </p>
            <p style={{ marginBottom: 16, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Starting consolidated evaluation will terminate the current process. Continue?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowConflictModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--review)', borderColor: 'var(--review)' }} onClick={() => { setShowConflictModal(false); clearProcess(); handleRunConsolidated(true); }}>
                <StopCircle size={14} /> Terminate & Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
