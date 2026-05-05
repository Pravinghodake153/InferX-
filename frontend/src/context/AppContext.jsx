import { useState, useCallback, useEffect } from 'react';
import { AppContext } from './appContextValue';

// ── localStorage keys ──
const LS_PROJECTS = 'inferx_projects';
const LS_SELECTED_ID = 'inferx_selected_project_id';
const LS_SIDEBAR = 'inferx_sidebar_collapsed';
const LS_LAST_ROUTE = 'inferx_last_route';

/**
 * Serialize project for localStorage.
 * Strips non-serializable data (File objects) but keeps everything else.
 */
function serializeProject(project) {
  return {
    ...project,
    // Strip File objects from tender docs (keep metadata)
    tenderDocuments: (project.tenderDocuments || []).map(d => ({
      ...d,
      file: null, // File can't be serialized
    })),
    // Strip File objects from bidder docs
    bidders: (project.bidders || []).map(b => ({
      ...b,
      documents: (b.documents || []).map(d => ({
        ...d,
        file: null,
      })),
    })),
  };
}

/**
 * Load projects from localStorage.
 * Returns [] if nothing stored or parse fails.
 */
function loadProjects() {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to load projects from localStorage:', e);
    return [];
  }
}

function loadSelectedId() {
  try {
    return localStorage.getItem(LS_SELECTED_ID) || null;
  } catch {
    return null;
  }
}

function loadSidebar() {
  try {
    return localStorage.getItem(LS_SIDEBAR) === 'true';
  } catch {
    return false;
  }
}

/**
 * Global application state — project-scoped, sidebar, and evaluation data.
 *
 * Rules:
 *  - 1 Tender = 1 Project
 *  - Bidders are scoped to selected_project_id
 *  - Evaluation data is project-scoped
 *  - Sidebar collapse is global UI state
 *  - ALL state persisted to localStorage on every change
 *  - State rehydrated from localStorage on app start
 */
export function AppProvider({ children }) {
  // ── Sidebar (persisted) ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebar());
  const toggleSidebar = useCallback(() => setSidebarCollapsed(c => !c), []);

  // ── Projects (persisted to localStorage) ──
  const [projects, setProjects] = useState(() => loadProjects());
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    const id = loadSelectedId();
    // Validate that selected ID still exists during initialization
    if (id) {
      const stored = loadProjects();
      if (!stored.find(p => p.id === id)) {
        localStorage.removeItem(LS_SELECTED_ID);
        return null;
      }
    }
    return id;
  });

  // Hydration is handled in the lazy initializer above, so always true
  const hydrated = true;

  // ── Persist projects to localStorage on every change ──
  useEffect(() => {
    if (!hydrated) return;
    try {
      const serialized = projects.map(serializeProject);
      localStorage.setItem(LS_PROJECTS, JSON.stringify(serialized));
    } catch (e) {
      console.warn('Failed to save projects:', e);
    }
  }, [projects, hydrated]);

  // ── Persist selectedProjectId ──
  useEffect(() => {
    if (!hydrated) return;
    if (selectedProjectId) {
      localStorage.setItem(LS_SELECTED_ID, selectedProjectId);
    } else {
      localStorage.removeItem(LS_SELECTED_ID);
    }
  }, [selectedProjectId, hydrated]);

  // ── Persist sidebar ──
  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // ── Save last route ──
  const setLastRoute = useCallback((route) => {
    try { localStorage.setItem(LS_LAST_ROUTE, route); } catch { /* localStorage unavailable */ }
  }, []);
  const getLastRoute = useCallback(() => {
    try { return localStorage.getItem(LS_LAST_ROUTE) || '/'; } catch { return '/'; /* localStorage unavailable */ }
  }, []);

  // ── Project CRUD ──
  const addProject = useCallback((project) => {
    const id = `proj-${Date.now()}`;
    const newProject = {
      id,
      name: project.name || 'Untitled Tender',
      status: 'draft',      // draft | uploaded | extracted | reviewed | evaluated
      createdAt: new Date().toISOString(),
      // Tender documents (multi-doc support)
      tenderDocuments: [],   // [{ id, type: 'MAIN'|'ADDENDUM', file, name }]
      // Bidders with multi-doc support
      bidders: [],           // [{ id, name, documents: [{ id, doc_type, file, name }] }]
      // Pipeline state
      extractionStatus: null,   // null | 'running' | 'complete' | 'failed'
      extractionError: null,
      extractedText: null,
      extractedBidderData: [],  // [{ bidder_id, extracted_text, fields: {} }]
      // Criteria (from extraction)
      extractedCriteria: [],
      criteriaLocked: false,
      // Version Control System (Evaluation)
      versions: [], // [{ version_id, status: 'SNAPSHOT'|'ACTIVE'|'FINAL', input_data, output, created_at }]
      final_version_id: null,
      inputHash: null,
      provider: 'openrouter',
      // Review & Cleaning State
      reviewData: {
        corrections: {},
        masks: {},
        links: {},
        irrelevant: {}
      },
    };
    setProjects(prev => [newProject, ...prev]);
    setSelectedProjectId(id);
    return id;
  }, []);

  const updateProject = useCallback((id, updates) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProject = useCallback((id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);
  }, [selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;

  // ── Tender Documents (multi-doc) ──
  const addTenderDocument = useCallback((type, file) => {
    if (!selectedProjectId) return;
    const doc = {
      id: `tdoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,     // MAIN | ADDENDUM
      file,
      name: file.name,
      size: file.size,
      addedAt: new Date().toISOString(),
    };
    setProjects(prev => prev.map(p =>
      p.id === selectedProjectId
        ? { ...p, tenderDocuments: [...p.tenderDocuments, doc] }
        : p
    ));
    return doc.id;
  }, [selectedProjectId]);

  const removeTenderDocument = useCallback((docId) => {
    if (!selectedProjectId) return;
    setProjects(prev => prev.map(p =>
      p.id === selectedProjectId
        ? { ...p, tenderDocuments: p.tenderDocuments.filter(d => d.id !== docId) }
        : p
    ));
  }, [selectedProjectId]);

  // ── Bidders (multi-doc per bidder) ──
  const addBidder = useCallback((name) => {
    if (!selectedProjectId) return;
    const bidder = {
      id: `bid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name || 'Unnamed Bidder',
      documents: [],    // [{ id, doc_type, file, name }]
      addedAt: new Date().toISOString(),
    };
    setProjects(prev => prev.map(p =>
      p.id === selectedProjectId
        ? { ...p, bidders: [...p.bidders, bidder] }
        : p
    ));
    return bidder.id;
  }, [selectedProjectId]);

  const addBidderDocument = useCallback((bidderId, type, file) => {
    if (!selectedProjectId) return;
    const doc = {
      id: `bdoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      doc_type: type || 'Other',
      file,
      name: file.name,
      size: file.size,
      addedAt: new Date().toISOString(),
    };
    setProjects(prev => prev.map(p =>
      p.id === selectedProjectId
        ? {
            ...p,
            bidders: p.bidders.map(b =>
              b.id === bidderId
                ? { ...b, documents: [...b.documents, doc] }
                : b
            ),
          }
        : p
    ));
    return doc.id;
  }, [selectedProjectId]);

  const removeBidderDocument = useCallback((bidderId, docId) => {
    if (!selectedProjectId) return;
    setProjects(prev => prev.map(p =>
      p.id === selectedProjectId
        ? {
            ...p,
            bidders: p.bidders.map(b =>
              b.id === bidderId
                ? { ...b, documents: b.documents.filter(d => d.id !== docId) }
                : b
            ),
          }
        : p
    ));
  }, [selectedProjectId]);

  const value = {
    // Hydration
    hydrated,
    // Sidebar
    sidebarCollapsed,
    toggleSidebar,
    // Projects
    projects,
    selectedProjectId,
    selectedProject,
    setSelectedProjectId,
    addProject,
    updateProject,
    deleteProject,
    // Tender docs
    addTenderDocument,
    removeTenderDocument,
    // Bidders
    addBidder,
    addBidderDocument,
    removeBidderDocument,
    // Route persistence
    setLastRoute,
    getLastRoute,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
