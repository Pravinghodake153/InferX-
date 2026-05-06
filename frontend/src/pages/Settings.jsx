import { useState, useEffect } from 'react';
import { SettingsAPI, AuditAPI } from '../services/api';
import { useApp } from '../context/useApp';
import { Bot, Globe, Sparkles, CheckCircle, Save, Link, AlertOctagon, ClipboardList, XCircle } from 'lucide-react';

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
  const [saved, setSaved] = useState(false);
  const [chainStatus, setChainStatus] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await SettingsAPI.get();
        if (res.data.provider) setProvider(res.data.provider);
        if (res.data.model) setModel(res.data.model);
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
      await SettingsAPI.update({ provider, model });
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

        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
          <div 
            onClick={() => { setProvider('openrouter'); setModel(OPENROUTER_MODELS[0].id); }}
            style={{ 
              flex: 1, padding: '16px', border: provider === 'openrouter' ? '2px solid var(--primary)' : '1px solid var(--border)', 
              borderRadius: 8, cursor: 'pointer', background: provider === 'openrouter' ? 'var(--pass-bg)' : 'transparent',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Globe size={24} className="text-primary" />
              <strong style={{ fontSize: '1rem' }}>OpenRouter</strong>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Unified API gateway. Access Claude, GPT-4o, and Llama natively.
            </p>
          </div>

          <div 
            onClick={() => { setProvider('gemini'); setModel(GEMINI_MODELS[0].id); }}
            style={{ 
              flex: 1, padding: '16px', border: provider === 'gemini' ? '2px solid var(--primary)' : '1px solid var(--border)', 
              borderRadius: 8, cursor: 'pointer', background: provider === 'gemini' ? '#e0f2fe' : 'transparent',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Sparkles size={24} className="text-primary" />
              <strong style={{ fontSize: '1rem' }}>Google Gemini API</strong>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Official Google API. Fast, native access to Gemini 1.5 & 2.0.
            </p>
          </div>
        </div>

        <div className="form-group">
          <label>Model Selection</label>
          <select className="form-input" value={model} onChange={(e) => setModel(e.target.value)} style={{ maxWidth: 400 }}>
            {(provider === 'openrouter' ? OPENROUTER_MODELS : GEMINI_MODELS).map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Provider: <strong>{provider.toUpperCase()}</strong> &nbsp;|&nbsp; Model ID: <code style={{ background: 'var(--bg-input)', padding: '1px 4px', borderRadius: 3 }}>{model}</code>
          </p>
        </div>

        <button className="btn btn-primary" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saved ? <><CheckCircle size={16} /> Saved</> : <><Save size={16} /> Save Settings</>}
        </button>
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
