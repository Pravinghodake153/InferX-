import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import FileUpload from '../components/FileUpload';
import SandboxMode from '../components/SandboxMode';
import { PipelineAPI, TenderAPI } from '../services/api';

const TENDER_DOC_TYPES = ['MAIN', 'ADDENDUM'];

const BIDDER_DOC_TYPES = [
  'Technical',
  'Financial',
  'EMD',
  'Compliance',
  'Certificate',
  'Other',
];

const DOC_TYPE_COLORS = {
  Technical: 'pass',
  Financial: 'review',
  EMD: 'fail',
  Compliance: 'pass',
  Certificate: 'pass',
  Other: 'review',
};

export default function Upload() {
  const navigate = useNavigate();
  const {
    selectedProject, updateProject, selectedProjectId,
    addTenderDocument, removeTenderDocument,
    addBidder, addBidderDocument, removeBidderDocument,
    addProject,
  } = useApp();

  // ── Dual Mode State ──
  const [mode, setMode] = useState('upload'); // 'upload' | 'sandbox'

  const [error, setError] = useState('');
  const [newBidderName, setNewBidderName] = useState('');
  const [activeTenderUpload, setActiveTenderUpload] = useState(null);

  // Bidder doc upload state — generic
  const [activeBidderUpload, setActiveBidderUpload] = useState(null); // { bidderId }
  const [bidderDocType, setBidderDocType] = useState('Other');

  // Pipeline / extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);

  // Auto-create project if none selected
  const ensureProject = () => {
    if (!selectedProjectId) {
      addProject({ name: 'Untitled Tender' });
    }
  };

  const handleTenderFile = (file) => {
    if (!file || !activeTenderUpload) return;
    ensureProject();
    addTenderDocument(activeTenderUpload, file);
    setActiveTenderUpload(null);
  };

  const handleBidderFile = (file) => {
    if (!file || !activeBidderUpload) return;
    addBidderDocument(activeBidderUpload.bidderId, bidderDocType, file);
    setActiveBidderUpload(null);
    setBidderDocType('Other');
  };

  const handleAddBidder = () => {
    if (!newBidderName.trim()) return;
    ensureProject();
    addBidder(newBidderName.trim());
    setNewBidderName('');
  };

  const openBidderUpload = (bidderId) => {
    setActiveBidderUpload({ bidderId });
    setBidderDocType('Other');
  };

  // ── PIPELINE TRIGGER: Extract → Tender Setup ──
  const handleRunPipeline = async () => {
    if (!selectedProject) return;
    setError('');

    // Validate documents
    if (mode === 'upload') {
      if (selectedProject.tenderDocuments.length === 0) {
        setError('Upload at least one tender document.'); return;
      }
      if (selectedProject.bidders.length === 0 || selectedProject.bidders.every(b => b.documents.length === 0)) {
        setError('Upload at least one bidder document.'); return;
      }
    }

    // Already extracted? Go straight to tender setup
    if (selectedProject.extractionStatus === 'complete') {
      if (selectedProject.criteriaLocked) {
        navigate('/review');
      } else {
        navigate('/tender');
      }
      return;
    }

    // Run extraction pipeline
    setExtracting(true);
    setExtractionProgress('Starting extraction pipeline...');
    updateProject(selectedProjectId, {
      status: 'uploaded',
      extractionStatus: 'running',
      extractionError: null,
    });

    try {
      setExtractionProgress('Uploading documents...');

      // ── Check if we have File objects (they are lost after page refresh) ──
      const hasFiles = selectedProject.tenderDocuments.some(d => d.file) ||
                       selectedProject.bidders.some(b => b.documents.some(d => d.file));

      let pipelineResult = null;

      if (hasFiles) {
        // Real API call — upload files, get a job_id, then poll for completion
        const formData = new FormData();
        selectedProject.tenderDocuments.forEach(doc => {
          if (doc.file) {
            formData.append('tender_documents', doc.file, doc.file.name);
          }
        });

        const bidderMapping = {};
        selectedProject.bidders.forEach(bidder => {
          bidder.documents.forEach(doc => {
            if (doc.file) {
              formData.append('bidder_documents', doc.file, doc.file.name);
              bidderMapping[doc.file.name] = bidder.id;
            }
          });
        });

        formData.append('bidder_mapping', JSON.stringify(bidderMapping));

        // Step 1: Upload files (returns job_id immediately)
        const uploadRes = await PipelineAPI.extract(formData);
        const jobId = uploadRes.data.job_id;
        setActiveJobId(jobId);

        if (!jobId) {
          throw new Error('Backend did not return a job ID.');
        }

        setExtractionProgress(`Extraction started (Job: ${jobId})...`);

        // Step 2: Poll for progress until complete or failed
        pipelineResult = await new Promise((resolve, reject) => {
          let consecutiveErrors = 0;
          const pollInterval = setInterval(async () => {
            try {
              const statusRes = await PipelineAPI.extractStatus(jobId);
              const job = statusRes.data;
              consecutiveErrors = 0; // Reset on success

              // Update progress display
              setExtractionProgress(
                `${job.progress || 'Processing...'} (${job.progress_pct || 0}% · ${job.elapsed_seconds || 0}s)`
              );

              if (job.status === 'complete') {
                clearInterval(pollInterval);
                resolve(job.extracted_content);
              } else if (job.status === 'failed') {
                clearInterval(pollInterval);
                reject(new Error(job.error || 'Extraction job failed.'));
              }
              // else status === 'running' → continue polling
            } catch (pollErr) {
              consecutiveErrors++;
              const is404 = pollErr?.response?.status === 404;
              if (is404 || consecutiveErrors >= 5) {
                clearInterval(pollInterval);
                reject(new Error(
                  is404
                    ? 'Extraction job was lost (backend may have restarted). Please re-run extraction.'
                    : `Extraction polling failed after ${consecutiveErrors} retries: ${pollErr.message}`
                ));
              } else {
                console.warn(`Poll error (${consecutiveErrors}/5, retrying):`, pollErr.message);
              }
            }
          }, 2500); // Poll every 2.5 seconds
        });

      } else if (mode === 'sandbox') {
        // Sandbox mode — generate from sandbox API data
        pipelineResult = generateSyntheticExtraction(selectedProject);
      } else {
        // File objects were lost (page refresh) — tell user to re-upload
        throw new Error('File objects were lost after browser reload. Please re-upload your documents and run extraction again.');
      }

      setExtractionProgress('Processing extracted text...');

      // ── Derive extractedText from the extraction result ──
      let derivedText = pipelineResult.extracted_text || '';
      if (!derivedText && pipelineResult.tender_documents) {
        derivedText = Object.entries(pipelineResult.tender_documents)
          .map(([name, data]) => `[Document: ${name}]\n${data.text || data.package?.context_text || ''}`)
          .join('\n\n---\n\n');
      }

      let derivedBidderData = pipelineResult.bidder_data || [];
      if (derivedBidderData.length === 0 && pipelineResult.bidder_documents) {
        derivedBidderData = Object.entries(pipelineResult.bidder_documents).map(([bidderId, docs]) => {
          const combinedText = Object.entries(docs)
            .map(([, data]) => data.text || data.package?.context_text || '')
            .join('\n');
          return {
            bidder_id: bidderId,
            bidder_name: selectedProject.bidders.find(b => b.id === bidderId)?.name || bidderId,
            extracted_text: combinedText,
            fields: {},
          };
        });
      }

      // ── Criteria Extraction: LLM first → Regex fallback → Manual ──
      let derivedCriteria = pipelineResult.criteria || [];
      let criteriaMethod = 'pipeline';  // Track extraction source for user visibility
      let criteriaLogs = [];

      if (derivedCriteria.length === 0 && derivedText) {
        // Step A: Try LLM-based extraction (best quality)
        setExtractionProgress('🤖 Running AI criteria extraction on tender document...');
        try {
          const analyzeRes = await TenderAPI.analyze({ tender_text: derivedText });
          const analyzeData = analyzeRes.data;

          if (analyzeData.status === 'success' && analyzeData.criteria?.length > 0) {
            derivedCriteria = analyzeData.criteria;
            criteriaMethod = 'llm';
            criteriaLogs.push({
              level: 'success',
              message: `✅ AI extracted ${analyzeData.criteria_count} criteria in ${analyzeData.duration_seconds}s (${analyzeData.provider})`,
            });
          } else {
            // LLM returned but with error status
            criteriaLogs.push({
              level: 'warning',
              message: `⚠️ AI extraction returned no criteria: ${analyzeData.error || 'Unknown reason'}`,
            });
            if (analyzeData.fallback_hint) {
              criteriaLogs.push({ level: 'info', message: `💡 ${analyzeData.fallback_hint}` });
            }
            if (analyzeData.error_details?.length > 0) {
              analyzeData.error_details.forEach(d => {
                criteriaLogs.push({ level: 'error', message: `   ↳ ${d.type || d.provider || ''}: ${d.message || d.error || ''}` });
              });
            }
          }
        } catch (llmErr) {
          // LLM call completely failed (network, timeout, etc.)
          criteriaLogs.push({
            level: 'warning',
            message: `⚠️ AI criteria extraction failed: ${llmErr?.response?.data?.detail || llmErr.message || 'Unknown error'}`,
          });
          criteriaLogs.push({ level: 'info', message: '💡 Falling back to pattern-based extraction...' });
        }

        // Step B: Regex fallback (if LLM produced nothing)
        if (derivedCriteria.length === 0) {
          derivedCriteria = extractCriteriaFromText(derivedText);
          criteriaMethod = 'regex';
          if (derivedCriteria.length > 0) {
            criteriaLogs.push({
              level: 'info',
              message: `📝 Regex fallback extracted ${derivedCriteria.length} criteria. Please review and edit in Tender Setup.`,
            });
          } else {
            criteriaLogs.push({
              level: 'warning',
              message: '⚠️ No criteria extracted by AI or regex. You can add criteria manually in Tender Setup.',
            });
          }
        }
      }

      // Store extraction results
      updateProject(selectedProjectId, {
        status: 'extracted',
        extractionStatus: 'complete',
        extractedContent: pipelineResult,
        extractedText: derivedText,
        extractedCriteria: derivedCriteria,
        extractedBidderData: derivedBidderData,
        criteriaExtractionMethod: criteriaMethod,
        criteriaExtractionLogs: criteriaLogs,
      });

      setExtractionProgress('✅ Extraction complete! Redirecting to Tender Setup...');
      setTimeout(() => navigate('/tender'), 800);

    } catch (err) {
      console.error('Extraction failed:', err);
      updateProject(selectedProjectId, {
        extractionStatus: 'failed',
        extractionError: err.message || 'Extraction pipeline failed.',
      });
      setError(`❌ Extraction failed: ${err.message || 'Check documents and try again.'}`);
    } finally {
      setExtracting(false);
      setActiveJobId(null);
    }
  };

  const handleStopExtraction = async () => {
    if (!activeJobId) return;
    try {
      setExtractionProgress('Stopping extraction...');
      await PipelineAPI.stopExtract(activeJobId);
      // The polling loop will detect "complete" (with partial results)
      // and resolve normally.
    } catch (err) {
      console.error('Failed to stop extraction:', err);
      setError('Could not stop extraction: ' + err.message);
    }
  };

  // Sandbox ingestion callback
  const handleSandboxIngest = () => {};

  const project = selectedProject;

  // ── Workflow Status ──
  const tenderUploaded = project && (
    project.tenderDocuments.length > 0 || project.sandboxMode
  );
  const biddersReady = project && (
    (project.bidders.length > 0 && project.bidders.some(b => b.documents.length > 0)) ||
    project.sandboxMode
  );

  // Source label
  const sourceLabel = project?.sandboxMode ? 'SANDBOX' : 'DOCUMENT';

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1>Data Ingestion</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          {project ? `Project: ${project.name}` : 'Create a project from Dashboard first, or files will auto-create one'}
        </p>
      </div>

      {/* ── MODE SWITCH ── */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 24,
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        width: 'fit-content',
      }}>
        <button
          onClick={() => setMode('upload')}
          style={{
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-family)',
            background: mode === 'upload' ? 'var(--accent)' : 'var(--bg-card)',
            color: mode === 'upload' ? '#fff' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          📤 Upload Documents
        </button>
        <button
          onClick={() => setMode('sandbox')}
          style={{
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 600,
            border: 'none',
            borderLeft: '1px solid var(--border-color)',
            cursor: 'pointer',
            fontFamily: 'var(--font-family)',
            background: mode === 'sandbox' ? 'var(--accent)' : 'var(--bg-card)',
            color: mode === 'sandbox' ? '#fff' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          🌐 Use Sandbox API
        </button>
      </div>

      {/* ── WORKFLOW STATUS TRACKER ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>📋 Workflow Status</h3>
          <span className={`header-badge ${sourceLabel === 'SANDBOX' ? 'mock' : 'live'}`}>
            {sourceLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <WorkflowStep done={tenderUploaded} label="Data Ingested" />
          <WorkflowStep
            done={project?.extractionStatus === 'complete'}
            pending={extracting || project?.extractionStatus === 'running'}
            label="Extraction Complete"
          />
          <WorkflowStep done={false} label="PII Masked" />
          <WorkflowStep
            done={project?.criteriaLocked}
            pending={project?.extractionStatus === 'complete' && !project?.criteriaLocked}
            label="Criteria Locked"
          />
          <WorkflowStep
            done={project?.status === 'reviewed'}
            pending={project?.criteriaLocked && project?.status !== 'reviewed'}
            label="Review Complete"
          />
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 12 }}>
          {mode === 'upload'
            ? 'Upload → Extract → Lock Criteria → Review & Correct → Evaluate'
            : 'Sandbox Fetch → Extract → Lock Criteria → Review & Correct → Evaluate'
          }
        </p>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* MODE: SANDBOX API                       */}
      {/* ═══════════════════════════════════════ */}
      {mode === 'sandbox' && (
        <SandboxMode onIngest={handleSandboxIngest} />
      )}

      {/* ═══════════════════════════════════════ */}
      {/* MODE: DOCUMENT UPLOAD                   */}
      {/* ═══════════════════════════════════════ */}
      {mode === 'upload' && (
        <>
          {/* ── TENDER DOCUMENTS ── */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3>📋 Tender Documents</h3>
              <div style={{ display: 'flex', gap: 4 }}>
                {TENDER_DOC_TYPES.map(type => (
                  <button key={type} className="btn btn-sm btn-secondary" onClick={() => setActiveTenderUpload(type)}>
                    + {type}
                  </button>
                ))}
              </div>
            </div>

            {activeTenderUpload && (
              <div style={{ marginBottom: 16, padding: 12, background: 'var(--accent-light)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>
                  📁 Adding: {activeTenderUpload} document
                </p>
                <FileUpload label={`Drop ${activeTenderUpload} tender document`} onFile={handleTenderFile} />
                <button className="btn btn-sm btn-secondary" onClick={() => setActiveTenderUpload(null)} style={{ marginTop: 8 }}>
                  Cancel
                </button>
              </div>
            )}

            {project && project.tenderDocuments.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th><th>Type</th><th>Size</th>
                    <th>Source</th><th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {project.tenderDocuments.map(doc => (
                    <tr key={doc.id}>
                      <td><strong>{doc.name}</strong></td>
                      <td><span className="verdict pass">{doc.type}</span></td>
                      <td style={{ fontSize: '0.8rem' }}>{(doc.size / 1024).toFixed(1)} KB</td>
                      <td><span className="header-badge live">DOCUMENT</span></td>
                      <td>
                        <button className="btn btn-sm btn-secondary" onClick={() => removeTenderDocument(doc.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              !activeTenderUpload && (
                <div className="empty-state" style={{ padding: 30 }}>
                  <p>No tender documents. Click <strong>+ MAIN</strong> to add the primary tender document.</p>
                </div>
              )
            )}
          </div>

          {/* ── BIDDERS ── */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3>🏢 Bidders</h3>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                className="form-input"
                placeholder="Bidder company name"
                value={newBidderName}
                onChange={(e) => setNewBidderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBidder()}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={handleAddBidder} disabled={!newBidderName.trim()}>
                + Add Bidder
              </button>
            </div>

            {project && project.bidders.map(bidder => (
              <div key={bidder.id} style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: 16,
                marginBottom: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <strong>{bidder.name}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                      {bidder.documents.length} doc{bidder.documents.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {/* Single generic Add Document button */}
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => openBidderUpload(bidder.id)}
                  >
                    + Add Document
                  </button>
                </div>

                {/* Upload zone for this bidder */}
                {activeBidderUpload?.bidderId === bidder.id && (
                  <div style={{ marginBottom: 12, padding: 12, background: 'var(--accent-light)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, flexShrink: 0 }}>Type (optional):</label>
                      <select
                        className="form-input"
                        value={bidderDocType}
                        onChange={(e) => setBidderDocType(e.target.value)}
                        style={{ maxWidth: 200, fontSize: '0.8rem' }}
                      >
                        {BIDDER_DOC_TYPES.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        AI will auto-classify if skipped
                      </span>
                    </div>
                    <FileUpload label={`Drop document for ${bidder.name}`} onFile={handleBidderFile} />
                    <button className="btn btn-sm btn-secondary" onClick={() => setActiveBidderUpload(null)} style={{ marginTop: 8 }}>
                      Cancel
                    </button>
                  </div>
                )}

                {/* Document list */}
                {bidder.documents.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {bidder.documents.map(doc => {
                      const docType = doc.doc_type || doc.type || 'Other';
                      const colorClass = DOC_TYPE_COLORS[docType] || 'review';
                      return (
                        <div key={doc.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 12px',
                          background: 'var(--bg-secondary)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8rem',
                          border: '1px solid var(--border-color)',
                        }}>
                          <span style={{ fontSize: '0.9rem' }}>📄</span>
                          <span style={{ flex: 1, fontWeight: 500 }}>{doc.name}</span>
                          <span className={`verdict ${colorClass}`} style={{ fontSize: '0.7rem' }}>
                            {docType}
                          </span>
                          {doc.size && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {(doc.size / 1024).toFixed(0)} KB
                            </span>
                          )}
                          <button
                            onClick={() => removeBidderDocument(bidder.id, doc.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    No documents yet. Click <strong>+ Add Document</strong> to upload any bidder document.
                  </p>
                )}
              </div>
            ))}

            {(!project || project.bidders.length === 0) && (
              <div className="empty-state" style={{ padding: 30 }}>
                <p>No bidders added. Enter a bidder name above to get started.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── EXTRACTION PROGRESS ── */}
      {extracting && (
        <div className="card" style={{ marginBottom: 16, padding: 20, textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
          <p style={{ fontWeight: 600 }}>{extractionProgress}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Extracting text, identifying criteria, and structuring data...
          </p>
        </div>
      )}

      {/* ── ERROR ── */}
      {error && (
        <div style={{
          padding: '12px 16px', background: 'var(--fail-bg)', border: '1px solid #fecaca',
          borderRadius: 'var(--radius-md)', color: 'var(--fail)', marginBottom: 16, fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {/* ── PROCEED: TRIGGER PIPELINE ── */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          className="btn btn-primary"
          onClick={handleRunPipeline}
          disabled={(!tenderUploaded || !biddersReady) && !project?.sandboxMode || extracting}
          style={{ padding: '12px 32px', fontSize: '1rem', flex: 1 }}
        >
          {extracting ? (
            <><span className="spinner" style={{ width: 16, height: 16 }}></span> Extracting...</>
          ) : project?.extractionStatus === 'complete' ? (
            project?.criteriaLocked ? '📋 Go to Review & Correct →' : '📋 Go to Criteria Setup →'
          ) : (
            '⚡ Run Extraction & Proceed →'
          )}
        </button>

        {extracting && (
          <button
            className="btn btn-outline"
            onClick={handleStopExtraction}
            style={{ padding: '12px 24px', fontSize: '1rem', color: 'var(--fail)', borderColor: 'var(--fail)', backgroundColor: 'transparent' }}
          >
            ⏹ Stop Extraction
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Generates synthetic extraction data when pipeline API is unavailable.
 * Uses sandbox data or mock criteria for demo/testing purposes.
 */
/**
 * Deterministic criteria parser — extracts numbered eligibility criteria
 * from raw extracted text using pattern matching. No AI involved.
 */
function extractCriteriaFromText(text) {
  if (!text) return [];

  const criteria = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Match numbered lines like "1. The bidder must..." or "1) ..."
  const numberedLineRegex = /^(\d+)[.)]\s+(.+)/;

  // Keyword maps for auto-categorization
  const categoryMap = [
    { keywords: ['turnover', 'revenue', 'sales', 'financial statement', 'audited'], category: 'financial', type: 'numeric' },
    { keywords: ['net worth', 'equity', 'net assets'], category: 'financial', type: 'numeric' },
    { keywords: ['gst', 'gstin', 'tax'], category: 'compliance', type: 'document' },
    { keywords: ['iso', 'certification', 'certificate', 'bis'], category: 'technical', type: 'document' },
    { keywords: ['project', 'experience', 'completed', 'similar'], category: 'technical', type: 'numeric' },
    { keywords: ['emd', 'earnest money', 'deposit'], category: 'financial', type: 'numeric' },
    { keywords: ['pan', 'aadhaar', 'identity'], category: 'compliance', type: 'document' },
  ];

  // Currency/value patterns
  const valueRegex = /(?:₹|Rs\.?|INR)\s*[\d,.]+\s*(?:crore|lakh|cr|lac)?|\d+\s*(?:crore|lakh|cr|lac)|at\s+least\s+(\d+)/gi;

  for (const line of lines) {
    const match = line.match(numberedLineRegex);
    if (!match) continue;

    const idx = parseInt(match[1], 10);
    const content = match[2];
    const lower = content.toLowerCase();

    // Determine category
    let category = 'general';
    let type = 'text';
    for (const rule of categoryMap) {
      if (rule.keywords.some(k => lower.includes(k))) {
        category = rule.category;
        type = rule.type;
        break;
      }
    }

    // Extract required value
    let requiredValue = '';
    const valueMatch = content.match(valueRegex);
    if (valueMatch) {
      requiredValue = valueMatch[0].trim();
    } else {
      // Try to extract descriptive requirements like "Valid GSTIN", "ISO 9001"
      const descMatch = content.match(/(?:valid|possess|submit|provide)\s+(.+?)(?:\.|$)/i);
      if (descMatch) requiredValue = descMatch[1].trim();
    }

    // Build a short criterion name from content
    let name;
    if (lower.includes('turnover')) name = 'Annual Turnover';
    else if (lower.includes('net worth')) name = 'Net Worth';
    else if (lower.includes('gst')) name = 'GST Registration';
    else if (lower.includes('iso')) name = 'ISO Certification';
    else if (lower.includes('similar') && lower.includes('project')) name = 'Similar Project Experience';
    else if (lower.includes('emd') || lower.includes('earnest money')) name = 'EMD / Earnest Money Deposit';
    else if (lower.includes('financial statement') || lower.includes('audited')) name = 'Audited Financial Statements';
    else if (lower.includes('pan')) name = 'PAN Verification';
    else name = content.length > 60 ? content.slice(0, 57) + '...' : content;

    criteria.push({
      criterion_id: `C${String(idx).padStart(3, '0')}`,
      name,
      description: content,
      required_value: requiredValue || '—',
      type,
      category,
      mandatory: true,
      comparison_operator: type === 'numeric' ? '>=' : 'match',
      units: category === 'financial' ? 'INR' : '',
    });
  }

  return criteria;
}

function generateSyntheticExtraction(project) {
  // Use sandbox data if available
  const sandboxTender = project.sandboxData?.tender;
  const sandboxBidders = project.sandboxData?.bidders || [];

  const criteria = sandboxTender?.eligibility_criteria
    ? sandboxTender.eligibility_criteria.map(c => ({
      criterion_id: c.criterion_id,
      name: c.name,
      description: c.description || '',
      required_value: c.required_value,
      type: c.type,
      category: c.category,
      mandatory: c.mandatory !== false,
      comparison_operator: c.comparison_operator || '>=',
      units: c.units || '',
    }))
    : []; // No fake criteria — only real data from sandbox or extraction

  const bidder_data = sandboxBidders.length > 0
    ? sandboxBidders.map(b => ({
        bidder_id: b._ubid || b.ubid,
        bidder_name: b.company_name || b.name,
        extracted_text: `Bidder: ${b.company_name || b.name}\nTurnover: ${b.annual_turnover}\nGSTIN: ${b.gstin}\nNet Worth: ${b.net_worth}`,
        fields: {
          annual_turnover: b.annual_turnover,
          gstin: b.gstin,
          net_worth: b.net_worth,
          experience_years: b.experience_years,
          similar_projects: b.similar_projects,
          iso_certification: b.iso_certification,
        },
      }))
    : project.bidders.map(b => ({
        bidder_id: b.id,
        bidder_name: b.name,
        extracted_text: `Bidder: ${b.name} (${b.documents.length} documents uploaded)`,
        fields: {},
      }));

  // Ensure structural fallback for ReviewCorrection UI
  let tender_documents = {};
  if (project.sandboxMode && sandboxTender) {
    const tenderName = sandboxTender.name || sandboxTender.tender_name || 'Unknown Tender';
    const tenderAuth = sandboxTender.authority || sandboxTender.issuing_authority || 'Unknown Authority';
    const text = `Tender: ${tenderName}\nAuthority: ${tenderAuth}\nValue: ${sandboxTender.estimated_value || 'N/A'}`;
    tender_documents['sandbox_tender'] = { text, package: { context_text: text } };
   } else {
    // Reuse previously extracted content if available, otherwise show a clear message
    const priorContent = project.extractedContent?.tender_documents;
    project.tenderDocuments.forEach(doc => {
      // Try to reuse real extraction data from a prior successful run
      const priorDoc = priorContent?.[doc.name];
      if (priorDoc) {
        tender_documents[doc.name] = priorDoc;
      } else {
        const fallbackText = project.extractedText || `Tender document: ${doc.name}\n\nExtraction pending — please run extraction pipeline.`;
        tender_documents[doc.name] = { text: fallbackText, package: { context_text: fallbackText } };
      }
    });
  }

  let bidder_documents = {};
  if (project.sandboxMode && project.sandboxData?.bidders) {
    project.sandboxData.bidders.forEach(b => {
      const bidderName = b.name || b.company_name || 'Unknown Bidder';
      const text = `Bidder: ${bidderName}\nTurnover: ${b.annual_turnover || b.turnover || 'N/A'}\nGSTIN: ${b.gstin || 'N/A'}\nNet Worth: ${b.net_worth || 'N/A'}`;
      bidder_documents[b.ubid || b._ubid] = {
        'sandbox_bidder': { text, package: { context_text: text } }
      };
    });
  } else {
    const priorBidderContent = project.extractedContent?.bidder_documents;
    project.bidders.forEach(b => {
      bidder_documents[b.id] = {};
      b.documents.forEach(doc => {
        const priorDoc = priorBidderContent?.[b.id]?.[doc.name];
        if (priorDoc) {
          bidder_documents[b.id][doc.name] = priorDoc;
        } else {
          const fallbackText = `Bidder document: ${doc.name}\n\nExtraction pending — please run extraction pipeline.`;
          bidder_documents[b.id][doc.name] = { text: fallbackText, package: { context_text: fallbackText } };
        }
      });
    });
  }

  const extractedTenderName = sandboxTender?.name || sandboxTender?.tender_name || 'Unknown Tender';
  const extractedTenderAuth = sandboxTender?.authority || sandboxTender?.issuing_authority || 'Unknown Authority';

  return {
    extracted_text: sandboxTender
      ? `Tender: ${extractedTenderName}\nAuthority: ${extractedTenderAuth}\nValue: ${sandboxTender.estimated_value || 'N/A'}`
      : `Tender document extracted (${project.tenderDocuments.length} documents)`,
    criteria,
    bidder_data,
    tender_documents,
    bidder_documents
  };
}

/* Workflow step indicator */
function WorkflowStep({ done, pending, label }) {
  let icon = '⬜';
  let color = 'var(--text-muted)';
  if (done) { icon = '✅'; color = 'var(--pass)'; }
  else if (pending) { icon = '⏳'; color = 'var(--review)'; }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: '1rem' }}>{icon}</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 500, color }}>{label}</span>
    </div>
  );
}
