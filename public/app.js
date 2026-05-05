/**
 * InferX — Frontend Application Logic
 * Handles: file uploads, API calls, progress animation, result rendering,
 *          review overrides, explainability panel, and error handling.
 */

/* ═══════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════ */
let pipelineData = null;

/* ═══════════════════════════════════════════
   FILE UPLOAD HANDLING
   ═══════════════════════════════════════════ */
const tenderInput = document.getElementById('tenderFile');
const bidderInput = document.getElementById('bidderFile');

tenderInput.addEventListener('change', () => handleFileSelect(tenderInput, 'tenderCard', 'tenderFileName'));
bidderInput.addEventListener('change', () => handleFileSelect(bidderInput, 'bidderCard', 'bidderFileName'));

function handleFileSelect(input, cardId, displayId) {
    const card = document.getElementById(cardId);
    const display = document.getElementById(displayId);
    if (input.files.length > 0) {
        card.classList.add('has-file');
        display.classList.add('visible');
        display.querySelector('span').textContent = input.files[0].name;
    } else {
        card.classList.remove('has-file');
        display.classList.remove('visible');
    }
    checkReady();
}

function checkReady() {
    const btn = document.getElementById('btnEvaluate');
    const extractBtn = document.getElementById('btnExtract');
    const ready = (tenderInput.files.length > 0 && bidderInput.files.length > 0);
    btn.disabled = !ready;
    if (extractBtn) extractBtn.disabled = !ready;
}

/* ═══════════════════════════════════════════
   DRAG AND DROP
   ═══════════════════════════════════════════ */
['tenderDropZone', 'bidderDropZone'].forEach((zoneId, i) => {
    const zone = document.getElementById(zoneId);
    const input = i === 0 ? tenderInput : bidderInput;
    const cardId = i === 0 ? 'tenderCard' : 'bidderCard';
    const displayId = i === 0 ? 'tenderFileName' : 'bidderFileName';

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent-blue)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = '';
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            handleFileSelect(input, cardId, displayId);
        }
    });
});

/* ═══════════════════════════════════════════
   RUN EVALUATION (API CALL)
   ═══════════════════════════════════════════ */
async function runEvaluation() {
    const btn = document.getElementById('btnEvaluate');
    const extractBtn = document.getElementById('btnExtract');
    btn.disabled = true;
    if (extractBtn) extractBtn.disabled = true;
    btn.textContent = '⏳ Processing...';

    // Hide any previous error panel
    hideErrorPanel();

    const progressContainer = document.getElementById('progressContainer');
    progressContainer.classList.add('active');
    document.getElementById('tabsContainer').classList.remove('active');

    // Start progress animation
    animateProgress();

    const formData = new FormData();
    formData.append('tender', tenderInput.files[0]);
    formData.append('bidder', bidderInput.files[0]);

    try {
        const res = await fetch('/evaluate', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            let errMsg = 'Server error';
            try { const err = await res.json(); errMsg = err.detail || errMsg; } catch (e) { }
            throw new Error(errMsg);
        }

        pipelineData = await res.json();

        // Check for pipeline-level errors with detailed info
        if (pipelineData.status === 'error') {
            finishProgress();
            progressContainer.classList.remove('active');
            showErrorPanel(pipelineData);
            return;
        }

        finishProgress();

        // Short delay before rendering results for visual impact
        setTimeout(() => {
            renderResults(pipelineData);
            if (window.saveToFirestore) {
                window.saveToFirestore(pipelineData);
            }
            progressContainer.classList.remove('active');
            document.getElementById('tabsContainer').classList.add('active');
        }, 600);

    } catch (err) {
        finishProgress();
        progressContainer.classList.remove('active');
        showErrorPanel({
            errors: [err.message || 'An unexpected error occurred.'],
            error_details: [],
            provider: currentProvider
        });
    } finally {
        btn.disabled = false;
        btn.textContent = '▶ Run AI Evaluation';
        checkReady();
    }
}

async function runExtractionOnly() {
    const extractBtn = document.getElementById('btnExtract');
    const evalBtn = document.getElementById('btnEvaluate');
    extractBtn.disabled = true;
    evalBtn.disabled = true;
    extractBtn.textContent = '⏳ Extracting...';

    hideErrorPanel();

    const progressContainer = document.getElementById('progressContainer');
    progressContainer.classList.add('active');
    document.getElementById('tabsContainer').classList.remove('active');
    document.getElementById('progressLabel').textContent = '🧾 Running raw document extraction (no AI calls)...';

    const formData = new FormData();
    formData.append('tender', tenderInput.files[0]);
    formData.append('bidder', bidderInput.files[0]);

    try {
        const res = await fetch('/extract-debug', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            let errMsg = 'Server error';
            try { const err = await res.json(); errMsg = err.detail || errMsg; } catch (e) { }
            throw new Error(errMsg);
        }

        pipelineData = await res.json();
        renderExtractionOnly(pipelineData);
        if (window.saveToFirestore) {
            window.saveToFirestore(pipelineData);
        }
        progressContainer.classList.remove('active');
        document.getElementById('tabsContainer').classList.add('active');
    } catch (err) {
        progressContainer.classList.remove('active');
        showErrorPanel({
            errors: [err.message || 'Extraction failed.'],
            error_details: [],
            provider: currentProvider
        });
    } finally {
        extractBtn.textContent = '🧾 Run Document Extraction Only';
        checkReady();
    }
}

function renderExtractionOnly(data) {
    renderResults(data);
    const banner = document.getElementById('verdictBanner');
    banner.className = 'verdict-banner';
    switchTab('layoutdebug');
}

/* ═══════════════════════════════════════════
   PROGRESS ANIMATION
   ═══════════════════════════════════════════ */
function animateProgress() {
    const steps = ['prog-pii', 'prog-ingest', 'prog-bidder', 'prog-fieldmap', 'prog-eval', 'prog-verify', 'prog-rules'];
    const providerLabel = currentProvider === 'openai' ? 'OpenAI' : (currentProvider === 'openrouter' ? 'OpenRouter' : 'Gemini AI');
    const labels = [
        '🔒 Step 0/7 — Masking PII identifiers...',
        `🧠 Step 1/7 — Analyzing tender criteria with ${providerLabel}...`,
        `📊 Step 2/7 — Parsing bidder evidence with ${providerLabel}...`,
        `🔗 Step 3/7 — Running semantic field mapping...`,
        `⚖️ Step 4/7 — LLM-based final evaluation with ${providerLabel}...`,
        '✔️ Step 5/7 — Verifying GSTIN / PAN identifiers...',
        '🚨 Step 6/7 — Running vigilance & error detection...'
    ];
    let current = 0;

    function next() {
        if (current >= steps.length) return;
        const el = document.getElementById(steps[current]);
        el.classList.add('active');
        document.getElementById('progressLabel').textContent = labels[current];
        current++;
    }

    next();
    window._progressInterval = setInterval(() => {
        const prevIdx = current - 1;
        if (prevIdx >= 0) {
            const prev = document.getElementById(steps[prevIdx]);
            prev.classList.remove('active');
            prev.classList.add('done');
        }
        if (current < steps.length) {
            next();
        } else {
            clearInterval(window._progressInterval);
        }
    }, 2500);
}

function finishProgress() {
    clearInterval(window._progressInterval);
    ['prog-pii', 'prog-ingest', 'prog-bidder', 'prog-fieldmap', 'prog-eval', 'prog-verify', 'prog-rules'].forEach(id => {
        const el = document.getElementById(id);
        el.classList.remove('active');
        el.classList.add('done');
    });
    document.getElementById('progressLabel').textContent = '✅ Evaluation complete — 7 pipeline steps finished.';
}

/* ═══════════════════════════════════════════
   RENDER RESULTS
   ═══════════════════════════════════════════ */
let lastEvalData = null; // Store for export functions

function renderResults(data) {
    lastEvalData = data; // Store for exports
    const evals = data.evaluation || [];
    const criteria = data.criteria || [];
    const evidence = data.evidence || [];
    const issues = data.issues || [];
    const fieldMappings = data.field_mappings || [];
    const pipelineSteps = data.pipeline_steps || [];
    const finalEval = data.final_evaluation || [];
    const verification = data.verification || [];
    const piiMasking = data.pii_masking || { mappings: [], masked_fields_count: 0 };

    const passCount = evals.filter(e => e.result === 'PASS').length;
    const failCount = evals.filter(e => e.result === 'FAIL').length;
    const reviewCount = evals.filter(e => e.result === 'REVIEW').length;

    // Summary cards
    document.getElementById('scTotal').textContent = evals.length;
    document.getElementById('scPass').textContent = passCount;
    document.getElementById('scFail').textContent = failCount;
    document.getElementById('scReview').textContent = reviewCount;

    // Tab badges
    document.getElementById('badgeResults').textContent = evals.length;
    document.getElementById('badgeReview').textContent = reviewCount;
    document.getElementById('badgeIssues').textContent = issues.length;
    const badgeFieldMap = document.getElementById('badgeFieldMap');
    if (badgeFieldMap) badgeFieldMap.textContent = fieldMappings.length;
    const badgeFinalEval = document.getElementById('badgeFinalEval');
    if (badgeFinalEval) badgeFinalEval.textContent = finalEval.length;
    const badgePII = document.getElementById('badgePII');
    if (badgePII) badgePII.textContent = piiMasking.masked_fields_count;
    const badgeVerification = document.getElementById('badgeVerification');
    if (badgeVerification) badgeVerification.textContent = verification.length;

    renderResultsTable(evals);
    renderReviewTab(evals, criteria, evidence);
    renderExplainTab(evals, criteria, evidence);
    renderFieldMappingTab(fieldMappings, criteria);
    renderFinalEvalTab(finalEval);
    renderPIITab(piiMasking);
    renderVerificationTab(verification);
    renderIssuesTab(issues);
    renderPipelineStepsFooter(pipelineSteps);
    renderVerdictBanner(passCount, failCount, reviewCount);
    populateAuditHeader(data);
    renderDocumentView(data);
    renderLayoutDebug(data);
    renderImageGallery(data);
    renderExtractionView(data);
}

/* ═══════════════════════════════════════════
   AUDIT HEADER
   ═══════════════════════════════════════════ */
function populateAuditHeader(data) {
    const now = new Date();
    const evalId = 'EVAL-' + Math.random().toString(36).substr(2, 8).toUpperCase();
    const timestamp = now.toISOString().replace('T', ' ').substr(0, 19);
    const provider = (data.provider || 'unknown').toUpperCase();

    // Generate SHA-256 hash client-side
    const canonical = JSON.stringify(data, Object.keys(data).sort());
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)).then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        const auditEvalId = document.getElementById('auditEvalId');
        const auditTimestamp = document.getElementById('auditTimestamp');
        const auditModel = document.getElementById('auditModel');
        const auditHash = document.getElementById('auditHash');

        if (auditEvalId) auditEvalId.textContent = evalId;
        if (auditTimestamp) auditTimestamp.textContent = timestamp;
        if (auditModel) auditModel.textContent = `InferX v2.0 • ${provider}`;
        if (auditHash) auditHash.textContent = hashHex.substring(0, 24) + '...';

        // Store for exports
        if (lastEvalData) {
            lastEvalData._audit = { evaluation_id: evalId, timestamp, sha256_hash: hashHex };
        }
    });
}

/* ═══════════════════════════════════════════
   EXPORT FUNCTIONS
   ═══════════════════════════════════════════ */
async function downloadPDF() {
    if (!lastEvalData) { alert('No evaluation data. Run AI evaluation first.'); return; }
    const btn = document.getElementById('btnExportPDF');
    btn.disabled = true;
    btn.querySelector('.export-label').textContent = 'Generating...';
    showToast('📄 PDF Report Generation Started...');
    try {
        const resp = await fetch('/api/export/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastEvalData)
        });
        if (!resp.ok) throw new Error(await resp.text());
        
        let filename = `InferX_Report_${lastEvalData._audit ? lastEvalData._audit.evaluation_id : 'UNKNOWN'}.pdf`;
        const disposition = resp.headers.get('Content-Disposition');
        if (disposition && disposition.includes('filename=')) {
            filename = disposition.split('filename=')[1].replace(/"/g, '');
        }
        
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('PDF export failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.querySelector('.export-label').textContent = 'PDF Report';
    }
}

async function downloadExcel() {
    if (!lastEvalData) { alert('No evaluation data. Run AI evaluation first.'); return; }
    const btn = document.getElementById('btnExportExcel');
    btn.disabled = true;
    btn.querySelector('.export-label').textContent = 'Generating...';
    showToast('📊 Excel Matrix Generation Started...');
    try {
        const resp = await fetch('/api/export/excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastEvalData)
        });
        if (!resp.ok) throw new Error(await resp.text());
        
        let filename = `InferX_Matrix_${lastEvalData._audit ? lastEvalData._audit.evaluation_id : 'UNKNOWN'}.xlsx`;
        const disposition = resp.headers.get('Content-Disposition');
        if (disposition && disposition.includes('filename=')) {
            filename = disposition.split('filename=')[1].replace(/"/g, '');
        }
        
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Excel export failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.querySelector('.export-label').textContent = 'Excel Matrix';
    }
}

async function downloadAudit() {
    if (!lastEvalData) { alert('No evaluation data. Run AI evaluation first.'); return; }
    const btn = document.getElementById('btnExportAudit');
    btn.disabled = true;
    btn.querySelector('.export-label').textContent = 'Generating...';
    showToast('🔐 Audit Log Generation Started...');
    try {
        const resp = await fetch('/api/export/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastEvalData)
        });
        if (!resp.ok) throw new Error(await resp.text());
        
        let filename = `InferX_Audit_${lastEvalData._audit ? lastEvalData._audit.evaluation_id : 'UNKNOWN'}.json`;
        const disposition = resp.headers.get('Content-Disposition');
        if (disposition && disposition.includes('filename=')) {
            filename = disposition.split('filename=')[1].replace(/"/g, '');
        }
        
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Audit export failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.querySelector('.export-label').textContent = 'Audit Log';
    }
}

/* ═══════════════════════════════════════════
   UX HELPERS
   ═══════════════════════════════════════════ */
function showToast(message) {
    let toast = document.getElementById('inferx-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'inferx-toast';
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 9999;
            background: var(--bg-card); color: var(--text-primary);
            border: 1px solid var(--accent-blue); border-radius: 8px;
            padding: 12px 20px; font-size: 0.9rem; font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: opacity 0.3s ease;
        `;
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 3000);
}

/* ═══════════════════════════════════════════
   LAYOUT DEBUG VIEW - RAW BLOCK TEXT
   ═══════════════════════════════════════════ */
let layoutDebugState = {
    currentDoc: 'tender',
    currentPage: 0,
    tenderPages: [],
    bidderPages: []
};

function renderLayoutDebug(data) {
    layoutDebugState.tenderPages = data.layout_debug?.tender || [];
    layoutDebugState.bidderPages = data.layout_debug?.bidder || [];
    layoutDebugState.currentDoc = 'tender';
    layoutDebugState.currentPage = 0;

    document.querySelectorAll('[data-layout-doc]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layoutDoc === 'tender');
    });
    updateLayoutDebugPage();
}

function switchLayoutDebugDoc(docType) {
    layoutDebugState.currentDoc = docType;
    layoutDebugState.currentPage = 0;
    document.querySelectorAll('[data-layout-doc]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layoutDoc === docType);
    });
    updateLayoutDebugPage();
}

function prevLayoutDebugPage() {
    if (layoutDebugState.currentPage > 0) {
        layoutDebugState.currentPage -= 1;
        updateLayoutDebugPage();
    }
}

function nextLayoutDebugPage() {
    const pages = layoutDebugState.currentDoc === 'tender'
        ? layoutDebugState.tenderPages
        : layoutDebugState.bidderPages;
    if (layoutDebugState.currentPage < pages.length - 1) {
        layoutDebugState.currentPage += 1;
        updateLayoutDebugPage();
    }
}

function updateLayoutDebugPage() {
    const pages = layoutDebugState.currentDoc === 'tender'
        ? layoutDebugState.tenderPages
        : layoutDebugState.bidderPages;
    const totalPages = pages.length || 1;
    const currentIndex = Math.min(layoutDebugState.currentPage, totalPages - 1);
    layoutDebugState.currentPage = Math.max(currentIndex, 0);

    const currentPage = pages[layoutDebugState.currentPage] || null;
    const pre = document.getElementById('layoutDebugPre');
    if (!pre) return;

    document.getElementById('layoutCurrentPage').textContent = String(layoutDebugState.currentPage + 1);
    document.getElementById('layoutTotalPages').textContent = String(totalPages);
    document.getElementById('layoutPrevBtn').disabled = layoutDebugState.currentPage === 0;
    document.getElementById('layoutNextBtn').disabled = layoutDebugState.currentPage >= totalPages - 1;

    if (!currentPage) {
        pre.textContent = 'No layout debug output available.';
        return;
    }

    pre.textContent = `===== PAGE ${currentPage.page || (layoutDebugState.currentPage + 1)} =====\n\n${currentPage.text || ''}`;
}

/* ═══════════════════════════════════════════
   EXTRACTION VIEW - TEXT/TABLE/IMAGE INSPECTOR
   ═══════════════════════════════════════════ */
let extractionViewState = {
    currentDoc: 'tender',
    currentPage: 0,
    tender: { pages: [], tables: [], images: [], context_text: '' },
    bidder: { pages: [], tables: [], images: [], context_text: '' }
};

function renderExtractionView(data) {
    extractionViewState.tender = data.extraction_view?.tender || { pages: [], tables: [], images: [], context_text: '' };
    extractionViewState.bidder = data.extraction_view?.bidder || { pages: [], tables: [], images: [], context_text: '' };
    extractionViewState.currentDoc = 'tender';
    extractionViewState.currentPage = 0;
    updateExtractionPage();
}

function switchExtractDoc(docType) {
    extractionViewState.currentDoc = docType;
    extractionViewState.currentPage = 0;
    document.querySelectorAll('.extract-doc-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.doc === docType);
    });
    updateExtractionPage();
}

function prevExtractPage() {
    if (extractionViewState.currentPage > 0) {
        extractionViewState.currentPage -= 1;
        updateExtractionPage();
    }
}

function nextExtractPage() {
    const pkg = extractionViewState.currentDoc === 'tender' ? extractionViewState.tender : extractionViewState.bidder;
    const pageCount = (pkg.pages || []).length;
    if (extractionViewState.currentPage < pageCount - 1) {
        extractionViewState.currentPage += 1;
        updateExtractionPage();
    }
}

function updateExtractionPage() {
    const pkg = extractionViewState.currentDoc === 'tender' ? extractionViewState.tender : extractionViewState.bidder;
    const pages = pkg.pages || [];
    const pageCount = pages.length || 1;
    const currentIndex = Math.min(extractionViewState.currentPage, pageCount - 1);
    extractionViewState.currentPage = Math.max(currentIndex, 0);

    const currentPage = pages[extractionViewState.currentPage] || null;
    const scannedCount = pages.filter(p => p.document_type === 'SCANNED').length;
    const digitalCount = pages.filter(p => p.document_type === 'DIGITAL').length;

    document.getElementById('extractCurrentPage').textContent = extractionViewState.currentPage + 1;
    document.getElementById('extractTotalPages').textContent = pageCount;
    document.getElementById('extractPrevBtn').disabled = extractionViewState.currentPage === 0;
    document.getElementById('extractNextBtn').disabled = extractionViewState.currentPage >= pageCount - 1;

    document.getElementById('extractSummary').innerHTML = `
        <div class="extract-stat">Pages: <strong>${pages.length}</strong></div>
        <div class="extract-stat">Digital: <strong>${digitalCount}</strong></div>
        <div class="extract-stat">Scanned: <strong>${scannedCount}</strong></div>
        <div class="extract-stat">Tables: <strong>${(pkg.tables || []).length}</strong></div>
        <div class="extract-stat">Images: <strong>${(pkg.images || []).length}</strong></div>
    `;

    const panel = document.getElementById('extractPanel');
    if (!currentPage) {
        panel.innerHTML = '<div class="extract-empty">No extracted pages available for this document.</div>';
        return;
    }

    const pageTables = currentPage.table_entries || [];
    const pageTablesFallback = currentPage.tables || [];
    const pageImages = currentPage.images || [];
    const pageText = currentPage.text || '';
    const pageOcrText = currentPage.ocr_text || '';
    const pageTextSource = currentPage.text_source || (pageOcrText ? 'OCR' : 'Native Text');
    const pageOcrStatus = currentPage.ocr_status || (pageOcrText ? 'available' : 'not_available');

    panel.innerHTML = `
        <div class="extract-card">
            <div class="extract-card-title">Page ${currentPage.page_num} Metadata</div>
            <div class="extract-meta-grid">
                <div><span>Document Type</span><strong>${currentPage.document_type || 'UNKNOWN'}</strong></div>
                <div><span>Text Source</span><strong>${pageTextSource}</strong></div>
                <div><span>Tables Found</span><strong>${pageTables.length}</strong></div>
                <div><span>Images Found</span><strong>${pageImages.length}</strong></div>
            </div>
        </div>

        <div class="extract-card">
            <div class="extract-card-title">Extracted Text</div>
            <pre class="extract-pre">${escapeExtractText(pageText)}</pre>
        </div>

        <div class="extract-card">
            <div class="extract-card-title">OCR Text (Raw)</div>
            ${pageOcrText
            ? `<pre class="extract-pre">${escapeExtractText(pageOcrText)}</pre><div class="extract-muted">OCR Status: ${escapeExtractText(pageOcrStatus)}</div>`
            : `<div class="extract-muted">No OCR text captured. OCR Status: ${escapeExtractText(pageOcrStatus)}</div>`}
        </div>

        <div class="extract-card">
            <div class="extract-card-title">Table Extraction</div>
            ${renderExtractTables(pageTables, pageTablesFallback)}
        </div>

        <div class="extract-card">
            <div class="extract-card-title">Image Extraction</div>
            ${pageImages.length ? `
                <div class="extract-image-list">
                    ${pageImages.map(img => `
                        <div class="extract-image-item">
                            <strong>${img.image_ref || 'image'}</strong>
                            <span>Type: ${img.ext || 'unknown'}</span>
                            <span>Size: ${(img.width || '?')} × ${(img.height || '?')}</span>
                            <span>XRef: ${img.xref || '-'}</span>
                        </div>
                    `).join('')}
                </div>
            ` : '<div class="extract-muted">No images detected on this page.</div>'}
        </div>
    `;
}

function renderExtractTables(tableEntries, fallbackTables) {
    if (Array.isArray(tableEntries) && tableEntries.length) {
        return tableEntries.map(entry => {
            const rows = entry.rows || [];
            const title = `Table ${entry.index || '-'}`;
            if (!rows.length) {
                return `<pre class="extract-table-pre">${escapeExtractText(entry.text || '')}</pre>`;
            }
            const rowsHtml = rows.map((row, rowIdx) => {
                const cells = row.map(cell => `<${rowIdx === 0 ? 'th' : 'td'}>${escapeExtractText(cell)}</${rowIdx === 0 ? 'th' : 'td'}>`).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
            return `
                <div class="extract-table-wrap">
                    <div class="extract-table-label">${title}</div>
                    <table class="extract-table-grid">${rowsHtml}</table>
                </div>
            `;
        }).join('');
    }

    if (Array.isArray(fallbackTables) && fallbackTables.length) {
        return fallbackTables.map(t => `<pre class="extract-table-pre">${escapeExtractText(t)}</pre>`).join('');
    }

    return '<div class="extract-muted">No tables detected on this page.</div>';
}

function escapeExtractText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/* ── Results Table ── */
function renderResultsTable(evals) {
    const tbody = document.getElementById('resultsBody');
    tbody.innerHTML = '';
    evals.forEach(ev => {
        const verdictClass = ev.result.toLowerCase();
        const icon = ev.result === 'PASS' ? '✅' : (ev.result === 'FAIL' ? '❌' : '⚠️');
        const confidence = (ev.confidence || '').toUpperCase();
        const confClass = confidence.toLowerCase();
        const category = ev.category || '';
        const catClass = category.toLowerCase();
        const tr = document.createElement('tr');
        tr.onclick = () => { switchTab('explain'); };
        tr.innerHTML = `
            <td style="font-weight:600;color:var(--text-muted);font-size:0.82rem;">${ev.criterion_id || '—'}</td>
            <td>
                <div style="font-weight:600;">${ev.criteria_name || '—'}</div>
                ${ev.reason ? `<div class="reason-text">${ev.reason}</div>` : ''}
            </td>
            <td>${category ? `<span class="category-badge ${catClass}">${category}</span>` : '—'}</td>
            <td style="color:var(--text-secondary);">${ev.required_value || '—'}</td>
            <td style="color:var(--text-secondary);">${ev.evidence_found || '<span style="color:var(--accent-yellow)">Not Found</span>'}</td>
            <td>${confidence ? `<span class="confidence-badge ${confClass}">${confidence}</span>` : '—'}</td>
            <td><span class="verdict-badge ${verdictClass}">${icon} ${ev.result}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

/* ── Review Tab ── */
function renderReviewTab(evals, criteria, evidence) {
    const reviewList = document.getElementById('reviewList');
    reviewList.innerHTML = '';
    const reviewItems = evals.filter(e => e.result === 'REVIEW' || e.result === 'FAIL');

    if (reviewItems.length === 0) {
        reviewList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎉</div><div class="empty-state-text">All criteria passed — no review needed.</div></div>';
        return;
    }

    reviewItems.forEach(rv => {
        const crit = criteria.find(c => c.criterion_id === rv.criterion_id);
        const ev = evidence.find(e => e.criterion_id === rv.criterion_id);
        const snippet = crit?.source?.raw_snippet || ev?.source?.raw_snippet || 'No source snippet available.';
        const page = crit?.source?.page || ev?.source?.page || '?';
        const icon = rv.result === 'FAIL' ? '❌' : '⚠️';

        const div = document.createElement('div');
        div.className = 'review-item';
        div.style.borderLeftColor = rv.result === 'FAIL' ? 'var(--accent-red)' : 'var(--accent-yellow)';
        div.innerHTML = `
            <div class="review-header">
                <div class="review-title">${icon} ${rv.criteria_name} <span class="verdict-badge ${rv.result.toLowerCase()}">${rv.result}</span></div>
                <span style="font-size:0.75rem;color:var(--text-muted);">Page ${page}</span>
            </div>
            <div class="review-snippet">"${snippet}"</div>
            <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
                Required: <strong>${rv.required_value || '—'}</strong> &nbsp; | &nbsp; 
                Found: <strong style="color:${rv.evidence_found ? 'var(--accent-yellow)' : 'var(--accent-red)'}">${rv.evidence_found || 'Not Found'}</strong>
            </div>
            <div class="review-actions">
                <input class="review-input" placeholder="Enter corrected value..." id="override-${rv.criterion_id}" />
                <button class="btn-override" onclick="applyOverride('${rv.criterion_id}')">Override → PASS</button>
            </div>
        `;
        reviewList.appendChild(div);
    });
}

/* ── Explainability Tab ── */
function renderExplainTab(evals, criteria, evidence) {
    const explainList = document.getElementById('explainList');
    explainList.innerHTML = '';

    evals.forEach(ev => {
        const crit = criteria.find(c => c.criterion_id === ev.criterion_id);
        const evd = evidence.find(e => e.criterion_id === ev.criterion_id);
        const icon = ev.result === 'PASS' ? '✅' : (ev.result === 'FAIL' ? '❌' : '⚠️');

        const div = document.createElement('div');
        div.className = 'explain-item';
        div.innerHTML = `
            <div class="explain-header" onclick="this.parentElement.classList.toggle('expanded')">
                <div class="explain-criterion">
                    <span class="verdict-badge ${ev.result.toLowerCase()}">${icon} ${ev.result}</span>
                    ${ev.criteria_name}
                </div>
                <span class="explain-arrow">▼</span>
            </div>
            <div class="explain-body">
                <div class="explain-grid">
                    <div class="explain-field">
                        <label>Required Value</label>
                        <div class="val" style="color:var(--accent-blue)">${ev.required_value || '—'}</div>
                    </div>
                    <div class="explain-field">
                        <label>Extracted Value</label>
                        <div class="val" style="color:${ev.result === 'PASS' ? 'var(--accent-green)' : 'var(--accent-red)'}">${ev.evidence_found || 'Not Found'}</div>
                    </div>
                    <div class="explain-field">
                        <label>Type</label>
                        <div class="val">${crit?.type || '—'}</div>
                    </div>
                    <div class="explain-field">
                        <label>Mandatory</label>
                        <div class="val">${crit?.mandatory ? 'Yes' : 'No'}</div>
                    </div>
                    <div class="explain-field">
                        <label>Confidence</label>
                        <div class="val">${crit?.confidence || evd?.confidence || '—'}</div>
                    </div>
                    <div class="explain-field">
                        <label>Source Page</label>
                        <div class="val">Page ${crit?.source?.page || evd?.source?.page || '?'}</div>
                    </div>
                </div>
                ${crit?.source?.raw_snippet ? `<div class="explain-source">"${crit.source.raw_snippet}"</div>` : ''}
                ${evd?.source?.raw_snippet ? `<div class="explain-source" style="border-left-color:var(--accent-green);margin-top:0.5rem;">"${evd.source.raw_snippet}"</div>` : ''}
            </div>
        `;
        explainList.appendChild(div);
    });
}

/* ── Issues Tab ── */
function renderIssuesTab(issues) {
    const issuesList = document.getElementById('issuesList');
    issuesList.innerHTML = '';

    if (issues.length === 0) {
        issuesList.innerHTML = '<div class="vigilance-empty">✅ No issues detected — all data looks clean.</div>';
        return;
    }

    issues.forEach(iss => {
        const sevClass = (iss.severity || 'medium').toLowerCase();
        const sevIcon = sevClass === 'high' ? '🔴' : (sevClass === 'medium' ? '🟡' : '🔵');
        const typeIcons = {
            'MISSING_VALUE': '📭',
            'LOW_CONFIDENCE': '🔍',
            'OCR_UNCERTAIN': '📸',
            'CONFLICTING_VALUES': '⚡',
            'HIGH_SIMILARITY': '👯',
            'ANOMALY': '🚩',
            'OTHER': '📋'
        };
        const typeIcon = typeIcons[iss.issue_type] || '📋';
        const confBadge = iss.confidence ? `<span class="confidence-badge ${(iss.confidence || '').toLowerCase()}">${iss.confidence}</span>` : '';
        const affectedHtml = (iss.affected_bidders && iss.affected_bidders.length) 
            ? `<span>Affected: ${iss.affected_bidders.join(', ')}</span>` 
            : '';

        const div = document.createElement('div');
        div.className = `vigilance-card severity-${sevClass}`;
        div.innerHTML = `
            <div class="vigilance-top">
                <div class="vigilance-type">${typeIcon} ${iss.issue_type.replace(/_/g, ' ')}</div>
                <div style="display:flex;gap:0.5rem;align-items:center;">
                    ${confBadge}
                    <span class="severity-badge ${sevClass}">${sevIcon} ${iss.severity}</span>
                </div>
            </div>
            <div class="vigilance-reason">${iss.reason || ''}</div>
            ${iss.description ? `<div class="vigilance-reason" style="margin-top:0.3rem;font-style:italic;">${iss.description}</div>` : ''}
            <div class="vigilance-meta">
                ${iss.criterion_id ? `<span>Criterion: ${iss.criterion_id}</span>` : ''}
                ${affectedHtml}
            </div>
        `;
        issuesList.appendChild(div);
    });
}

/* ── Field Mapping Tab ── */
function renderFieldMappingTab(mappings, criteria) {
    const fieldmapList = document.getElementById('fieldmapList');
    if (!fieldmapList) return;
    fieldmapList.innerHTML = '';

    if (!mappings || mappings.length === 0) {
        fieldmapList.innerHTML = '<div class="fieldmap-empty">✅ All criteria were directly matched — no semantic mapping needed.</div>';
        return;
    }

    mappings.forEach(m => {
        const conf = (m.mapping_confidence || 'LOW').toLowerCase();
        const crit = criteria ? criteria.find(c => c.criterion_id === m.criterion_id) : null;
        const critName = crit ? crit.name : m.criterion_id;
        const matched = m.matched_field || null;

        const div = document.createElement('div');
        div.className = `fieldmap-card ${conf}-confidence`;
        div.innerHTML = `
            <div class="fieldmap-row">
                <span class="fieldmap-criterion">${critName}</span>
                <span class="fieldmap-arrow">→</span>
                <span class="fieldmap-match ${matched ? '' : 'not-found'}">${matched || 'No match found'}</span>
                <span class="confidence-badge ${conf}">${(m.mapping_confidence || 'LOW').toUpperCase()}</span>
            </div>
            ${m.reason ? `<div class="fieldmap-reason">${m.reason}</div>` : ''}
        `;
        fieldmapList.appendChild(div);
    });
}

/* ── Pipeline Steps Footer ── */
function renderPipelineStepsFooter(steps) {
    // Remove existing footer if present
    const existing = document.getElementById('pipelineStepsFooter');
    if (existing) existing.remove();

    if (!steps || steps.length === 0) return;

    const container = document.getElementById('tabsContainer');
    if (!container) return;

    const footer = document.createElement('div');
    footer.id = 'pipelineStepsFooter';
    footer.className = 'pipeline-steps-footer';

    steps.forEach(step => {
        const statusClass = step.status === 'success' ? 'success' : (step.status === 'skipped' ? 'skipped' : (step.status === 'failed' ? 'failed' : ''));
        const statusIcon = step.status === 'success' ? '✅' : (step.status === 'skipped' ? '⏭' : (step.status === 'failed' ? '❌' : '🔄'));
        const chip = document.createElement('div');
        chip.className = `pipeline-step-chip ${statusClass}`;
        chip.innerHTML = `${statusIcon} Step ${step.step}: ${step.name} <span class="step-time">(${step.duration_seconds}s)</span>`;
        footer.appendChild(chip);
    });

    container.appendChild(footer);
}

/* ── Final Evaluation Tab (LLM-based) ── */
function renderFinalEvalTab(evaluations) {
    const list = document.getElementById('finalEvalList');
    if (!list) return;
    list.innerHTML = '';

    if (!evaluations || evaluations.length === 0) {
        list.innerHTML = '<div class="fieldmap-empty">No LLM-based evaluation available. The rule engine results are shown in the Results tab.</div>';
        return;
    }

    evaluations.forEach(ev => {
        const verdict = ev.verdict || 'REVIEW_REQUIRED';
        const verdictClass = verdict === 'PASS' ? 'pass' : (verdict === 'FAIL' ? 'fail' : 'review');
        const verdictIcon = verdict === 'PASS' ? '✅' : (verdict === 'FAIL' ? '❌' : '⚠️');
        const conf = (ev.confidence || '').toLowerCase();
        const confUpper = (ev.confidence || '').toUpperCase();

        const div = document.createElement('div');
        div.className = `vigilance-card severity-${verdict === 'PASS' ? 'low' : (verdict === 'FAIL' ? 'high' : 'medium')}`;
        div.innerHTML = `
            <div class="vigilance-top">
                <div class="vigilance-type">${verdictIcon} ${ev.criterion_id || ''}</div>
                <div style="display:flex;gap:0.5rem;align-items:center;">
                    <span class="confidence-badge ${conf}">${confUpper}</span>
                    <span class="verdict-badge ${verdictClass}">${verdictIcon} ${verdict}</span>
                </div>
            </div>
            <div class="vigilance-reason">${ev.reason || ''}</div>
            <div class="vigilance-meta">
                ${ev.required_value ? `<span>Required: ${ev.required_value}</span>` : ''}
                ${ev.extracted_value ? `<span>Found: ${ev.extracted_value}</span>` : ''}
                ${ev.source ? `<span>Page ${ev.source.page || '?'}</span>` : ''}
            </div>
        `;
        list.appendChild(div);
    });
}

/* ── PII Masking Tab ── */
function renderPIITab(piiData) {
    const list = document.getElementById('piiList');
    if (!list) return;
    list.innerHTML = '';

    const mappings = piiData.mappings || [];

    if (mappings.length === 0) {
        list.innerHTML = '<div class="vigilance-empty">🔓 No sensitive identifiers detected in the documents.</div>';
        return;
    }

    // Summary
    const summary = document.createElement('div');
    summary.className = 'fieldmap-header';
    const typeCounts = {};
    mappings.forEach(m => { typeCounts[m.type] = (typeCounts[m.type] || 0) + 1; });
    const typeStr = Object.entries(typeCounts).map(([k, v]) => `${v} ${k}`).join(', ');
    summary.innerHTML = `<p class="fieldmap-desc">Detected ${mappings.length} sensitive fields: ${typeStr}</p>`;
    list.appendChild(summary);

    const typeIcons = {
        'organization': '🏢',
        'gstin': '📋',
        'pan': '🆔',
        'phone': '📱',
        'email': '📧',
    };

    mappings.forEach(m => {
        const icon = typeIcons[m.type] || '🔒';
        const div = document.createElement('div');
        div.className = 'fieldmap-card medium-confidence';
        div.innerHTML = `
            <div class="fieldmap-row">
                <span class="fieldmap-criterion">${icon} ${m.type.toUpperCase()}</span>
                <span class="fieldmap-arrow">→</span>
                <span class="fieldmap-match">${m.token}</span>
                <span class="confidence-badge medium">MASKED</span>
            </div>
            <div class="fieldmap-reason">Original: <code style="color:var(--text-muted);font-family:monospace;">${m.original}</code></div>
        `;
        list.appendChild(div);
    });
}

/* ── Verification Tab ── */
function renderVerificationTab(verifications) {
    const list = document.getElementById('verificationList');
    if (!list) return;
    list.innerHTML = '';

    if (!verifications || verifications.length === 0) {
        list.innerHTML = '<div class="fieldmap-empty">No GSTIN/PAN identifiers found in bidder evidence for verification.</div>';
        return;
    }

    verifications.forEach(v => {
        const status = v.status || 'NOT_FOUND';
        const statusIcon = status === 'FORMAT_VALID' ? '✅' : (status === 'INVALID_FORMAT' ? '❌' : '❓');
        const sevClass = status === 'FORMAT_VALID' ? 'low' : (status === 'INVALID_FORMAT' ? 'high' : 'medium');
        const conf = (v.confidence || '').toLowerCase();
        const confUpper = (v.confidence || '').toUpperCase();
        const meta = v.metadata || {};

        let metaHtml = '';
        if (meta.state_name) metaHtml += `<span>State: ${meta.state_name}</span>`;
        if (meta.entity_type) metaHtml += `<span>Entity: ${meta.entity_type}</span>`;
        if (meta.embedded_pan) metaHtml += `<span>PAN: ${meta.embedded_pan}</span>`;

        const div = document.createElement('div');
        div.className = `vigilance-card severity-${sevClass}`;
        div.innerHTML = `
            <div class="vigilance-top">
                <div class="vigilance-type">${statusIcon} ${v.identifier_type}: <code style="font-family:monospace;letter-spacing:1px;">${v.identifier}</code></div>
                <div style="display:flex;gap:0.5rem;align-items:center;">
                    <span class="confidence-badge ${conf}">${confUpper}</span>
                    <span class="severity-badge ${sevClass}">${statusIcon} ${status.replace(/_/g, ' ')}</span>
                </div>
            </div>
            <div class="vigilance-reason">${v.details || ''}</div>
            ${metaHtml ? `<div class="vigilance-meta">${metaHtml}${v.source_criterion ? `<span>Source: ${v.source_criterion}</span>` : ''}</div>` : ''}
        `;
        list.appendChild(div);
    });
}

/* ── Final Verdict Banner ── */
function renderVerdictBanner(passCount, failCount, reviewCount) {
    const banner = document.getElementById('verdictBanner');
    const verdictText = document.getElementById('verdictText');
    const verdictSub = document.getElementById('verdictSub');

    if (failCount > 0) {
        banner.className = 'verdict-banner active not-eligible';
        verdictText.textContent = '❌ NOT ELIGIBLE';
        verdictSub.textContent = `${failCount} criterion(s) failed. ${reviewCount > 0 ? reviewCount + ' need review.' : ''}`;
    } else if (reviewCount > 0) {
        banner.className = 'verdict-banner active needs-review';
        verdictText.textContent = '⚠️ REVIEW REQUIRED';
        verdictSub.textContent = `${reviewCount} criterion(s) require manual verification.`;
    } else {
        banner.className = 'verdict-banner active eligible';
        verdictText.textContent = '✅ ELIGIBLE';
        verdictSub.textContent = `All ${passCount} criteria passed successfully.`;
    }
}

/* ═══════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════ */
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === 'tab-' + tabId);
    });
}

/* ═══════════════════════════════════════════
   REVIEW OVERRIDE (Human-in-the-Loop)
   ═══════════════════════════════════════════ */
function applyOverride(criterionId) {
    const input = document.getElementById('override-' + criterionId);
    const newValue = input.value.trim();
    if (!newValue) {
        showError('Please enter a corrected value before overriding.');
        return;
    }

    if (pipelineData) {
        const evalItem = pipelineData.evaluation.find(e => e.criterion_id === criterionId);
        if (evalItem) {
            evalItem.result = 'PASS';
            evalItem.evidence_found = newValue + ' (manual override)';
            renderResults(pipelineData);
            switchTab('results');
        }
    }
}

/* ═══════════════════════════════════════════
   ERROR TOAST (minor warnings)
   ═══════════════════════════════════════════ */
function showError(message) {
    const toast = document.getElementById('errorToast');
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => { toast.classList.remove('visible'); }, 6000);
}

/* ═══════════════════════════════════════════
   ERROR PANEL (detailed, persistent)
   ═══════════════════════════════════════════ */
function showErrorPanel(data) {
    const panel = document.getElementById('errorPanel');
    if (!panel) return;

    const errors = data.errors || [];
    const details = data.error_details || [];
    const provider = data.provider || currentProvider;

    let html = `
        <div class="error-panel-header">
            <div class="error-panel-icon">⚠</div>
            <div>
                <div class="error-panel-title">Evaluation Failed</div>
                <div class="error-panel-subtitle">The AI pipeline could not complete. See details below.</div>
            </div>
            <button class="error-panel-close" onclick="hideErrorPanel()">✕</button>
        </div>
    `;

    // Show each detailed error as a card
    if (details.length > 0) {
        html += '<div class="error-detail-list">';
        details.forEach(detail => {
            const isQuota = detail.toLowerCase().includes('quota');
            const isAuth = detail.toLowerCase().includes('key') || detail.toLowerCase().includes('auth');
            const isModel = detail.toLowerCase().includes('model') || detail.toLowerCase().includes('not found');
            let icon = '🔴';
            let typeLabel = 'ERROR';
            if (isQuota) { icon = '⏱'; typeLabel = 'QUOTA / RATE LIMIT'; }
            else if (isAuth) { icon = '🔑'; typeLabel = 'AUTHENTICATION'; }
            else if (isModel) { icon = '🤖'; typeLabel = 'MODEL'; }

            html += `
                <div class="error-detail-card">
                    <div class="error-detail-icon">${icon}</div>
                    <div class="error-detail-body">
                        <div class="error-detail-type">${typeLabel}</div>
                        <div class="error-detail-msg">${detail}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    } else if (errors.length > 0) {
        html += '<div class="error-detail-list">';
        errors.forEach(err => {
            html += `
                <div class="error-detail-card">
                    <div class="error-detail-icon">🔴</div>
                    <div class="error-detail-body">
                        <div class="error-detail-type">ERROR</div>
                        <div class="error-detail-msg">${err}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    // Suggestions
    html += `
        <div class="error-suggestions">
            <div class="error-suggestions-title">💡 What you can do:</div>
            <ul>
                <li>Check your API keys in the <strong>.env</strong> file</li>
                <li>Try switching providers using the ⚙ Settings panel</li>
                <li>If quota is exceeded, wait a few minutes or add billing to your API account</li>
                <li>Verify your API key at <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a> or <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Dashboard</a></li>
            </ul>
        </div>
    `;

    // Provider info
    html += `
        <div class="error-provider-info">
            Active provider: <strong>${provider === 'openai' ? 'OpenAI' : (provider === 'openrouter' ? 'OpenRouter' : 'Gemini')}</strong> · Auto-fallback attempted multiple providers
        </div>
    `;

    panel.innerHTML = html;
    panel.classList.add('active');
}

function hideErrorPanel() {
    const panel = document.getElementById('errorPanel');
    if (panel) {
        panel.classList.remove('active');
        panel.innerHTML = '';
    }
}

/* ═══════════════════════════════════════════
   SETTINGS PANEL
   ═══════════════════════════════════════════ */
let currentProvider = 'gemini';

function toggleSettings() {
    const panel = document.getElementById('settingsPanel');
    const overlay = document.getElementById('settingsOverlay');
    const btn = document.getElementById('settingsBtn');
    const isOpen = panel.classList.contains('open');

    if (isOpen) {
        panel.classList.remove('open');
        overlay.classList.remove('open');
        btn.classList.remove('active');
    } else {
        panel.classList.add('open');
        overlay.classList.add('open');
        btn.classList.add('active');
        loadSettings();
    }
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        currentProvider = data.provider;
        updateProviderUI(currentProvider);

        // Update key statuses from API
        const geminiStatus = document.getElementById('geminiKeyStatus');
        const openaiStatus = document.getElementById('openaiKeyStatus');
        const openrouterStatus = document.getElementById('openrouterKeyStatus');

        if (data.keys && data.keys.gemini) {
            geminiStatus.textContent = '● Configured';
            geminiStatus.className = 'key-status configured';
        } else {
            geminiStatus.textContent = '○ Not Set';
            geminiStatus.className = 'key-status missing';
        }

        if (data.keys && data.keys.openai) {
            openaiStatus.textContent = '● Configured';
            openaiStatus.className = 'key-status configured';
        } else {
            openaiStatus.textContent = '○ Not Set';
            openaiStatus.className = 'key-status missing';
        }

        if (data.keys && data.keys.openrouter) {
            openrouterStatus.textContent = '● Configured';
            openrouterStatus.className = 'key-status configured';
        } else {
            openrouterStatus.textContent = '○ Not Set';
            openrouterStatus.className = 'key-status missing';
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

async function switchProvider(provider) {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to switch provider');
        }
        const data = await res.json();
        currentProvider = data.provider;
        updateProviderUI(currentProvider);
    } catch (err) {
        showError('⚠ Failed to switch provider: ' + err.message);
    }
}

function updateProviderUI(provider) {
    // Update toggle buttons
    document.querySelectorAll('.provider-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.provider === provider);
    });

    // Update navbar indicator
    const dot = document.querySelector('#providerIndicator .provider-dot');
    const name = document.getElementById('providerName');
    dot.className = 'provider-dot ' + provider;
    name.textContent = provider === 'gemini' ? 'Gemini' : (provider === 'openai' ? 'OpenAI' : 'OpenRouter');
}

// Load settings on page init
(async function initSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        currentProvider = data.provider;
        updateProviderUI(currentProvider);
    } catch (err) {
        console.error('Could not load initial settings:', err);
    }
})();

/* ═══════════════════════════════════════════
   DOCUMENT VIEW - LAYOUT RENDERING
   ═══════════════════════════════════════════ */

let documentViewState = {
    currentDoc: 'tender',  // 'tender' or 'bidder'
    currentPage: 0,
    tenderPages: [],
    bidderPages: [],
    extractedValues: []  // For highlighting
};

function renderDocumentView(data) {
    // Initialize document view state
    documentViewState.tenderPages = data.document_view?.tender || [];
    documentViewState.bidderPages = data.document_view?.bidder || [];
    documentViewState.currentDoc = 'tender';
    documentViewState.currentPage = 0;

    // Collect all extracted values for highlighting
    documentViewState.extractedValues = (data.evaluation || []).reduce((acc, ev) => {
        if (ev.evidence_found && ev.evidence_found !== 'Not Found') {
            acc.push({
                criterion_id: ev.criterion_id,
                text: ev.evidence_found,
                result: ev.result
            });
        }
        return acc;
    }, []);

    // Render initial page
    renderDocumentPage();
    updateDocPaginationUI();
}

function switchDocView(docType) {
    documentViewState.currentDoc = docType;
    documentViewState.currentPage = 0;

    // Update button states
    document.querySelectorAll('.docview-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.doc === docType);
    });

    renderDocumentPage();
    updateDocPaginationUI();
}

function nextDocPage() {
    const pages = documentViewState.currentDoc === 'tender'
        ? documentViewState.tenderPages
        : documentViewState.bidderPages;

    if (documentViewState.currentPage < pages.length - 1) {
        documentViewState.currentPage++;
        renderDocumentPage();
        updateDocPaginationUI();
    }
}

function prevDocPage() {
    if (documentViewState.currentPage > 0) {
        documentViewState.currentPage--;
        renderDocumentPage();
        updateDocPaginationUI();
    }
}

function updateDocPaginationUI() {
    const pages = documentViewState.currentDoc === 'tender'
        ? documentViewState.tenderPages
        : documentViewState.bidderPages;

    document.getElementById('docCurrentPage').textContent = documentViewState.currentPage + 1;
    document.getElementById('docTotalPages').textContent = pages.length || 1;
    document.getElementById('docPrevBtn').disabled = documentViewState.currentPage === 0;
    document.getElementById('docNextBtn').disabled = documentViewState.currentPage >= pages.length - 1;
}

function renderDocumentPage() {
    const pages = documentViewState.currentDoc === 'tender'
        ? documentViewState.tenderPages
        : documentViewState.bidderPages;

    const renderer = document.getElementById('docviewRenderer');
    const fallback = document.getElementById('docviewFallback');

    if (!pages || pages.length === 0) {
        renderer.style.display = 'none';
        fallback.style.display = 'block';
        fallback.innerHTML = '<p>No layout data available. Unable to render document view.</p>';
        return;
    }

    const page = pages[documentViewState.currentPage];
    if (!page) {
        renderer.style.display = 'none';
        fallback.style.display = 'block';
        return;
    }

    try {
        const pageHtml = renderPageLayout(page);
        renderer.innerHTML = pageHtml;
        renderer.style.display = 'block';
        fallback.style.display = 'none';
    } catch (err) {
        console.error('Failed to render page layout:', err);
        renderer.style.display = 'none';
        fallback.style.display = 'block';
        fallback.innerHTML = `<p>Failed to render layout: ${err.message}</p>`;
    }
}

function renderPageLayout(page) {
    const width = page.width || 612;  // Default letter width
    const height = page.height || 792;  // Default letter height
    const aspectRatio = width / height;

    // Calculate container size for responsive rendering
    const containerWidth = Math.min(800, window.innerWidth - 60);
    const containerHeight = containerWidth / aspectRatio;
    const scale = containerWidth / width;

    let html = `<div class="page-canvas" style="
        width: ${containerWidth}px;
        height: ${containerHeight}px;
        position: relative;
        background: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        overflow: hidden;
    ">`;

    // Debug: Log page info
    console.log(`Rendering page ${page.page_num}: ${page.blocks?.length || 0} blocks, scale=${scale.toFixed(3)}`);

    // Render each text block
    const blocks = page.blocks || [];
    if (blocks.length === 0) {
        html += `<div style="padding: 20px; color: #999; font-size: 12px;">No text blocks found on this page</div>`;
    } else {
        blocks.forEach((block, idx) => {
            try {
                if (block.block_type === 'image' && block.src) {
                    const imageBbox = block.bbox || [0, 0, width, height];
                    const [ix0, iy0, ix1, iy1] = imageBbox;
                    const imgLeft = ix0 * scale;
                    const imgTop = iy0 * scale;
                    const imgWidth = Math.max((ix1 - ix0) * scale, 80);
                    const imgHeight = Math.max((iy1 - iy0) * scale, 60);
                    html += `<img src="${block.src}" alt="Extracted image" style="
                        position:absolute;
                        left:${imgLeft}px;
                        top:${imgTop}px;
                        width:${imgWidth}px;
                        height:${imgHeight}px;
                        object-fit:contain;
                        border:1px solid rgba(99,130,255,0.35);
                        border-radius:4px;
                        background:rgba(255,255,255,0.05);
                        z-index:1;
                        pointer-events:none;
                    " />`;
                    return;
                }

                if (block.block_type === 'table') {
                    const tableBbox = block.bbox || [0, 0, width, height];
                    const [tx0, ty0, tx1, ty1] = tableBbox;
                    const tableLeft = tx0 * scale;
                    const tableTop = ty0 * scale;
                    const tableWidth = Math.max((tx1 - tx0) * scale, 120);
                    const tableHeight = Math.max((ty1 - ty0) * scale, 60);
                    const rows = Array.isArray(block.rows) ? block.rows : [];

                    const tableHtml = rows.length
                        ? `<table style="width:100%;border-collapse:collapse;font-size:10px;line-height:1.2;">${rows.map((row, rowIdx) => `<tr>${row.map(cell => `<${rowIdx === 0 ? 'th' : 'td'} style=\"border:1px solid #b6c2d3;padding:2px 4px;text-align:left;vertical-align:top;background:${rowIdx === 0 ? '#edf2ff' : '#fff'};\">${escapeExtractText(cell)}</${rowIdx === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`
                        : `<pre style="margin:0;font-size:10px;white-space:pre-wrap;line-height:1.2;">${escapeExtractText(block.text || '')}</pre>`;

                    html += `<div style="
                        position:absolute;
                        left:${tableLeft}px;
                        top:${tableTop}px;
                        width:${tableWidth}px;
                        height:${tableHeight}px;
                        overflow:auto;
                        background:rgba(255,255,255,0.99);
                        border:1px solid rgba(48,62,102,0.75);
                        border-radius:4px;
                        padding:3px;
                        z-index:3;
                        color:#101828;
                    " title="Table ${block.table_index || ''}">${tableHtml}</div>`;
                    return;
                }

                const bbox = block.bbox || [];
                if (bbox.length < 4) {
                    console.warn(`Block ${idx} has invalid bbox:`, bbox);
                    return;
                }

                const [x0, y0, x1, y1] = bbox;
                const text = (block.text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const fontSize = Math.max(block.font_size || 12, 1);
                let [r, g, b] = block.color || [0, 0, 0];

                // Ensure color values are valid
                r = Math.max(0, Math.min(255, parseInt(r) || 0));
                g = Math.max(0, Math.min(255, parseInt(g) || 0));
                b = Math.max(0, Math.min(255, parseInt(b) || 0));

                // Avoid invisible white text on white page background.
                const brightness = (0.299 * r) + (0.587 * g) + (0.114 * b);
                if (brightness > 235) {
                    r = 20;
                    g = 30;
                    b = 45;
                }

                const fontName = (block.font_name || 'Helvetica').replace(/"/g, '');

                // Scale all coordinates
                const scaledX = x0 * scale;
                const scaledY = y0 * scale;
                const bboxWidth = Math.max((x1 - x0) * scale, 1);
                const bboxHeight = Math.max((y1 - y0) * scale, 1);
                const scaledFontSize = Math.max(fontSize * scale, 8);
                // Fallback estimated text box helps when PDF span bbox is too tight.
                const estimatedWidth = Math.max((text.length * scaledFontSize * 0.55), scaledFontSize * 2);
                const scaledWidth = Math.max(bboxWidth, estimatedWidth);
                const scaledHeight = Math.max(bboxHeight, scaledFontSize * 1.25);

                // Skip text blocks that are way outside the canvas (sanity check)
                if (scaledX > containerWidth + 100 || scaledY > containerHeight + 100 ||
                    scaledX + scaledWidth < -100 || scaledY + scaledHeight < -100) {
                    return;
                }

                // Check if this text should be highlighted
                let isHighlighted = false;
                let highlightClass = '';
                documentViewState.extractedValues.forEach(ev => {
                    if (text.includes(ev.text) || ev.text.includes(text)) {
                        isHighlighted = true;
                        highlightClass = ev.result === 'PASS' ? 'pass-highlight' : (ev.result === 'FAIL' ? 'fail-highlight' : 'review-highlight');
                    }
                });

                const highlightStyle = isHighlighted ? `class="text-highlight ${highlightClass}"` : '';

                html += `<div ${highlightStyle} style="
                    position: absolute;
                    left: ${scaledX}px;
                    top: ${scaledY}px;
                    width: ${scaledWidth}px;
                    height: ${scaledHeight}px;
                    font-size: ${scaledFontSize}px;
                    color: rgb(${r},${g},${b});
                    font-family: '${fontName}', serif;
                    overflow: visible;
                    white-space: nowrap;
                    line-height: 1.2;
                    user-select: text;
                    padding: 1px;
                    z-index: 4;
                " title="${text}" data-criterion-id="${documentViewState.extractedValues.find(ev => ev.text.includes(text) || text.includes(ev.text))?.criterion_id || ''}">${text}</div>`;
            } catch (err) {
                console.error(`Error rendering block ${idx}:`, err, block);
            }
        });
    }

    html += `</div>`;
    return html;
}

function renderImageGallery(data) {
    const tenderImages = (data.extraction_view?.tender?.images || []).filter(img => img.image_url);
    const bidderImages = (data.extraction_view?.bidder?.images || []).filter(img => img.image_url);

    renderGalleryGrid('tenderGalleryGrid', tenderImages);
    renderGalleryGrid('bidderGalleryGrid', bidderImages);
}

function renderGalleryGrid(containerId, images) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!images.length) {
        container.innerHTML = '<div class="extract-muted">No images extracted.</div>';
        return;
    }

    images.forEach(img => {
        const card = document.createElement('div');
        card.className = 'gallery-card';
        card.innerHTML = `
            <img src="${img.image_url}" class="gallery-thumb" alt="Extracted image" />
            <div class="gallery-meta">
                <div><strong>Page:</strong> ${img.page || '-'}</div>
                <div><strong>Size:</strong> ${(img.width || '?')} x ${(img.height || '?')}</div>
                <div><strong>Type:</strong> ${img.ext || 'unknown'}</div>
            </div>
        `;
        card.onclick = () => openImageModal(img.image_url, img);
        container.appendChild(card);
    });
}

function openImageModal(src, meta) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('imageModalImg');
    const modalMeta = document.getElementById('imageModalMeta');
    if (!modal || !modalImg || !modalMeta) return;

    modalImg.src = src;
    modalMeta.textContent = `Page ${meta.page || '-'} • ${(meta.width || '?')}x${(meta.height || '?')} • ${meta.ext || 'unknown'}`;
    modal.classList.add('open');
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.classList.remove('open');
}

/* ═══════════════════════════════════════════
   HISTORY MODAL
   ═══════════════════════════════════════════ */
async function toggleHistory() {
    const overlay = document.getElementById('historyOverlay');
    const panel = document.getElementById('historyPanel');
    const isOpen = panel.classList.contains('open');

    if (isOpen) {
        panel.classList.remove('open');
        overlay.classList.remove('open');
    } else {
        panel.classList.add('open');
        overlay.classList.add('open');
        
        const loading = document.getElementById('historyLoading');
        const table = document.getElementById('historyTable');
        const tbody = document.getElementById('historyTableBody');
        
        loading.style.display = 'block';
        table.style.display = 'none';
        tbody.innerHTML = '';
        
        if (window.fetchHistory) {
            const historyData = await window.fetchHistory();
            renderHistoryTable(historyData);
        } else {
            loading.textContent = 'Firebase module not loaded.';
        }
    }
}

function renderHistoryTable(historyData) {
    const loading = document.getElementById('historyLoading');
    const table = document.getElementById('historyTable');
    const tbody = document.getElementById('historyTableBody');

    loading.style.display = 'none';
    table.style.display = 'table';

    if (!historyData || historyData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-muted);">No past extractions found.</td></tr>';
        return;
    }

    historyData.forEach((doc, idx) => {
        const dateStr = new Date(doc.timestamp).toLocaleString();
        const verdict = doc.summary?.final_verdict || 'EXTRACTION_ONLY';
        
        let badgeClass = 'verdict-badge ';
        if (verdict === 'ELIGIBLE') badgeClass += 'pass';
        else if (verdict === 'NOT_ELIGIBLE') badgeClass += 'fail';
        else if (verdict === 'REVIEW_REQUIRED') badgeClass += 'warn';
        else badgeClass = 'category-badge compliance'; // Extraction only

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-subtle)';
        tr.style.cursor = 'pointer';
        tr.onclick = function(e) {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') {
                toggleHistoryRow(document.getElementById(`btn-hist-${doc.id}`), doc.id);
            }
        };
        
        tr.innerHTML = `
            <td style="padding:12px; font-size:0.85rem;">
                <strong>${dateStr}</strong><br>
                <span style="color:var(--text-muted); font-size:0.75rem;">${doc.evaluation_id}</span>
            </td>
            <td style="padding:12px; font-size:0.85rem;">
                <div style="margin-bottom:4px;"><strong>Tender:</strong> ${doc.tender?.name || '-'}</div>
                <div><strong>Bidder:</strong> ${doc.bidder?.name || '-'}</div>
            </td>
            <td style="padding:12px; font-size:0.85rem;">
                <span class="${badgeClass}">${verdict}</span><br>
                <span style="color:var(--text-muted); font-size:0.75rem; margin-top:4px; display:inline-block;">
                    Crit: ${doc.summary?.total_criteria || 0} | Images: ${(doc.extracted_images || []).length}
                </span>
            </td>
            <td style="padding:12px; text-align:center;">
                <button id="btn-hist-${doc.id}" class="export-btn pdf" style="padding:6px 12px; font-size:0.8rem;" onclick="toggleHistoryRow(this, '${doc.id}')">View Details</button>
            </td>
        `;
        
        const detailsTr = document.createElement('tr');
        detailsTr.id = `history-details-${doc.id}`;
        detailsTr.style.display = 'none';
        detailsTr.style.backgroundColor = 'var(--bg-document)';
        
        // Render details inline
        const imagesHtml = (doc.extracted_images || []).map(img => `
            <a href="${img.storage_url}" target="_blank" style="display:inline-block; margin-right:10px; margin-bottom:10px; border:1px solid var(--border-subtle); padding:4px; border-radius:4px; background:var(--bg-card);">
                <img src="${img.storage_url}" style="height:60px; object-fit:contain;" alt="${img.original_ref}">
                <div style="font-size:0.7rem; text-align:center; margin-top:4px;">${img.original_ref}</div>
            </a>
        `).join('') || '<div style="color:var(--text-muted);">No images extracted.</div>';
        
        const criteriaHtml = (doc.criteria_results || []).map(cr => `
            <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
                <div style="flex:1;"><strong>${cr.criterion_id}</strong>: ${cr.criterion_name}</div>
                <div style="flex:1; text-align:right;">
                    <span class="verdict-badge ${cr.verdict?.toLowerCase() === 'pass' ? 'pass' : (cr.verdict?.toLowerCase() === 'fail' ? 'fail' : 'warn')}">${cr.verdict}</span>
                </div>
            </div>
        `).join('') || '<div style="color:var(--text-muted);">No criteria evaluated.</div>';

        // Stash the full json directly in a data attribute or closure so we can download it
        window[`historyData_${doc.id}`] = doc;

        detailsTr.innerHTML = `
            <td colspan="4" style="padding:16px;">
                <div style="display:flex; justify-content:flex-end; margin-bottom: 12px;">
                    <button class="export-btn audit" style="padding:6px 12px; font-size:0.85rem;" onclick="downloadHistoryJSON('${doc.id}')">
                        <span class="export-icon" ></span> Download Audit JSON
                    </button>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
                    <div style="background:var(--bg-card); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                        <h4 style="margin:0 0 12px 0; font-size:0.9rem; color:var(--text-primary);">Extracted Criteria</h4>
                        <div style="max-height:200px; overflow-y:auto; font-size:0.8rem;">${criteriaHtml}</div>
                    </div>
                    <div style="background:var(--bg-card); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                        <h4 style="margin:0 0 12px 0; font-size:0.9rem; color:var(--text-primary);">Extracted Images</h4>
                        <div>${imagesHtml}</div>
                    </div>
                </div>
            </td>
        `;

        tbody.appendChild(tr);
        tbody.appendChild(detailsTr);
    });
}

window.toggleHistoryRow = function(btn, docId) {
    const detailsRow = document.getElementById(`history-details-${docId}`);
    if (detailsRow.style.display === 'none') {
        detailsRow.style.display = 'table-row';
        btn.textContent = 'Hide Details';
        btn.style.background = 'var(--bg-document)';
        btn.style.color = 'var(--text-primary)';
    } else {
        detailsRow.style.display = 'none';
        btn.textContent = 'View Details';
        btn.style.background = 'var(--bg-card)';
        btn.style.color = 'var(--text-secondary)';
    }
}

window.downloadHistoryJSON = function(docId) {
    const data = window[`historyData_${docId}`];
    if (!data) return;
    
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `InferX_History_${data.evaluation_id || docId}.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}