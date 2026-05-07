import { useState, useEffect } from 'react';
import { useApp } from '../context/useApp';
import { Landmark, Moon, Sun, Menu } from 'lucide-react';

export default function Header() {
  const { toggleSidebar, sidebarCollapsed, selectedProject } = useApp();
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('inferx_theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = theme;
    localStorage.setItem('inferx_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  return (
    <header className="header">
      <div className="header-left">
        <button
          className="btn btn-sm btn-secondary sidebar-toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Menu size={16} />
        </button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Landmark size={20} className="inline-icon text-primary" />
          InferX Tender Evaluation
        </h2>
        {selectedProject && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 4 }}>
            / {selectedProject.name}
          </span>
        )}
      </div>
      <div className="header-right">
        <span className="header-badge mock">Sandbox (Synthetic Data)</span>
        <button className="btn btn-sm btn-secondary" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Officer: OFF-001
        </span>
      </div>
    </header>
  );
}
