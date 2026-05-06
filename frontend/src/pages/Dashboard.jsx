import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SandboxAPI } from '../services/api';
import { useApp } from '../context/useApp';
import DataTable from '../components/DataTable';
import { Edit3, Upload, CheckCircle, Search, ClipboardList, FolderKanban, Trash2, XCircle } from 'lucide-react';
import { auth } from '../services/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    projects, selectedProjectId, setSelectedProjectId,
    addProject, deleteProject,
  } = useApp();

  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  
  // Auth Modal State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [projectToDelete, setProjectToDelete] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const t = await SandboxAPI.getTenders();
        setTenders(t.data.tenders || []);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    addProject({ name: newProjectName.trim() });
    setNewProjectName('');
    setShowNewProject(false);
    navigate('/upload');
  };

  const handleOpenProject = (project) => {
    setSelectedProjectId(project.id);
    if (project.status === 'evaluated') navigate('/evaluation');
    else if (project.status === 'uploaded') navigate('/review');
    else navigate('/upload');
  };

  const handleRequestDelete = (p) => {
    setProjectToDelete(p);
    setAuthEmail('');
    setAuthPassword('');
    setAuthError('');
    setShowAuthModal(true);
  };

  const confirmDelete = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('Email and password are required.');
      return;
    }
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      deleteProject(projectToDelete.id);
      setShowAuthModal(false);
      setProjectToDelete(null);
    } catch (err) {
      setAuthError('Authentication failed: ' + err.message);
    }
  };

  const statusBadge = (status) => {
    const map = {
      draft: { cls: 'review', label: <><Edit3 size={14} className="inline-icon" /> Draft</> },
      uploaded: { cls: 'mock', label: <><Upload size={14} className="inline-icon" /> Uploaded</> },
      evaluated: { cls: 'live', label: <><CheckCircle size={14} className="inline-icon" /> Evaluated</> },
      reviewed: { cls: 'live', label: <><Search size={14} className="inline-icon" /> Reviewed</> },
    };
    const s = map[status] || map.draft;
    return <span className={`header-badge ${s.cls}`}>{s.label}</span>;
  };

  const tenderColumns = [
    { key: 'name', label: 'Tender Name' },
    { key: 'authority', label: 'Authority' },
    { key: 'estimated_value', label: 'Value' },
    { key: 'deadline', label: 'Deadline' },
    { key: 'tender_type', label: 'Type' },
    { key: 'source', label: 'Source', render: (v) => (
      <span className={`header-badge ${v === 'MOCK' || v === 'SANDBOX' ? 'mock' : 'live'}`}>{v === 'MOCK' ? 'SANDBOX' : v}</span>
    )},
  ];

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner" style={{ margin: '0 auto' }}></div>
        <p style={{ marginTop: 16 }}>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            InferX Tender Evaluation System — Overview
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNewProject(true)}>
          + New Tender Project
        </button>
      </div>

      {/* New Project Dialog */}
      {showNewProject && (
        <div className="card" style={{ marginBottom: 24, border: '2px solid var(--accent)' }}>
          <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ClipboardList size={20} /> Create New Tender Project
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              placeholder="Tender name (e.g., CRPF Solar Panel Supply 2026)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              autoFocus
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleCreateProject} disabled={!newProjectName.trim()}>
              Create
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowNewProject(false); setNewProjectName(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Auth Modal for Deletion */}
      {showAuthModal && (
        <div className="card" style={{ marginBottom: 24, border: '2px solid var(--fail)', background: '#fff1f2' }}>
          <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--fail)' }}>
            <Trash2 size={20} /> Authorize Deletion
          </h3>
          <p style={{ marginBottom: 12 }}>
            Please authenticate to delete project: <strong>{projectToDelete?.name}</strong>
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="form-input"
              type="email"
              placeholder="Firebase Email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              style={{ flex: 1, minWidth: '200px' }}
            />
            <input
              className="form-input"
              type="password"
              placeholder="Firebase Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmDelete()}
              style={{ flex: 1, minWidth: '200px' }}
            />
            <button className="btn btn-primary" style={{ background: 'var(--fail)', borderColor: 'var(--fail)' }} onClick={confirmDelete}>
              Confirm Delete
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowAuthModal(false); setProjectToDelete(null); }}>
              Cancel
            </button>
          </div>
          {authError && <div style={{ color: 'var(--fail)', marginTop: 8, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}><XCircle size={14} /> {authError}</div>}
        </div>
      )}

      {/* Summary Cards */}
      <div className="card-grid">
        <div className="stat-card">
          <div className="stat-value">{projects.length}</div>
          <div className="stat-label">My Projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{tenders.length}</div>
          <div className="stat-label">Sandbox Tenders</div>
        </div>
        <div className="stat-card pass">
          <div className="stat-value">{projects.filter(p => p.status === 'evaluated').length}</div>
          <div className="stat-label">Evaluated</div>
        </div>
        <div className="stat-card review">
          <div className="stat-value">{projects.filter(p => p.status === 'draft' || p.status === 'uploaded').length}</div>
          <div className="stat-label">Pending</div>
        </div>
      </div>

      {/* My Projects */}
      {projects.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderKanban size={20} /> My Tender Projects
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              1 Tender = 1 Project
            </span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tender Name</th>
                <th>Status</th>
                <th>Bidders</th>
                <th>Documents</th>
                <th>Created</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} style={{ background: p.id === selectedProjectId ? 'var(--accent-light)' : undefined }}>
                  <td><strong>{p.name}</strong></td>
                  <td>{statusBadge(p.status)}</td>
                  <td>{p.bidders.length}</td>
                  <td>{p.tenderDocuments.length} tender, {p.bidders.reduce((s, b) => s + b.documents.length, 0)} bidder</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => handleOpenProject(p)}>
                        Open
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRequestDelete(p); }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sandbox Tenders */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ClipboardList size={20} /> Sandbox Tenders
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            UBID-based sandbox data
          </span>
        </div>
        <DataTable columns={tenderColumns} data={tenders} />
      </div>
    </div>
  );
}
