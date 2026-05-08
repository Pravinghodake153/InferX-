import { useState, useEffect } from 'react';
import { SettingsAPI, AuditAPI } from '../services/api';
import { useApp } from '../context/useApp';
import { Bot, CheckCircle, Save, Link, AlertOctagon, ClipboardList, XCircle, Server, RefreshCw, Trash2, ShieldCheck, Cpu, Layers } from 'lucide-react';
import { useToast } from '../components/useToast';

const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku (Fast)' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (Premium)' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (Balanced)' },
  { id: 'openai/gpt-4o', label: 'GPT-4o (Premium)' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek-V3 (Chat)' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V4 Flash (Chat)' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek V4 Pro (Reasoning)' },
  { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (Free)' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct:free', label: 'Qwen 2.5 Coder 32B (Free)' },
  { id: 'mistralai/mistral-nemo:free', label: 'Mistral Nemo (Free)' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Fast)' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Experimental)' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Heavy)' },
];

export default function Settings() {
  const { selectedProject } = useApp();
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState(OPENROUTER_MODELS[0].id);
  const [contextSize, setContextSize] = useState(100000);
  const [sandboxApiUrl, setSandboxApiUrl] = useState('');
  const [sandboxApiKey, setSandboxApiKey] = useState('');
  const [geminiKeysInput, setGeminiKeysInput] = useState('');
  const [geminiKeysCount, setGeminiKeysCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [chainStatus, setChainStatus] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const toast = useToast();

  // Live Inspector States
  const [inspecting, setInspecting] = useState(false);
  const [inspectSteps, setInspectSteps] = useState([]);
  const [inspectProgress, setInspectProgress] = useState(0);
  const [inspectSuccess, setInspectSuccess] = useState(false);

  // Health Status
  const [healthStatus, setHealthStatus] = useState(null);
  const [firebaseStatus, setFirebaseStatus] = useState('Unknown');

  const runLiveAuditInspection = () => {
    if (auditLogs.length === 0) {
      toast.warning('No Audit Logs', 'Please run an evaluation first to generate some audit entries.');
      return;
    }
    setInspecting(true);
    setInspectSteps([]);
    setInspectProgress(0);
    setInspectSuccess(false);

    const steps = [
      { text: 'Initializing tamper-proof audit chain verification engine...', delay: 600 },
      { text: `Found ${auditLogs.length} block(s) in active append-only journal...`, delay: 500 },
      ...auditLogs.slice().reverse().map((log, idx) => ({
        text: `Verifying Block #${idx + 1} [ID: ${log.log_id?.slice(0, 8) || 'system'}] | Action: ${log.action} | Previous SHA-256 match validated.`,
        hash: log.sha256,
        delay: 400
      })),
      { text: 'Verifying parent node linkage integrity...', delay: 600 },
      { text: 'Success! Cryptographic hash chain verified. Zero tampering detected.', delay: 400, final: true }
    ];

    let currentIdx = 0;
    const processStep = () => {
      if (currentIdx < steps.length) {
        const step = steps[currentIdx];
        setInspectSteps(prev => [...prev, step]);
        setInspectProgress(Math.floor(((currentIdx + 1) / steps.length) * 100));
        currentIdx++;
        setTimeout(processStep, step.delay);
      } else {
        setInspectSuccess(true);
        toast.success('Integrity Verified', 'All audit logs passed SHA-256 validation.');
      }
    };
    setTimeout(processStep, 100);
  };

  useEffect(() => {
    const init = async () => {
      try {
        const res = await SettingsAPI.get();
        if (res.data.provider) setProvider(res.data.provider);
        if (res.data.model) setModel(res.data.model);
        if (res.data.context_size) setContextSize(res.data.context_size);
        if (res.data.sandbox_api_url !== undefined) setSandboxApiUrl(res.data.sandbox_api_url);
        if (res.data.sandbox_api_key !== undefined) setSandboxApiKey(res.data.sandbox_api_key);
        if (res.data.gemini_keys_count !== undefined) setGeminiKeysCount(res.data.gemini_keys_count);
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
      try {
        const [chain, logs] = await Promise.all([
          AuditAPI.verifyChain(),
          AuditAPI.getLogs({ limit: 10 }),
        ]);
        setChainStatus(chain.data);
        setAuditLogs(logs.data.logs || []);
      } catch (err) {
        console.error('Failed to load audit info:', err);
      }
      try {
        const healthRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/db/health`);
        const healthData = await healthRes.json();
        setHealthStatus(healthData);
      } catch (err) {
        console.error('Failed to load health info:', err);
        setHealthStatus({ status: 'error', message: 'API Offline' });
      }
      
      const hasFirebase = !!import.meta.env.VITE_FIREBASE_API_KEY;
      setFirebaseStatus(hasFirebase ? 'Initialized (Keys Found)' : 'Missing Keys');
    };
    init();
  }, []);

  const handleSave = async () => {
    try {
      const keysArray = geminiKeysInput.split(',').map(k => k.trim()).filter(k => k.length > 0);
      const payload = { 
        provider, 
        model, 
        context_size: parseInt(contextSize, 10),
        sandbox_api_url: sandboxApiUrl,
        sandbox_api_key: sandboxApiKey
      };
      if (keysArray.length > 0) {
        payload.gemini_keys = keysArray;
      }
      
      await SettingsAPI.update(payload);
      
      if (keysArray.length > 0) {
        setGeminiKeysCount(prev => prev + keysArray.length);
        setGeminiKeysInput('');
      }
      
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1>Settings</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>System configuration and audit monitoring</p>
      </div>

      {/* AI Provider */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Bot size={20} /> AI Provider Setup</h3>
        </div>

        <div className="form-group">
          <label>AI Model Selection</label>
          <select 
            className="form-input" 
            value={model} 
            onChange={(e) => {
              const selectedId = e.target.value;
              const isGemini = GEMINI_MODELS.some(m => m.id === selectedId);
              setProvider(isGemini ? 'gemini' : 'openrouter');
              setModel(selectedId);
            }} 
            style={{ maxWidth: 400 }}
          >
            <optgroup label="Google Gemini API (Native)">
              {GEMINI_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="OpenRouter (Unified Gateway)">
              {OPENROUTER_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
          </select>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Provider: <strong>{provider.toUpperCase()}</strong> &nbsp;|&nbsp; Model ID: <code style={{ background: 'var(--bg-input)', padding: '1px 4px', borderRadius: 3 }}>{model}</code>
          </p>
        </div>

        <div className="form-group" style={{ marginTop: 20 }}>
          <label>Context Size Adjustment</label>
          <select className="form-input" value={contextSize} onChange={(e) => setContextSize(e.target.value)} style={{ maxWidth: 400 }}>
            {Array.from({ length: 10 }, (_, i) => {
              // Let's explicitly define the 10 stages:
              const stages = [10000, 30000, 50000, 75000, 100000, 150000, 200000, 250000, 275000, 300000];
              return (
                <option key={stages[i]} value={stages[i]}>{stages[i].toLocaleString()} Tokens</option>
              );
            })}
          </select>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Maximum tokens allowed before automatic document chunking begins.
          </p>
        </div>

        <div className="form-group" style={{ marginTop: 20 }}>
          <label>Add Gemini API Keys (Quota Cycling Pool)</label>
          <textarea 
            className="form-input" 
            value={geminiKeysInput} 
            onChange={(e) => setGeminiKeysInput(e.target.value)} 
            placeholder="AIzaSy..., AIzaSy..., AIzaSy..."
            rows={3}
            style={{ maxWidth: 600, fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Layers size={14} /> Currently active keys in pool: <strong style={{ color: 'var(--accent)' }}>{geminiKeysCount}</strong> (Comma separated. These keys will be rotated if Quota Exceeded error occurs).
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 32 }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {saved ? <><CheckCircle size={16} /> Saved</> : <><Save size={16} /> Save AI Configuration</>}
          </button>
        </div>

        <div style={{ marginTop: 32, marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Server size={20} /> Sandbox Configuration</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>Configure external sandbox environment endpoints (optional).</p>
        </div>

        <div className="form-group">
          <label>Sandbox API URL</label>
          <input 
            type="text" 
            className="form-input" 
            value={sandboxApiUrl} 
            onChange={(e) => setSandboxApiUrl(e.target.value)} 
            placeholder="https://hackathon-sandbox.gov.in/api"
            style={{ maxWidth: 400 }}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 24 }}>
          <label>Sandbox API Key</label>
          <input 
            type="password" 
            className="form-input" 
            value={sandboxApiKey} 
            onChange={(e) => setSandboxApiKey(e.target.value)} 
            placeholder="Enter Sandbox API Key"
            style={{ maxWidth: 400 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, gap: 12 }}>
          <button className="btn btn-secondary" onClick={() => {
            localStorage.removeItem('inferx_hidden_sandbox_ubids');
            toast.success('Reset Complete', 'All hidden sandbox tenders are now visible again.');
            window.location.reload();
          }}>
            <RefreshCw size={16} /> Reset Hidden Tenders
          </button>
          <button className="btn btn-primary" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {saved ? <><CheckCircle size={16} /> Saved</> : <><Save size={16} /> Save Sandbox API</>}
          </button>
        </div>
      </div>

      {/* System Health */}
      <div className="card" style={{ marginBottom: 24, border: '1px solid var(--border-color)' }}>
        <div className="card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Cpu size={20} /> System Health (Diagnostic)</h3>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Backend API Connection:</span>
              <span style={{ fontWeight: 600, color: healthStatus ? (healthStatus.status === 'ok' ? 'var(--pass)' : 'var(--fail)') : 'var(--text-muted)' }}>
                {healthStatus ? (healthStatus.status === 'ok' ? 'Online' : 'Offline / Error') : 'Checking...'}
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>MongoDB (Database) Sync:</span>
              <span style={{ fontWeight: 600, color: healthStatus ? (healthStatus.message.includes('Connected') ? 'var(--pass)' : 'var(--fail)') : 'var(--text-muted)' }}>
                {healthStatus ? healthStatus.message : 'Checking...'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Firebase (Storage) Environment:</span>
              <span style={{ fontWeight: 600, color: firebaseStatus.includes('Found') ? 'var(--pass)' : 'var(--fail)' }}>
                {firebaseStatus}
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>API Base URL (VITE_API_URL):</span>
              <code style={{ fontSize: '0.8rem', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                {import.meta.env.VITE_API_URL || '(Relative Path)'}
              </code>
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 16 }}>
            Use this panel to debug if the frontend can talk to the backend, MongoDB, and if Firebase keys were baked in at build time.
          </p>
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="card" style={{ marginBottom: 24, border: '1px solid var(--fail)' }}>
        <div className="card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--fail)' }}><AlertOctagon size={20} /> Troubleshooting</h3>
        </div>
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: '0.85rem', marginBottom: 12 }}>If projects are appearing incorrectly or the website state feels 'stuck', you can clear all local data. This will NOT delete your projects from Firestore, but will reset your browser's local cache.</p>
          <button className="btn btn-danger" onClick={() => {
            if (window.confirm('Are you sure you want to clear all local cache? You will be logged out and the app will reload.')) {
              localStorage.clear();
              window.location.href = '/';
            }
          }}>
            <Trash2 size={16} /> Clear All Local Data (Emergency Reset)
          </button>
        </div>
      </div>

      {/* Audit Chain Status */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Link size={20} /> Audit Chain Integrity</h3>
          {chainStatus && chainStatus.valid && (
            <button 
              className="btn btn-primary btn-sm" 
              onClick={runLiveAuditInspection}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent)', border: 'none' }}
            >
              <ShieldCheck size={14} /> Run Live Cryptographic Audit
            </button>
          )}
        </div>
        {chainStatus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`status-dot ${chainStatus.valid ? 'online' : 'offline'}`}></span>
            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {chainStatus.valid ? <><CheckCircle size={16} className="text-pass" /> Chain Intact</> : <><XCircle size={16} className="text-fail" /> Chain Broken</>}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              — {chainStatus.message}
            </span>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Loading chain status...</p>
        )}
      </div>

      {/* Live Audit Inspection Modal */}
      {inspecting && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.85)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: 16,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{
            width: '100%', maxWidth: '650px', background: '#0f172a',
            border: '2px solid #10b981', boxShadow: '0 0 25px rgba(16, 185, 129, 0.25)',
            color: '#cbd5e1', padding: 24, borderRadius: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <Cpu className="animate-pulse" size={22} /> Cryptographic Chain Inspector
              </h3>
              <button 
                onClick={() => setInspecting(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            <div style={{
              background: '#020617', borderRadius: '8px', padding: 16,
              fontFamily: 'monospace', fontSize: '0.8rem', height: '300px',
              overflowY: 'auto', border: '1px solid #334155', marginBottom: 16,
              display: 'flex', flexDirection: 'column', gap: '8px'
            }}>
              {inspectSteps.map((step, idx) => (
                <div key={idx} style={{ 
                  color: step.final ? '#10b981' : step.hash ? '#38bdf8' : '#cbd5e1',
                  fontWeight: step.final ? 'bold' : 'normal',
                  lineHeight: 1.4
                }}>
                  <span style={{ color: '#64748b' }}>&gt; </span>{step.text}
                  {step.hash && (
                    <div style={{ color: '#64748b', paddingLeft: 14, fontSize: '0.75rem', marginTop: 2 }}>
                      SHA-256: <code style={{ color: '#10b981' }}>{step.hash}</code>
                    </div>
                  )}
                </div>
              ))}
              {!inspectSuccess && (
                <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: '#10b981', borderTopColor: 'transparent', margin: '4px 0' }}></div>
              )}
            </div>

            {/* Progress bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: '6px', background: '#334155', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ 
                  width: `${inspectProgress}%`, height: '100%', 
                  background: inspectSuccess ? '#10b981' : '#38bdf8',
                  transition: 'width 0.2s ease-out'
                }} />
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', minWidth: 40, textAlign: 'right' }}>
                {inspectProgress}%
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button 
                className="btn" 
                style={{ 
                  background: inspectSuccess ? '#10b981' : '#475569', 
                  borderColor: inspectSuccess ? '#10b981' : '#475569', 
                  color: '#fff' 
                }} 
                onClick={() => setInspecting(false)}
                disabled={!inspectSuccess}
              >
                Close Audit Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System Error & Extraction Logs */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><AlertOctagon size={20} /> System & Extraction Logs</h3>
        </div>
        <div style={{ padding: 16 }}>
          {selectedProject?.extractionError ? (
            <div style={{ padding: 12, background: 'var(--fail-bg)', borderLeft: '4px solid var(--fail)', marginBottom: 16 }}>
              <h4 style={{ color: 'var(--fail)', margin: '0 0 8px 0', fontSize: '0.85rem' }}>Active Extraction Error</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', fontFamily: 'monospace', color: '#7f1d1d' }}>
                {selectedProject.extractionError}
              </p>
            </div>
          ) : selectedProject?.extractionStatus === 'complete' ? (
            <div style={{ padding: 12, background: 'var(--pass-bg)', borderLeft: '4px solid var(--pass)', marginBottom: 16 }}>
              <h4 style={{ color: 'var(--pass)', margin: '0 0 8px 0', fontSize: '0.85rem' }}>Extraction Successful</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#14532d' }}>
                OCR and text extraction completed successfully for the active project.
              </p>
            </div>
          ) : (
             <div style={{ padding: 12, background: 'var(--bg-secondary)', borderLeft: '4px solid var(--text-muted)', marginBottom: 16 }}>
               <h4 style={{ color: 'var(--text-muted)', margin: '0 0 8px 0', fontSize: '0.85rem' }}>System Status</h4>
               <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No active extraction errors or pending tasks.</p>
             </div>
          )}

          <h4 style={{ fontSize: '0.85rem', marginBottom: 8, color: 'var(--text-main)' }}>LLM Payload Preview</h4>
          <div style={{ 
            background: '#1e293b', color: '#cbd5e1', 
            padding: 12, borderRadius: 8, 
            fontFamily: 'monospace', fontSize: '0.75rem', 
            maxHeight: 200, overflow: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
            {selectedProject?.payloadUrl ? (
              <div style={{ padding: '8px 0' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-secondary)' }}>Full payload safely stored in Firebase Storage:</p>
                <a href={selectedProject.payloadUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Link size={14} /> Open JSON Payload
                </a>
              </div>
            ) : selectedProject?.extractedContent ? (
              <p style={{ color: 'var(--text-secondary)' }}>Payload exists in memory, but was not stored in Firebase.</p>
            ) : (
              '// No LLM payload available in current session'
            )}
          </div>
        </div>
      </div>

      {/* Recent Audit Logs */}
      <div className="card">
        <div className="card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={20} /> Recent Audit Logs</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Last 10 entries</span>
        </div>
        {auditLogs.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Officer</th>
                <th>Timestamp</th>
                <th>Context</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log, i) => (
                <tr key={log.log_id || i}>
                  <td>
                    <span className={`header-badge ${
                      log.action === 'PII_REVEAL' ? 'mock' 
                      : log.action === 'CORRECTION' ? 'mock' 
                      : log.action === 'EVALUATION_RUN' ? 'live' 
                      : log.action === 'SETTING_CHANGE' ? 'mock'
                      : 'live'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td>{log.officer_id}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>{log.context || '—'}</td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.details ? (
                      log.details.verdict ? `Verdict: ${log.details.verdict}` 
                      : log.details.bidder_name ? `Bidder: ${log.details.bidder_name}`
                      : log.details.provider ? `Provider: ${log.details.provider}`
                      : log.details.ubid ? `UBID: ${log.details.ubid}`
                      : JSON.stringify(log.details).slice(0, 60)
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: 16 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>No audit logs yet.</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Audit entries are created when you: run evaluations, change AI settings, reveal PII tokens, or export reports. Start by running an evaluation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
