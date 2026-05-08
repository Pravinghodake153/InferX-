import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';
const rawURL = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL : '';

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Sandbox ──
export const SandboxAPI = {
  getTenders: () => api.get('/sandbox/tenders'),
  getTender: (ubid) => api.post('/sandbox/tender', { ubid }),
  getBidder: (ubid) => api.post('/sandbox/bidder', { ubid }),
  getBiddersForTender: (tenderUbid) => api.get(`/sandbox/bidders/${tenderUbid}`),
  getBidders: () => api.get('/sandbox/bidders'),
};

// ── Pipeline ──
export const PipelineAPI = {
  run: (body) => api.post('/pipeline/run', body, { timeout: 300000 }),
  extract: (formData) => api.post('/pipeline/extract', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000, // 5 min timeout for HF cold starts
  }),
  extractStatus: (jobId) => api.get(`/pipeline/extract/status/${jobId}`, { timeout: 15000 }),
  stopExtract: (jobId) => api.post(`/pipeline/extract/stop/${jobId}`),
  status: (projectId) => api.get(`/pipeline/status/${projectId}`),
};

// ── Tender Analysis (Decoupled Architecture) ──
export const TenderAPI = {
  analyze: (body) => api.post('/tender/analyze', body, { timeout: 120000 }),
};

// ── Evaluation ──
export const EvaluationAPI = {
  run: (formData) => axios.post(`${rawURL}/evaluate`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }),
  get: (inputHash) => api.get(`/evaluation/${inputHash}`),
};

// ── PII ──
export const PIIAPI = {
  reveal: (body) => api.post('/pii/reveal', body),
  mapping: (sessionId = 'default') => api.get(`/pii/mapping?session_id=${sessionId}`),
  mappingFull: (body) => api.post('/pii/mapping/full', body),
};

// ── Variance ──
export const VarianceAPI = {
  list: () => api.get('/variance/list'),
  resolve: (body) => api.post('/variance/resolve', body),
};

// ── Corrections ──
export const CorrectionAPI = {
  correctBefore: (body) => api.post('/correction/before', body),
  override: (body) => api.post('/correction/override', body),
  reeval: (body) => api.post('/correction/reeval', body),
  getHistory: (inputHash) => api.get(`/correction/${inputHash}`),
};

// ── Audit ──
export const AuditAPI = {
  getLogs: (params = {}) => api.get('/audit/logs', { params }),
  verifyChain: () => api.get('/audit/verify'),
};

// ── Export ──
export const ExportAPI = {
  pdf: (data) => api.post('/export/pdf', data, { responseType: 'blob' }),
  excel: (data) => api.post('/export/excel', data, { responseType: 'blob' }),
  audit: (data) => api.post('/export/audit', data, { responseType: 'blob' }),
  consolidated: (data) => api.post('/export/consolidated', data, { responseType: 'blob' }),
};

// ── Consolidated ──
export const ConsolidatedAPI = {
  evaluate: (body, options = {}) => api.post('/evaluate/consolidated', body, { timeout: 300000, ...options }),
};

// ── Settings ──
export const SettingsAPI = {
  get: () => api.get('/settings'),
  update: (body) => api.post('/settings', body),
};

// ── Projects (MongoDB-backed) ──
export const ProjectAPI = {
  list: () => api.get('/projects'),
  get: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  // Extraction data (heavy)
  saveExtraction: (id, data) => api.post(`/projects/${id}/extraction`, data, { timeout: 120000 }),
  getExtraction: (id) => api.get(`/projects/${id}/extraction`, { timeout: 30000 }),
  // Evaluation versions
  saveEvaluation: (id, data) => api.post(`/projects/${id}/evaluation`, data, { timeout: 60000 }),
  getEvaluations: (id) => api.get(`/projects/${id}/evaluations`),
  // Consolidated report
  saveConsolidated: (id, data) => api.post(`/projects/${id}/consolidated`, data, { timeout: 60000 }),
  getConsolidated: (id) => api.get(`/projects/${id}/consolidated`),
};

// ── DB Health ──
export const DBAPI = {
  health: () => api.get('/db/health'),
};

// ── Chatbot ──
export const ChatAPI = {
  sendMessage: (message, context) => api.post('/chat', { message, context }).then(res => res.data),
};

export default api;
