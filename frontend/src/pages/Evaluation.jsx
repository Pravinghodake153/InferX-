import { useState } from 'react';
import { useApp } from '../context/useApp';
import { useToast } from '../components/useToast';
import VerdictBadge from '../components/VerdictBadge';
import EvaluationGraphs from '../components/EvaluationGraphs';
import { AlertTriangle, CheckCircle, Square, Hourglass, XCircle, Zap, Search, Lock, FileText, GitCompare, ClipboardList, BarChart2, User, Bot, AlertOctagon, Building2, StopCircle } from 'lucide-react';
import { storage } from '../services/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { ProjectAPI } from '../services/api';

const API = import.meta.env.VITE_API_URL || '';

export default function Evaluation() {
  const { selectedProject, updateProject, selectedProjectId, activeProcess, startProcess, clearProcess } = useApp();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [skipConfirmed, setSkipConfirmed] = useState(false);
  const [showPayloadModal, setShowPayloadModal] = useState(false);
  const [showRawOutputModal, setShowRawOutputModal] = useState(false);
  const [previewPayload, setPreviewPayload] = useState(null);
  const [activeBidderIdx, setActiveBidderIdx] = useState(0);
  const [showConflictModal, setShowConflictModal] = useState(false);

  // ── Versioning State ──
  const versions = selectedProject?.versions || [];
  const finalVersionId = selectedProject?.final_version_id || null;
  const isFinalized = finalVersionId !== null;
  
  // Default to user selected version, or final version, or latest version
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const activeVersionId = selectedVersionId || finalVersionId || (versions.length > 0 ? versions[versions.length - 1].version_id : null);

  // Comparison State
  const [compareMode, setCompareMode] = useState(false);
  const [compareWithVersionId, setCompareWithVersionId] = useState(null);

  // Active Data
  const activeVersion = versions.find(v => v.version_id === activeVersionId) || null;
  const compareVersion = versions.find(v => v.version_id === compareWithVersionId) || null;

  // ── Readiness Checks ──
  const isSandbox = selectedProject?.sandboxMode;
  const tenderReady = isSandbox || (selectedProject && selectedProject.tenderDocuments.length > 0);
  const biddersReady = isSandbox || (selectedProject && selectedProject.bidders.length > 0 && selectedProject.bidders.some(b => b.documents.length > 0));
  const reviewDone = selectedProject?.status === 'reviewed' || selectedProject?.status === 'evaluated' || skipConfirmed || Object.keys(selectedProject?.reviewData?.corrections || {}).length > 0;
  const canEvaluate = tenderReady && biddersReady && (reviewDone || skipConfirmed);

  // ── Execution Logic ──
  const buildPayload = async (bidderIdx = activeBidderIdx) => {
    let tenderText = selectedProject.extractedText || '';
    let bidderData = selectedProject.extractedBidderData || [];

    // Hydrate from MongoDB first (primary source for heavy data)
    if (!tenderText || bidderData.length === 0) {
      try {
        const mongoRes = await ProjectAPI.getExtraction(selectedProject.id);
        const mongoData = mongoRes.data;
        if (mongoData) {
          tenderText = tenderText || mongoData.tender_text || '';
          bidderData = bidderData.length > 0 ? bidderData : (mongoData.bidder_data || []);
          console.log('[Evaluation] Hydrated extraction from MongoDB');
        }
      } catch (mongoErr) {
        console.warn('[Evaluation] MongoDB hydration failed, trying Firebase Storage...', mongoErr?.message);
      }
    }

    // Fallback: Hydrate from Firebase Storage if MongoDB had no data
    if ((!tenderText || bidderData.length === 0) && selectedProject.payloadUrl) {
      try {
        const res = await fetch(selectedProject.payloadUrl);
        const data = await res.json();
        
        // Handle extraction payload format (from Upload.jsx)
        if (data.tender_documents && !data.tender_text && !data.extracted_text) {
          tenderText = tenderText || Object.entries(data.tender_documents)
            .map(([name, docData]) => `[Document: ${name}]\n${docData.text || docData.package?.context_text || ''}`)
            .join('\n\n---\n\n');
        } else {
          tenderText = tenderText || data.tender_text || data.extracted_text || '';
        }

        if (data.bidder_documents && (!data.bidders || data.bidders.length === 0) && (!data.bidder_data || data.bidder_data.length === 0)) {
           bidderData = bidderData.length > 0 ? bidderData : Object.entries(data.bidder_documents).map(([bidId, docs]) => {
             const combinedText = Object.entries(docs)
               .map(([, docData]) => docData.text || docData.package?.context_text || '')
               .join('\n');
             return {
               bidder_id: bidId,
               bidder_name: selectedProject.bidders?.find(b => b.id === bidId)?.name || bidId,
               extracted_text: combinedText,
               fields: {},
             };
           });
        } else {
           bidderData = bidderData.length > 0 ? bidderData : (data.bidders || data.bidder_data || []);
        }
      } catch (e) {
        console.warn("Failed to fetch payload from Firebase Storage", e);
      }
    }

    const bidderExtractedList = isSandbox 
      ? bidderData.filter(d => {
          const sandboxUbids = selectedProject.sandboxBidderUbids || [];
          const ubid = sandboxUbids[bidderIdx] || (sandboxUbids.length > 0 ? sandboxUbids[0] : null);
          return d.bidder_id === ubid || d.bidder_id === d.bidder_ubid;
        })
      : bidderData.filter(d => {
          const bidders = selectedProject.bidders || [];
          const bidder = bidders[bidderIdx] || (bidders.length > 0 ? bidders[0] : null);
          return d.bidder_id === bidder?.id;
        });
    
    // Merge all documents for this bidder
    const bidderText = bidderExtractedList.map(d => d.extracted_text || d.bidder_text || '').join('\n\n---\n\n');
    const bidderName = bidderExtractedList[0]?.bidder_name || (isSandbox ? `Sandbox Bidder ${bidderIdx + 1}` : (selectedProject.bidders?.[bidderIdx]?.name || 'Unknown Bidder'));
    const bidderId = bidderExtractedList[0]?.bidder_id || 'BID-001';

    if (!tenderText || !bidderText) {
      throw new Error(`Extraction data missing for ${bidderName}. Please ensure documents are uploaded and extracted to Firebase.`);
    }

    const applyMasks = (text) => {
      if (!text) return text;
      let newText = String(text);
      Object.entries(selectedProject?.reviewData?.manualMasks || {}).forEach(([original, maskInfo]) => {
        const token = maskInfo.token || maskInfo;
        const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedOriginal, 'gi');
        newText = newText.replace(regex, token);
      });
      return newText;
    };

    const approvedCriteria = selectedProject.extractedCriteria || [];
    const payload = {
      tender_text: applyMasks(tenderText),
      bidders: [{
        bidder_id: bidderId,
        bidder_name: bidderName,
        bidder_text: applyMasks(bidderText),
      }],
    };
    if (approvedCriteria.length > 0) {
      payload.criteria = approvedCriteria;
    }
    return payload;
  };

  const handlePreviewPayload = async () => {
    try {
      // If viewing a completed version, show the persisted payload
      if (activeVersion?.payload_sent) {
        setPreviewPayload(activeVersion.payload_sent);
        setShowPayloadModal(true);
        return;
      }
      
      setLoading(true);
      // Otherwise build a fresh preview
      const p = await buildPayload();
      setPreviewPayload(p);
      setShowPayloadModal(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunEvaluation = async (forceOverride = false) => {
    if (!canEvaluate || isFinalized) return;

    // Process conflict guard
    if (!forceOverride && activeProcess) {
      setShowConflictModal(true);
      return;
    }

    setLoading(true);
    setError('');
    startProcess('evaluation', { projectId: selectedProjectId, bidderIdx: activeBidderIdx });

    try {
      const payload = await buildPayload();

      const res = await fetch(`${API}/api/evaluate/consolidated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error: ${res.status}`);
      }

      const result = await res.json();
      const bidderResult = result.bidder_results?.[0] || {};
      const evals = (bidderResult.evaluation || []).map(e => ({
        criteria_id: e.criterion_id || e.criteria_id,
        criteria_name: e.criteria_name,
        category: e.category,
        required_value: e.required_value,
        extracted_value: e.evidence_found || e.extracted_value,
        confidence: e.confidence,
        result: e.result,
        reason: e.reason,
        mandatory: e.mandatory,
      }));

      // Prepare new version
      const newVersionId = versions.length + 1;
      const inputDataSnapshot = JSON.parse(JSON.stringify(selectedProject.reviewData || {}));

      // Upload evaluation payload to Firebase Storage
      let evaluationUrl = null;
      try {
        const fullSnapshot = {
          version_id: newVersionId,
          bidder_id: bidderResult.bidder_id,
          bidder_name: bidderResult.bidder_name,
          input_payload: payload,
          output: evals,
          full_result: bidderResult,
          timestamp: new Date().toISOString()
        };
        const evalRef = ref(storage, `evaluations/eval_${selectedProjectId}_v${newVersionId}_${Date.now()}.json`);
        await uploadString(evalRef, JSON.stringify(fullSnapshot), 'raw', { contentType: 'application/json' });
        evaluationUrl = await getDownloadURL(evalRef);
      } catch (fbErr) {
        console.error("Failed to upload evaluation payload to Firebase Storage:", fbErr);
      }

      const newVersion = {
        version_id: newVersionId,
        status: 'ACTIVE',
        bidder_id: bidderResult.bidder_id,
        bidder_name: bidderResult.bidder_name,
        input_data: inputDataSnapshot,
        output: evals,
        criteria: result.criteria || [],
        full_result: bidderResult,
        payload_sent: payload, // Persist for audit/preview
        evaluationUrl: evaluationUrl,
        created_at: new Date().toISOString(),
      };

      // Set previous ACTIVE to SNAPSHOT
      const updatedVersions = versions.map(v =>
        v.status === 'ACTIVE' ? { ...v, status: 'SNAPSHOT' } : v
      );
      updatedVersions.push(newVersion);

      if (selectedProjectId) {
        updateProject(selectedProjectId, {
          status: 'evaluated',
          versions: updatedVersions,
          extractedCriteria: result.criteria || selectedProject.extractedCriteria,
        });

        // Save evaluation version to MongoDB (persistent, no size limit)
        try {
          await ProjectAPI.saveEvaluation(selectedProjectId, newVersion);
          console.log('[Evaluation] Version saved to MongoDB successfully.');
        } catch (mongoErr) {
          console.error('[Evaluation] Failed to save evaluation to MongoDB:', mongoErr);
        }
      }

      setSelectedVersionId(newVersionId);
      setCompareMode(false);
      toast.success('Evaluation Complete', `Bidder "${bidderResult.bidder_name || 'Unknown'}" evaluated successfully.`);
    } catch (err) {
      setError(err.message || 'Evaluation failed.');
      toast.error('Evaluation Failed', err.message || 'Check backend logs for details.');
    } finally {
      setLoading(false);
      clearProcess();
    }
  };

  const handleFinalize = () => {
    if (!activeVersionId) return;
    
    const updatedVersions = versions.map(v => 
      v.version_id === activeVersionId 
        ? { ...v, status: 'FINAL' } 
        : { ...v, status: 'SNAPSHOT' }
    );

    if (selectedProjectId) {
      updateProject(selectedProjectId, {
        final_version_id: activeVersionId,
        versions: updatedVersions,
      });
    }
  };

  // ── UI Checks ──
  if (!selectedProject) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1>Evaluation</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Run AI-powered tender compliance evaluation
          </p>
        </div>
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="icon"><AlertTriangle size={48} className="text-muted" /></div>
            <h3 style={{ marginBottom: 8 }}>No Project Selected</h3>
            <p>Please select or create a project from the Dashboard first.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── NO DATA (Initial State) ──
  if (versions.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1>Evaluation</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Run AI-powered tender compliance evaluation (Version Control enabled)
          </p>
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={20} /> Evaluation Readiness</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span>{tenderReady ? <CheckCircle size={16} className="text-pass" /> : <Square size={16} className="text-muted" />}</span> Tender documents uploaded</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span>{biddersReady ? <CheckCircle size={16} className="text-pass" /> : <Square size={16} className="text-muted" />}</span> Bidder documents uploaded</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span>{reviewDone ? <CheckCircle size={16} className="text-pass" /> : <Hourglass size={16} className="text-warning" />}</span> Review & Cleaning completed</div>
          </div>

          {!reviewDone && tenderReady && biddersReady && (
            <div style={{ padding: '10px 14px', background: 'var(--review-bg)', border: '1px solid #fde68a', borderRadius: 'var(--radius-sm)', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--review)', display: 'flex', alignItems: 'center', gap: '6px' }}><AlertTriangle size={14} /> Review step not completed. You can skip if needed.</span>
              <button className="btn btn-sm btn-secondary" onClick={() => setSkipConfirmed(true)}>Skip Review →</button>
            </div>
          )}
        </div>

        {error && <div style={{ padding: '12px 16px', background: 'var(--fail-bg)', color: 'var(--fail)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: '6px' }}><XCircle size={16} /> {error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
          <div className="card">
            <div className="card-header"><h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><User size={20} /> Select Bidder to Evaluate</h3></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '4px 0' }}>
              {(isSandbox ? (selectedProject.sandboxBidderUbids || ['BID-001']) : (selectedProject.bidders || [])).map((b, idx) => {
                const bId = isSandbox ? b : b.id;
                const bName = isSandbox ? `Sandbox Bidder ${idx + 1}` : b.name;
                const isSelected = activeBidderIdx === idx;
                return (
                  <button 
                    key={bId} 
                    onClick={() => setActiveBidderIdx(idx)}
                    className={`btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ minWidth: 160, justifyContent: 'flex-start', border: isSelected ? 'none' : '1px solid var(--border-color)' }}
                  >
                    <Building2 size={16} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{bName}</div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.8 }}>{bId}</div>
                    </div>
                    {isSelected && <CheckCircle size={14} style={{ marginLeft: 'auto' }} />}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn btn-primary"
              onClick={handleRunEvaluation}
              disabled={!canEvaluate || loading}
              style={{ padding: '12px 32px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}
            >
              {loading ? <><Hourglass size={16} /> Evaluating {isSandbox ? `Bidder ${activeBidderIdx + 1}` : (selectedProject.bidders?.[activeBidderIdx]?.name || 'Bidder')}...</> : <><Zap size={16} /> Run Evaluation for Selected Bidder</>}
            </button>
            
            <button
              className="btn btn-secondary"
              onClick={handlePreviewPayload}
              disabled={!canEvaluate || loading}
              style={{ padding: '12px 20px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Search size={16} /> Preview Payload
            </button>
          </div>
        </div>


      </div>
    );
  }

  // ── RESULTS VIEW (mandatory-aware verdict) ──
  const evals = activeVersion?.output || [];
  const backendError = activeVersion?.full_result?.error || activeVersion?.error_msg || null;
  const criteriaLookup = (activeVersion?.criteria || selectedProject?.extractedCriteria || []);
  const passCount = evals.filter(e => e.result === 'PASS').length;
  const failCount = evals.filter(e => e.result === 'FAIL').length;
  const reviewCount = evals.filter(e => e.result === 'REVIEW').length;

  // Masking helpers for UI display
  const masks = selectedProject?.reviewData?.manualMasks || {};
  const unmaskText = (text) => {
    if (!text || Object.keys(masks).length === 0) return text;
    let newText = String(text);
    Object.entries(masks).forEach(([original, maskInfo]) => {
      const token = maskInfo.token || maskInfo;
      newText = newText.split(token).join(original);
    });
    return newText;
  };

  // Only mandatory failures/reviews affect overall verdict
  const mandatoryFails = evals.filter(e => {
    const c = criteriaLookup.find(cr => cr.criterion_id === (e.criteria_id || e.criterion_id));
    return e.result === 'FAIL' && (c ? c.mandatory !== false : true);
  }).length;
  const mandatoryReviews = evals.filter(e => {
    const c = criteriaLookup.find(cr => cr.criterion_id === (e.criteria_id || e.criterion_id));
    return e.result === 'REVIEW' && (c ? c.mandatory !== false : true);
  }).length;

  let finalVerdict = 'ELIGIBLE';
  if (backendError) finalVerdict = 'REVIEW REQUIRED';
  else if (mandatoryFails > 0) finalVerdict = 'NOT ELIGIBLE';
  else if (mandatoryReviews > 0) finalVerdict = 'REVIEW REQUIRED';

  return (
    <div>
      {/* ── BIDDER SELECTOR (in results view) ── */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
            <Building2 size={18} /> Select Bidder
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {versions.filter((v, i, arr) => arr.findIndex(x => x.bidder_id === v.bidder_id) === i).length} of {(isSandbox ? (selectedProject.sandboxBidderUbids || ['BID-001']) : (selectedProject.bidders || [])).length} bidders evaluated
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(isSandbox ? (selectedProject.sandboxBidderUbids || ['BID-001']) : (selectedProject.bidders || [])).map((b, idx) => {
            const bId = isSandbox ? b : b.id;
            const bName = isSandbox ? `Sandbox Bidder ${idx + 1}` : b.name;
            const isSelected = activeBidderIdx === idx;
            const hasResults = versions.some(v => v.bidder_id === bId);
            return (
              <button 
                key={bId} 
                onClick={() => setActiveBidderIdx(idx)}
                className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, border: isSelected ? 'none' : '1px solid var(--border-color)' }}
              >
                <Building2 size={14} />
                {bName}
                {hasResults && <CheckCircle size={12} style={{ color: isSelected ? '#fff' : 'var(--pass)' }} />}
              </button>
            );
          })}
          {!isFinalized && (
            <button 
              className="btn btn-sm btn-primary" 
              onClick={() => handleRunEvaluation()}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {loading ? <><Hourglass size={14} /> Running...</> : <><Zap size={14} /> Evaluate Selected Bidder</>}
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h1>Evaluation Results</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          Decision Version Control System • Backend Integration Ready
        </p>
      </div>

      {/* ── VERSION NAVIGATOR (Top Bar) ── */}
      <div className="card" style={{ marginBottom: 24, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)' }}>VERSION HISTORY:</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {versions.map(v => (
              <button
                key={v.version_id}
                onClick={() => { setSelectedVersionId(v.version_id); setCompareMode(false); }}
                className={`btn btn-sm ${activeVersionId === v.version_id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ position: 'relative' }}
              >
                Output {v.version_id}
                {v.status === 'FINAL' && <Lock size={12} className="inline-icon" style={{ marginLeft: 4 }} />}
              </button>
            ))}
            {!isFinalized && (
              <>
                <button 
                  className="btn btn-sm btn-secondary" 
                  onClick={handleRunEvaluation}
                  disabled={loading}
                  style={{ border: '1px dashed var(--border-color)', background: 'transparent' }}
                >
                  {loading ? <><Hourglass size={14} className="inline-icon" /> Running...</> : '+ New Run'}
                </button>
                <button 
                  className="btn btn-sm btn-secondary" 
                  onClick={handlePreviewPayload}
                  disabled={loading}
                  style={{ border: '1px dashed var(--border-color)', background: 'transparent', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Search size={14} /> View LLM Payload Preview
                </button>
                <button 
                  className="btn btn-sm btn-secondary" 
                  onClick={() => setShowRawOutputModal(true)}
                  disabled={loading}
                  style={{ border: '1px dashed var(--border-color)', background: 'transparent', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <FileText size={14} /> View Raw AI Output Logs
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── RAW OUTPUT MODAL ── */}
        {showRawOutputModal && activeVersion && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="card" style={{ width: '90%', maxWidth: 1000, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><FileText size={20} /> Raw AI Output Logs (Audit Trace)</h3>
                <button className="btn btn-sm btn-secondary" onClick={() => setShowRawOutputModal(false)}>Close</button>
              </div>
              <div style={{ padding: 16, overflowY: 'auto', background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                <div style={{ color: '#94a3b8', marginBottom: 8 }}>// Complete untampered JSON output from all AI pipeline steps. Note how the AI explains every decision using raw_snippet references.</div>
                {JSON.stringify(activeVersion.full_result, null, 2)}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Status Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>STATE:</span>
            <span style={{
              fontSize: '0.75rem', fontWeight: 700, padding: '4px 8px', borderRadius: 4,
              background: activeVersion?.status === 'FINAL' ? '#dcfce7' : activeVersion?.status === 'ACTIVE' ? '#dbeafe' : '#f1f5f9',
              color: activeVersion?.status === 'FINAL' ? '#166534' : activeVersion?.status === 'ACTIVE' ? '#1e40af' : '#475569'
            }}>
              {activeVersion?.status}
            </span>
          </div>

          {!isFinalized && activeVersion?.status === 'ACTIVE' && (
            <button className="btn btn-primary btn-sm" onClick={handleFinalize} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={14} /> Mark as Final Output
            </button>
          )}
        </div>
      </div>

      {/* ── COMPARISON TOGGLE ── */}
      {versions.length > 1 && !isFinalized && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>
            <input type="checkbox" checked={compareMode} onChange={e => {
              setCompareMode(e.target.checked);
              if (e.target.checked && !compareWithVersionId) {
                const prev = versions.find(v => v.version_id !== activeVersionId);
                setCompareWithVersionId(prev ? prev.version_id : null);
              }
            }} />
            <GitCompare size={14} /> Compare Versions
          </label>
          
          {compareMode && (
            <select 
              className="input" 
              style={{ width: 200, padding: '4px 8px', fontSize: '0.85rem' }}
              value={compareWithVersionId || ''}
              onChange={e => setCompareWithVersionId(Number(e.target.value))}
            >
              <option value="" disabled>Select version...</option>
              {versions.filter(v => v.version_id !== activeVersionId).map(v => (
                <option key={v.version_id} value={v.version_id}>Output {v.version_id}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* ── GRAPHS (Compliance Visualization) ── */}
      <EvaluationGraphs evals={evals} criteriaLookup={criteriaLookup} />

      {/* ── MAIN CONTENT (Criteria Table) ── */}
      {backendError && (
        <div style={{ padding: '16px 20px', background: 'var(--fail-bg)', border: '1px solid var(--fail)', borderRadius: 8, color: 'var(--fail)', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertOctagon size={16} /> Evaluation Pipeline Error</h3>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{backendError}</p>
          <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>The system failed to automatically evaluate this bidder. Manual review is required.</p>
        </div>
      )}

      {compareMode && compareVersion ? (
        <div className="card">
          <div className="card-header" style={{ background: '#f8fafc' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={20} /> 
              Comparison View: {activeVersion.bidder_name || 'Selected Bidder'} (Output {activeVersion.version_id} vs Output {compareVersion.version_id})
            </h3>
          </div>
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table className="data-table" style={{ fontSize: '0.85rem', minWidth: 800 }}>
                <thead>
                  <tr>
                    <th>Criterion</th>
                    <th>Output {compareVersion.version_id}</th>
                    <th>Output {activeVersion.version_id}</th>
                    <th>Change Source</th>
                  </tr>
                </thead>
                <tbody>
                  {evals.map((e1, i) => {
                    const e2 = compareVersion.output.find(o => o.criteria_id === e1.criteria_id);
                    const val1 = unmaskText(e1.extracted_value);
                    const val2 = e2 ? unmaskText(e2.extracted_value) : '—';
                    const changed = val1 !== val2 || e1.result !== (e2 ? e2.result : null);
                    
                    // Determine source of change
                    let changeSource = '—';
                    if (changed) {
                      const input1 = JSON.stringify(activeVersion.input_data?.corrections || {});
                      const input2 = JSON.stringify(compareVersion.input_data?.corrections || {});
                      changeSource = input1 !== input2 ? <><User size={14} className="inline-icon" /> User Edit</> : <><Bot size={14} className="inline-icon" /> AI Reasoning Change</>;
                    }

                    return (
                      <tr key={i} style={{ background: changed ? '#fef3c7' : 'transparent' }}>
                        <td><strong>{e1.criteria_name}</strong></td>
                        <td style={{ opacity: changed ? 0.6 : 1 }}>
                          {val2} <br/><VerdictBadge verdict={e2 ? e2.result : 'N/A'} />
                        </td>
                        <td>
                          {val1} <br/><VerdictBadge verdict={e1.result} />
                        </td>
                        <td>
                          {changed ? <span style={{ fontWeight: 600, color: '#b45309' }}>{changeSource}</span> : <span style={{ color: '#94a3b8' }}>Unchanged</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 24, alignItems: 'start' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 12 }}>
               <Building2 size={18} />
               <h3 style={{ margin: 0 }}>Results for {activeVersion.bidder_name || 'Selected Bidder'}</h3>
            </div>
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table className="data-table" style={{ margin: 0, minWidth: 600 }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>ID</th>
                    <th>Criterion</th>
                    <th>Found Value</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {evals.map((e, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{e.criteria_id}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{e.criteria_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          Req: {e.required_value}
                        </div>
                      </td>
                      <td>{unmaskText(e.extracted_value)}</td>
                      <td><VerdictBadge verdict={e.result} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Verdict Panel */}
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>FINAL VERDICT</span>
              <div style={{
                fontSize: '1.5rem', fontWeight: 800, marginTop: 8,
                color: finalVerdict === 'ELIGIBLE' ? 'var(--pass)' : finalVerdict === 'NOT ELIGIBLE' ? 'var(--fail)' : 'var(--review)'
              }}>
                {finalVerdict}
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--pass)' }}>{passCount}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pass</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--fail)' }}>{failCount}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Fail</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--review)' }}>{reviewCount}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Review</div>
              </div>
            </div>

            {isFinalized && (
              <div style={{ padding: '12px', background: '#dcfce7', color: '#166534', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Lock size={16} /> This evaluation has been finalized and is locked for auditing.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ SHARED MODALS (visible in both initial and results views) ═══ */}

      {/* ── PAYLOAD PREVIEW MODAL ── */}
      {showPayloadModal && previewPayload && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '90%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><Search size={20} /> What the LLM Sees (Audit Payload Preview)</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowPayloadModal(false)}>Close</button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
              <div style={{ color: '#94a3b8', marginBottom: 8 }}>// Notice that PII has been replaced with safe tokens (e.g., &lt;GST_1&gt;, &lt;EMAIL_1&gt;)</div>
              {JSON.stringify(previewPayload, null, 2)}
            </div>
            <div style={{ padding: 16, borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-secondary" onClick={() => setShowPayloadModal(false)}>Close</button>
              <button className="btn btn-primary" onClick={() => { setShowPayloadModal(false); handleRunEvaluation(); }}>Run Evaluation Now</button>
            </div>
          </div>
        </div>
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
              Starting a new evaluation will terminate the current process. Do you want to continue?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowConflictModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--review)', borderColor: 'var(--review)' }} onClick={() => { setShowConflictModal(false); clearProcess(); handleRunEvaluation(true); }}>
                <StopCircle size={14} /> Terminate & Start Evaluation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
