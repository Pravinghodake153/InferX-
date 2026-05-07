import { useState, useCallback, useEffect, useRef } from 'react';
import { AppContext } from './appContextValue';
import { db } from '../services/firebase';
import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';

// ── localStorage keys ──
const LS_PROJECTS = 'inferx_projects';
const LS_SELECTED_ID = 'inferx_selected_project_id';
const LS_SIDEBAR = 'inferx_sidebar_collapsed';
const LS_LAST_ROUTE = 'inferx_last_route';
const LS_DELETED_IDS = 'inferx_deleted_ids';
const LS_ACTIVE_PROCESS = 'inferx_active_process';

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

function loadDeletedIds() {
  try {
    const raw = localStorage.getItem(LS_DELETED_IDS);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveDeletedIds(ids) {
  try {
    localStorage.setItem(LS_DELETED_IDS, JSON.stringify([...ids]));
  } catch { /* ignore */ }
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

  // ── Deleted IDs tracker (prevents Firestore from restoring deleted projects) ──
  const deletedIdsRef = useRef(loadDeletedIds());

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

  // ── Active Process State (persisted for refresh resilience) ──
  const [activeProcess, setActiveProcessState] = useState(() => loadActiveProcess());

  // Hydration is handled in the lazy initializer above, so always true
  const hydrated = true;

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

  // ── Persist projects to localStorage and Firestore on every change ──
  useEffect(() => {
    if (!hydrated) return;
    try {
      const serialized = projects.map(serializeProject);
      localStorage.setItem(LS_PROJECTS, JSON.stringify(serialized));
      
      // Also sync to Firestore (only non-deleted projects)
      const currentDeletedIds = deletedIdsRef.current;
      serialized.forEach(async (p) => {
        if (currentDeletedIds.has(p.id)) return; // Don't re-upload deleted projects
        try {
          await setDoc(doc(db, 'projects', p.id), p);
        } catch (e) {
          console.warn('Firestore sync failed for project:', p.id, e);
        }
      });
    } catch (e) {
      console.warn('Failed to save projects:', e);
    }
  }, [projects, hydrated]);

  // ── Fetch from Firestore on initial load ──
  useEffect(() => {
    const fetchRemote = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'projects'));
        if (!snapshot.empty) {
          const fetched = snapshot.docs.map(d => d.data());
          // Filter out any projects that were deleted locally
          const currentDeletedIds = deletedIdsRef.current;
          const filtered = fetched.filter(p => !currentDeletedIds.has(p.id));
          // Sort by createdAt desc
          filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setProjects(filtered);
        }
      } catch (e) {
        console.warn('Failed to fetch projects from Firestore:', e);
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
    // Remove from deleted set if re-creating with same ID (unlikely but safe)
    deletedIdsRef.current.delete(id);
    saveDeletedIds(deletedIdsRef.current);

    setProjects(prev => [newProject, ...prev]);
    setSelectedProjectId(id);
    return id;
  }, []);

  const updateProject = useCallback((id, updates) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProject = useCallback(async (id) => {
    // 1. Add to deleted set immediately (prevents Firestore from restoring it)
    deletedIdsRef.current.add(id);
    saveDeletedIds(deletedIdsRef.current);

    // 2. Remove from local state + localStorage immediately
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);

    // 3. Delete from Firestore
    try {
      await deleteDoc(doc(db, 'projects', id));
      // After successful Firestore deletion, we can safely clear from deleted set
      // (to prevent the set from growing forever)
      setTimeout(() => {
        deletedIdsRef.current.delete(id);
        saveDeletedIds(deletedIdsRef.current);
      }, 5000); // 5s grace period
    } catch (e) {
      console.warn('Failed to delete project from Firestore:', e);
      // Keep in deleted set so it won't be restored on next fetch
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
