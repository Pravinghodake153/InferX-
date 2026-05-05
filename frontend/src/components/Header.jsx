import { useState, useEffect } from 'react';
import { useApp } from '../context/useApp';

export default function Header() {
  const { toggleSidebar, sidebarCollapsed, selectedProject } = useApp();
  const [theme, setTheme] = useState('light');
  const [piiMode, setPiiMode] = useState('masked');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = theme;
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  const togglePII = () => setPiiMode(m => m === 'masked' ? 'original' : 'masked');

  return (
    <header className="header">
      <div className="header-left">
        <button
          className="btn btn-sm btn-secondary sidebar-toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          ☰
        </button>
        <h2>🏛️ InferX Tender Evaluation</h2>
        {selectedProject && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 4 }}>
            / {selectedProject.name}
          </span>
        )}
      </div>
      <div className="header-right">
        <span className="header-badge mock">Sandbox (Synthetic Data)</span>
        <button
          className="btn btn-sm btn-secondary"
          onClick={togglePII}
          title={piiMode === 'masked' ? 'Click to show original values' : 'Click to mask PII'}
        >
          {piiMode === 'masked' ? '🔒 Masked' : '🔓 Original'}
        </button>
        <button className="btn btn-sm btn-secondary" onClick={toggleTheme}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Officer: OFF-001
        </span>
      </div>
    </header>
  );
}
