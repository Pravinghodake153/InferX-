import { useState, useEffect } from 'react';
import { SettingsAPI, AuditAPI } from '../services/api';
import { useApp } from '../context/useApp';
import { Bot, CheckCircle, Save, Link, AlertOctagon, ClipboardList, XCircle, Server } from 'lucide-react';

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
  const [saved, setSaved] = useState(false);
  const [chainStatus, setChainStatus] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await SettingsAPI.get();
        if (res.data.provider) setProvider(res.data.provider);
        if (res.data.model) setModel(res.data.model);
        if (res.data.context_size) setContextSize(res.data.context_size);
        if (res.data.sandbox_api_url !== undefined) setSandboxApiUrl(res.data.sandbox_api_url);
        if (res.data.sandbox_api_key !== undefined) setSandboxApiKey(res.data.sandbox_api_key);
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
    };
    init();
  }, []);

  const handleSave = async () => {
    try {
      await SettingsAPI.update({ 
        provider, 
        model, 
        context_size: parseInt(contextSize, 10),
        sandbox_api_url: sandboxApiUrl,
        sandbox_api_key: sandboxApiKey
      });
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {saved ? <><CheckCircle size={16} /> Saved</> : <><Save size={16} /> Save Sandbox API</>}
          </button>
        </div>
      </div>

      {/* Audit Chain Status */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Link size={20} /> Audit Chain Integrity</h3></div>
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
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log, i) => (
                <tr key={i}>
                  <td>
                    <span className={`verdict ${log.action === 'PII_REVEAL' ? 'review' : log.action === 'CORRECTION' ? 'fail' : 'pass'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td>{log.officer_id}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>{log.context || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ padding: 16, color: 'var(--text-muted)' }}>No audit logs yet.</p>
        )}
      </div>
    </div>
  );
}
