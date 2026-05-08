import { useState, useCallback, useEffect, useRef } from 'react';
import { AppContext } from './appContextValue';
import { ProjectAPI } from '../services/api';

// ── localStorage keys ──
const LS_PROJECTS = 'inferx_projects';
const LS_SELECTED_ID = 'inferx_selected_project_id';
const LS_SIDEBAR = 'inferx_sidebar_collapsed';
const LS_LAST_ROUTE = 'inferx_last_route';
const LS_ACTIVE_PROCESS = 'inferx_active_process';

/**
 * Serialize project for localStorage cache.
 * Strips non-serializable data (File objects) and heavy fields to stay under 5MB localStorage limit.
 */
function serializeForCache(project) {
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
    // Strip heavy text (saved in MongoDB separately)
    extractedText: null,
    extractedBidderData: [],
    extractedContent: null,
    // Strip heavy version payloads (saved in MongoDB separately)
    versions: (project.versions || []).map(v => ({
      version_id: v.version_id,
      status: v.status,
      bidder_id: v.bidder_id,
      bidder_name: v.bidder_name,
      created_at: v.created_at,
    })),
    // Strip consolidated report (saved in MongoDB separately)
    consolidatedReport: null,
  };
}

/**
 * Load projects from localStorage (fast cache for instant UI render).
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

function loadActiveProcess() {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_PROCESS);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Global application state — project-scoped, sidebar, and evaluation data.
 *
 * Architecture:
 *  - MongoDB (via backend API) is the source of truth for all data
 *  - localStorage is a fast cache for instant UI rendering (lightweight metadata only)
 *  - Firebase Storage is kept for file uploads (PDFs, images) only
 *  - Heavy data (extracted text, evaluation payloads) is stored in MongoDB collections
 */
export function AppProvider({ children }) {
  // ── Sidebar (persisted) ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebar());
  const toggleSidebar = useCallback(() => setSidebarCollapsed(c => !c), []);

  // ── Projects (persisted to localStorage as cache, MongoDB as source of truth) ──
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

  // ── Active Process State (persisted for refresh resilience) ──
  const [activeProcess, setActiveProcessState] = useState(() => loadActiveProcess());

  // ── Debounced MongoDB sync ref ──
  const syncTimeoutRef = useRef(null);

  // ── Process management helpers ──
  const startProcess = useCallback((type, meta = {}) => {
    const process = {
      type, // 'extraction' | 'evaluation' | 'consolidated'
      startedAt: new Date().toISOString(),
      progress: 'Starting...',
      progressPct: 0,
      ...meta,
    };
    setActiveProcessState(process);
    try { localStorage.setItem(LS_ACTIVE_PROCESS, JSON.stringify(process)); } catch { /* ignore */ }
  }, []);

  const updateProcess = useCallback((updates) => {
    setActiveProcessState(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      try { localStorage.setItem(LS_ACTIVE_PROCESS, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const clearProcess = useCallback(() => {
    setActiveProcessState(null);
    try { localStorage.removeItem(LS_ACTIVE_PROCESS); } catch { /* ignore */ }
  }, []);

  // ── Persist projects to localStorage cache + MongoDB on every change ──
  useEffect(() => {
    if (!hydrated) return;

    // 1. Save lightweight cache to localStorage (instant, no size issues)
    const cached = projects.map(serializeForCache);
    try {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(cached));
    } catch (e) {
      console.warn('Failed to cache projects to localStorage:', e);
    }

    // 2. Debounced sync to MongoDB (via backend API)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      projects.forEach(async (p) => {
        try {
          await ProjectAPI.create(p);
        } catch (e) {
          // Only warn, don't block — MongoDB might be temporarily unavailable
          if (e?.response?.status !== 400) {
            console.warn('MongoDB sync failed for project:', p.id, e?.message || e);
          }
        }
      });
    }, 1000); // 1 second debounce to avoid spamming the backend
  }, [projects, hydrated]);

  // ── Fetch from MongoDB on initial load (source of truth) ──
  useEffect(() => {
    const fetchRemote = async () => {
      try {
        const res = await ProjectAPI.list();
        const fetched = res.data?.projects || [];
        if (fetched.length > 0) {
          // Sort by createdAt desc
          fetched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setProjects(prev => {
            // Merge: remote projects take priority, keep local-only projects
            const remoteIds = new Set(fetched.map(p => p.id));
            const localOnly = prev.filter(p => !remoteIds.has(p.id));
            return [...fetched, ...localOnly];
          });
        }
      } catch (e) {
        console.warn('Failed to fetch projects from MongoDB:', e?.message || e);
        // Fall back to localStorage (already loaded)
      }
    };
    fetchRemote();
  }, []);

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

  const deleteProject = useCallback(async (id) => {
    // 1. Remove from local state + localStorage immediately
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);

    // 2. Delete from MongoDB
    try {
      await ProjectAPI.delete(id);
    } catch (e) {
      console.warn('Failed to delete project from MongoDB:', e);
    }
  }, [selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;

  // ── Tender Documents (multi-doc) ──
  const addTenderDocument = useCallback((type, file, url = null) => {
    if (!selectedProjectId) return;
    const doc = {
      id: `tdoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,     // MAIN | ADDENDUM
      file,
      url,      // Firebase Storage URL
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

  const addBidderDocument = useCallback((bidderId, type, file, url = null) => {
    if (!selectedProjectId) return;
    const doc = {
      id: `bdoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      doc_type: type || 'Other',
      file,
      url,      // Firebase Storage URL
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
    // Process tracking
    activeProcess,
    startProcess,
    updateProcess,
    clearProcess,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
