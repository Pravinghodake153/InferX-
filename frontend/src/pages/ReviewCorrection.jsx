import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../context/useApp';
import { MASK_TYPES, createMaskToken, renderMaskedText, autoDetectMasks } from './reviewUtils';
import { Edit3, Image, BarChart2, Lock, Eye, Unlock, FileText, Play, Search, Link as LinkIcon, Shield, Edit2, Settings, Sparkles, AlertTriangle, CheckCircle, Save } from 'lucide-react';

export default function ReviewCorrection() {
  const { selectedProject, updateProject, selectedProjectId } = useApp();
  const centerRef = useRef(null);

  // View & document state
  const [viewMode, setViewMode] = useState('text');
  const [activeViewType, setActiveViewType] = useState('tender');
  const [activeTenderDoc, setActiveTenderDoc] = useState(0);
  const [activeBidderId, setActiveBidderId] = useState(null);
  const [activeBidderDocIdx] = useState(0);
  const [showOriginal, setShowOriginal] = useState(true);

  // Selection popup state
  const [popup, setPopup] = useState(null); // { x, y, text }
  const [maskPicker, setMaskPicker] = useState(null); // { x, y, text }

  // Mask state
  const [maskEnabled, setMaskEnabled] = useState(true);
  const [manualMasks, setManualMasks] = useState(selectedProject?.reviewData?.manualMasks || {});
  const [maskCounters, setMaskCounters] = useState(selectedProject?.reviewData?.maskCounters || {});
  const [officerPrompt, setOfficerPrompt] = useState(false);
  const [officerInput, setOfficerInput] = useState('');

  // Edit state — keyed by docKey to avoid cross-document bleed
  const docKey = `${activeViewType}_${activeTenderDoc}_${activeBidderId || ''}`;
  const [selectedBlockIdx, setSelectedBlockIdx] = useState(null);
  const [correctionValue, setCorrectionValue] = useState('');
  const [allCorrections, setAllCorrections] = useState(selectedProject?.reviewData?.corrections || {});
  const [allLinks, setAllLinks] = useState(selectedProject?.reviewData?.links || {});
  const [saveStatus, setSaveStatus] = useState(null);

  // Per-document corrections/links
  const corrections = allCorrections[docKey] || {};
  const links = allLinks[docKey] || {};

  // Selected image/table index
  const [selectedImageIdx, setSelectedImageIdx] = useState(null);
  const [selectedTableIdx] = useState(null);



  const isSandbox = selectedProject?.sandboxMode;
  const activeBidder = useMemo(() => {
    if (!selectedProject) return null;
    if (isSandbox) {
      const sandboxBidders = selectedProject.sandboxData?.bidders || [];
      if (activeBidderId) return sandboxBidders.find(b => (b.ubid || b._ubid) === activeBidderId);
      return sandboxBidders[0] || null;
    }
    if (activeBidderId) return selectedProject.bidders.find(b => b.id === activeBidderId);
    return selectedProject?.bidders?.[0] || null;
  }, [selectedProject, activeBidderId, isSandbox]);

  const activeTender = selectedProject?.tenderDocuments?.[activeTenderDoc];
  const activeBidderDoc = activeBidder?.documents?.[activeBidderDocIdx];
  const activeFileObj = activeViewType === 'tender' ? activeTender?.file : activeBidderDoc?.file;
  const activeFileName = useMemo(() => {
    if (isSandbox) return activeViewType === 'tender' ? 'sandbox_tender' : 'sandbox_bidder';
    return activeViewType === 'tender' ? activeTender?.name : activeBidderDoc?.name;
  }, [isSandbox, activeViewType, activeTender, activeBidderDoc]);

  const fileUrl = useMemo(() => {
    const activeDoc = activeViewType === 'tender' ? activeTender : activeBidderDoc;
    if (activeDoc && activeDoc.url && activeDoc.url.startsWith('http')) return activeDoc.url;
    if (activeFileObj) { try { return URL.createObjectURL(activeFileObj); } catch { return null; } }
    return null;
  }, [activeFileObj, activeViewType, activeTender, activeBidderDoc]);

  // Resolve extracted data for current document
  const extractedData = useMemo(() => {
    const ext = selectedProject?.extractedContent;
    if (!ext || !activeFileName) return null;
    
    let bucket;
    if (activeViewType === 'tender') {
      bucket = ext.tender_documents;
    } else {
      const bidderKey = isSandbox ? (activeBidder?.ubid || activeBidder?._ubid) : activeBidder?.id;
      bucket = ext.bidder_documents?.[bidderKey];
    }
    
    if (!bucket) return null;
    if (bucket[activeFileName]) return bucket[activeFileName];
    const fk = Object.keys(bucket).find(k => k.includes(activeFileName) || activeFileName.includes(k));
    if (fk) return bucket[fk];
    const keys = Object.keys(bucket);
    return keys.length === 1 ? bucket[keys[0]] : null;
  }, [selectedProject?.extractedContent, activeFileName, activeViewType, activeBidder, isSandbox]);

  // Derived data from extraction package
  const pages = useMemo(() => extractedData?.package?.pages || [], [extractedData]);
  const allImages = useMemo(() => pages.flatMap(p => (p.images || []).map(img => ({ ...img, pageNum: p.page_num }))), [pages]);
  const allTables = useMemo(() => pages.flatMap(p => (p.table_entries || []).map(t => ({ ...t, pageNum: p.page_num }))), [pages]);

  const textBlocks = useMemo(() => {
    if (extractedData?.package?.context_text) return extractedData.package.context_text.split('\n').filter(l => l.trim());
    if (extractedData?.text) return extractedData.text.split('\n').filter(l => l.trim());
    const ft = selectedProject?.extractedText;
    if (ft) return ft.split('\n').filter(l => l.trim());
    return [];
  }, [extractedData, selectedProject]);

  const criteria = selectedProject?.extractedCriteria || [];

  // ── Persist helper ──
  const saveReviewFields = useCallback((updates) => {
    if (selectedProjectId) updateProject(selectedProjectId, { reviewData: { ...(selectedProject.reviewData || {}), ...updates } });
  }, [selectedProjectId, selectedProject, updateProject]);

  // ── Selection popup ──
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString()?.trim();
    if (!text || text.length < 2) { setPopup(null); return; }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = centerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    // Find which block the selection is in
    const blockEl = range.startContainer?.parentElement?.closest?.('[data-block-idx]');
    const blockIdx = blockEl ? parseInt(blockEl.getAttribute('data-block-idx'), 10) : null;
    setPopup({ x: rect.left - containerRect.left + rect.width / 2, y: rect.top - containerRect.top - 8, text, blockIdx });
    setMaskPicker(null);
  }, []);

  const handleMaskSelect = (type) => {
    if (!maskPicker) return;
    const { token, newCounters } = createMaskToken(type, maskCounters);
    
    // Debug logging as requested
    console.log(`[MASK ADDED] Original text: '${maskPicker.text}' -> Token: ${token}`);
    alert(`MASK SUCCESSFULLY ADDED!\n\nOriginal Text: "${maskPicker.text}"\nMask Token: "${token}"\n\nIf the purple badge does not appear in the text block, it means the original text is not an exact character match for what the DOM rendered.`);
    
    const next = { ...manualMasks, [maskPicker.text]: { token, type } };
    setManualMasks(next); setMaskCounters(newCounters);
    saveReviewFields({ manualMasks: next, maskCounters: newCounters });
    setMaskPicker(null); setPopup(null);
  };

  const handleEditFromPopup = () => {
    if (!popup) return;
    const idx = popup.blockIdx;
    if (idx != null && idx >= 0) { setSelectedBlockIdx(idx); setCorrectionValue(corrections[idx] || textBlocks[idx]); }
    setPopup(null);
  };

  const handleLinkFromPopup = () => {
    if (!popup) return;
    const idx = popup.blockIdx;
    if (idx != null && idx >= 0) { setSelectedBlockIdx(idx); handleSelectBlock(idx); }
    setPopup(null);
  };

  const handleAutoMask = () => {
    let fullText = '';
    if (viewMode === 'text') {
      fullText = textBlocks.join('\n');
    } else if (viewMode === 'image') {
      fullText = pages.map(p => p.ocr_text || p.text || '').join('\n');
    }
    
    if (!fullText) {
      alert("No text available to scan in this view mode.");
      return;
    }
    
    const { masks, counters, addedCount } = autoDetectMasks(fullText, manualMasks, maskCounters);
    
    if (addedCount > 0) {
      setManualMasks(masks);
      setMaskCounters(counters);
      saveReviewFields({ manualMasks: masks, maskCounters: counters });
      alert(`Auto-Mask Complete!\n\nSuccessfully detected and masked ${addedCount} PII entities (Emails, Phones, PANs, GSTINs, Aadhaar, Bank Details, etc).`);
    } else {
      alert("No new standard PII formats detected in the current text.");
    }
  };


  const handleScrollToMask = (origText) => {
    if (viewMode !== 'text') setViewMode('text');
    
    // Find the block containing the text in the currently active document
    const idx = textBlocks.findIndex((block, i) => {
      const display = corrections[i] !== undefined ? corrections[i] : block;
      return display.includes(origText);
    });
    
    if (idx !== -1) {
      handleSelectBlock(idx);
      setTimeout(() => {
        const el = document.querySelector(`[data-block-idx="${idx}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.transition = 'background-color 0.4s';
          el.style.backgroundColor = '#fef08a';
          setTimeout(() => { el.style.backgroundColor = ''; }, 1500);
        }
      }, 100);
    }
  };

  // ── Block actions ──
  const handleSelectBlock = (idx) => { setSelectedBlockIdx(idx); setCorrectionValue(corrections[idx] || textBlocks[idx]); setSaveStatus(null); };
  const handleSaveCorrection = () => {
    if (selectedBlockIdx === null) return;
    const docCorr = { ...corrections, [selectedBlockIdx]: correctionValue };
    const next = { ...allCorrections, [docKey]: docCorr };
    setAllCorrections(next); saveReviewFields({ corrections: next });
    setSaveStatus('success'); setTimeout(() => setSaveStatus(null), 2000);
  };
  const handleLinkCriterion = (cid) => {
    if (selectedBlockIdx === null) return;
    const docLinks = { ...links, [selectedBlockIdx]: cid };
    const next = { ...allLinks, [docKey]: docLinks };
    setAllLinks(next); saveReviewFields({ links: next });
  };

  // ── Mask toggle ──
  const handleMaskToggle = () => {
    setMaskEnabled(!maskEnabled);
  };

  // ── Fullscreen (new tab) ──
  const handleFullscreen = () => {
    if (!fileUrl) return;
    window.open(fileUrl, '_blank', 'noopener');
  };

  // ── Dismiss popups on click outside (use setTimeout to let button clicks fire first) ──
  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest('.selection-popup') || e.target.closest('.mask-type-picker')) return;
      setTimeout(() => { setPopup(null); setMaskPicker(null); }, 150);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Render helpers ──
  const renderMasked = (text) => {
    const segs = renderMaskedText(text, manualMasks, maskEnabled);
    return segs.map((s, i) => s.isMasked ? <span key={i} className="pii-token" title={maskEnabled ? 'Masked' : s.original}>{s.text}</span> : <span key={i}>{s.text}</span>);
  };

  if (!selectedProject) return <div><h1>Pre-Evaluation Data Cleaning</h1><div className="empty-state" style={{ marginTop: 40 }}><p>No project selected.</p></div></div>;

  const noData = textBlocks.length === 0 && allImages.length === 0 && allTables.length === 0;

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* ── HEADER ── */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem' }}>Review & Correct</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Review extracted data, mask PII, correct OCR errors.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* View mode tabs */}
          <div className="review-view-tabs">
            {['text', 'image'].map(m => (
              <button key={m} className={`review-view-tab ${viewMode === m ? 'active' : ''}`} onClick={() => setViewMode(m)}>
                {m === 'text' ? <><Edit3 size={14} className="inline-icon"/> Text</> : <><Image size={14} className="inline-icon"/> Images</>}
              </button>
            ))}
          </div>
          {/* Mask toggle */}
          <button className={`mask-toggle ${maskEnabled ? 'on' : 'off'}`} onClick={handleMaskToggle}>
            {maskEnabled ? <><Lock size={14} className="inline-icon"/> Mask ON</> : <><Eye size={14} className="inline-icon"/> Mask OFF</>}
          </button>
        </div>
      </div>

      {/* ── DOCUMENT SELECTORS ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', flexShrink: 0, fontSize: '0.78rem' }}>
        {((!isSandbox && selectedProject.tenderDocuments?.length > 0) || isSandbox) && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>TENDER:</span>
            {isSandbox ? (
              <button className={`btn btn-sm ${activeViewType === 'tender' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setActiveViewType('tender'); setActiveTenderDoc(0); }}>Sandbox</button>
            ) : selectedProject.tenderDocuments.map((doc, i) => (
              <button key={doc.id} className={`btn btn-sm ${activeViewType === 'tender' && activeTenderDoc === i ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setActiveViewType('tender'); setActiveTenderDoc(i); }}>{doc.type || `Doc ${i + 1}`}</button>
            ))}
          </div>
        )}
        {/* Render Manual Bidders OR Sandbox Bidders */}
        {((isSandbox && selectedProject.sandboxData?.bidders?.length > 0) || (!isSandbox && selectedProject.bidders?.length > 0)) && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 12 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>BIDDER:</span>
            {(isSandbox ? selectedProject.sandboxData.bidders : selectedProject.bidders).map(b => {
              const bId = isSandbox ? (b.ubid || b._ubid) : b.id;
              const bName = b.name || b.company_name || 'Unknown';
              return (
                <button key={bId} className={`btn btn-sm ${activeViewType === 'bidder' && (activeBidderId || (isSandbox ? selectedProject.sandboxData.bidders[0]?.ubid : selectedProject.bidders[0]?.id)) === bId ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setActiveViewType('bidder'); setActiveBidderId(bId); }}>
                  {bName.length > 15 ? bName.slice(0, 15) + '…' : bName}
                </button>
              );
            })}
          </div>
        )}
      </div>



      {/* ── THREE PANEL LAYOUT ── */}
      <div style={{ display: 'grid', gridTemplateColumns: showOriginal ? '1fr 1.2fr 320px' : '1fr 320px', gap: 12, flex: 1, minHeight: 0, transition: 'grid-template-columns 0.2s ease' }}>

        {/* LEFT — Original Document */}
        {showOriginal && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-header" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.85rem', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}><FileText size={16} /> Original</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {fileUrl && <button className="btn btn-sm btn-secondary" onClick={handleFullscreen} title="Open in new tab">⛶</button>}
              <button className="btn btn-sm btn-secondary" onClick={() => setShowOriginal(false)} title="Hide Panel">◀</button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-primary)', padding: viewMode === 'image' ? 12 : 0 }}>
            {viewMode === 'image' ? (
              /* Image mode: show extracted image grid */
              allImages.length > 0 ? (
                <div className="image-grid">
                  {allImages.map((img, i) => (
                    <div key={i} className={`image-card ${selectedImageIdx === i ? 'selected' : ''}`} onClick={() => setSelectedImageIdx(i)}>
                      <img src={img.image_url || ''} alt={img.image_ref} onError={e => { e.target.style.display = 'none'; }} />
                      <div className="label">
                        Page {img.pageNum} · #{img.index}
                        {img.image_url && <a href={img.image_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, color: 'var(--accent)', textDecoration: 'none' }} title="Open original image from Firebase">⛶</a>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state" style={{ border: 'none', marginTop: 40 }}><p>No images found in extraction.</p></div>
            ) : (
              /* Text/Table mode: show original PDF */
              isSandbox ? (
                <div style={{ padding: 16, fontFamily: 'monospace', fontSize: '0.78rem', whiteSpace: 'pre-wrap', color: '#cbd5e1', background: '#1e293b', height: '100%', overflow: 'auto' }}>
                  {JSON.stringify(activeViewType === 'tender' ? selectedProject.sandboxData?.tender : activeBidder, null, 2)}
                </div>
              ) : fileUrl ? (
                <iframe src={`${fileUrl}#toolbar=0`} style={{ width: '100%', height: '100%', border: 'none' }} title="Original" />
              ) : (
                <div className="empty-state" style={{ border: 'none', marginTop: 40 }}><p>No preview — file lost after reload. Re-upload to view.</p></div>
              )
            )}
          </div>
        </div>
        )}

        {/* CENTER — Extracted Data */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }} ref={centerRef}>
          <div className="card-header" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!showOriginal && (
                <button className="btn btn-sm btn-primary" onClick={() => setShowOriginal(true)} style={{ padding: '4px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Play size={12} className="inline-icon"/> Show Original
                </button>
              )}
              <h3 style={{ fontSize: '0.85rem', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>{viewMode === 'text' ? <><BarChart2 size={16} /> Extracted Text</> : <><Search size={16} /> Image OCR Text</>}</h3>
            </div>
          </div>
          <div style={{ flex: 1, padding: 14, overflowY: 'auto', background: 'var(--bg-primary)' }} onMouseUp={handleMouseUp}>

            {noData && <div className="empty-state" style={{ border: 'none', marginTop: 40 }}><p>No extraction data. Run extraction from Upload page.</p></div>}

            {/* TEXT VIEW */}
            {viewMode === 'text' && textBlocks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {textBlocks.map((block, idx) => {
                  const display = corrections[idx] || block;
                  const linked = links[idx];
                  return (
                    <div key={idx} data-block-idx={idx} className={`ext-block ${selectedBlockIdx === idx ? 'selected' : ''}`} onClick={() => handleSelectBlock(idx)}>
                      {linked && <span style={{ fontSize: '0.6rem', background: '#fef3c7', color: '#b45309', padding: '1px 5px', borderRadius: 3, fontWeight: 600, marginRight: 6, display: 'inline-flex', alignItems: 'center', gap: '2px' }}><LinkIcon size={10} className="inline-icon"/> {linked}</span>}
                      {corrections[idx] !== undefined && <span style={{ fontSize: '0.6rem', background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: 3, fontWeight: 600, marginRight: 6 }}>EDITED</span>}
                      {renderMasked(display)}
                    </div>
                  );
                })}
              </div>
            )}

            {/* IMAGE VIEW */}
            {viewMode === 'image' && (
              selectedImageIdx !== null && allImages[selectedImageIdx] ? (
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>OCR text from Page {allImages[selectedImageIdx].pageNum}, Image #{allImages[selectedImageIdx].index}</p>
                  <div className="ext-block" data-block-idx={selectedImageIdx}>{renderMasked(pages.find(p => p.page_num === allImages[selectedImageIdx].pageNum)?.ocr_text || pages.find(p => p.page_num === allImages[selectedImageIdx].pageNum)?.text || 'No OCR text for this image.')}</div>
                </div>
              ) : <div className="empty-state" style={{ border: 'none', marginTop: 40 }}><p>Select an image from the left panel.</p></div>
            )}


            {/* SELECTION POPUP */}
            {popup && (
              <div className="selection-popup" style={{ left: popup.x, top: popup.y, transform: 'translate(-50%, -100%)' }}>
                <button onClick={() => setMaskPicker({ x: popup.x, y: popup.y - 40, text: popup.text })} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Shield size={14} className="inline-icon"/> Mask</button>
                <button onClick={handleLinkFromPopup} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><LinkIcon size={14} className="inline-icon"/> Link</button>
                <button onClick={handleEditFromPopup} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Edit2 size={14} className="inline-icon"/> Edit</button>
              </div>
            )}

            {/* MASK TYPE PICKER */}
            {maskPicker && (
              <div className="mask-type-picker" style={{ left: maskPicker.x, top: maskPicker.y, transform: 'translate(-50%, -100%)' }} onMouseUp={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 10px', borderBottom: '1px solid var(--border-color)', marginBottom: 4 }}>Mask "{maskPicker.text.length > 20 ? maskPicker.text.slice(0, 20) + '…' : maskPicker.text}" as:</div>
                {MASK_TYPES.map(mt => <button key={mt.id} onClick={() => handleMaskSelect(mt.id)}>{mt.label} <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{mt.example}</span></button>)}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Action Panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-header" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '10px 14px' }}>
            <h3 style={{ fontSize: '0.85rem', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}><Settings size={16} /> Actions</h3>
          </div>
          <div style={{ flex: 1, padding: 14, overflowY: 'auto', background: 'var(--bg-primary)' }}>

            <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', border: '1px dashed var(--accent)', color: 'var(--accent)', background: 'var(--accent-light)' }} onClick={handleAutoMask}>
              <Sparkles size={16} /> Auto-Detect PII
            </button>
            <div style={{ padding: '8px 10px', background: 'var(--review-bg)', border: '1px solid var(--review)', borderRadius: 4, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--review)', display: 'flex', gap: 6 }}>
                <span><AlertTriangle size={16} className="text-warning" /></span>
                <span><strong>Disclaimer:</strong> Only personal information (PII) should be masked. If you mask other data (like financial numbers or dates), the AI cannot see the data and will be forced to return a <strong>REVIEW REQUIRED</strong> verdict.</span>
              </p>
            </div>

            {/* Mask summary */}
            {Object.keys(manualMasks).length > 0 && (
              <div style={{ marginBottom: 14, padding: 10, background: 'var(--pii-bg)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(124,58,237,0.15)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--pii-token)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: '4px' }}><Shield size={14} className="inline-icon" /> Active Masks ({Object.keys(manualMasks).length})</div>
                {Object.entries(manualMasks).map(([orig, info]) => (
                  <div 
                    key={orig} 
                    style={{ fontSize: '0.72rem', display: 'flex', justifyContent: 'space-between', padding: '4px 6px', margin: '2px 0', cursor: 'pointer', borderRadius: 4, transition: 'background 0.2s' }}
                    onClick={() => handleScrollToMask(orig)}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(124,58,237,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Click to locate in text"
                  >
                    <span className="pii-token">{info.token}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{maskEnabled ? '●●●●' : orig.length > 16 ? orig.slice(0, 16) + '…' : orig}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Edit panel when block selected */}
            {selectedBlockIdx !== null && viewMode === 'text' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label>Edit Block #{selectedBlockIdx + 1}</label>
                  <textarea className="input" value={correctionValue} onChange={e => setCorrectionValue(e.target.value)} style={{ minHeight: 100, resize: 'vertical', fontSize: '0.82rem' }} />
                  {corrections[selectedBlockIdx] !== undefined && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6, padding: 6, background: '#f8fafc', borderRadius: 4 }}><strong>Original:</strong> {textBlocks[selectedBlockIdx]?.slice(0, 120)}</div>
                  )}
                </div>
                <button className="btn btn-primary" onClick={handleSaveCorrection} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>{saveStatus === 'success' ? <><CheckCircle size={16} className="inline-icon"/> Saved</> : <><Save size={16} className="inline-icon"/> Save</>}</button>
                <hr style={{ border: 0, borderTop: '1px solid var(--border-color)' }} />
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><LinkIcon size={16} /> Link to Criterion</label>
                  <select className="input" value={links[selectedBlockIdx] || ''} onChange={e => handleLinkCriterion(e.target.value)}>
                    <option value="">-- No link --</option>
                    {criteria.map(c => <option key={c.criterion_id} value={c.criterion_id}>{c.criterion_id}: {c.name}</option>)}
                  </select>
                </div>
              </div>
            ) : selectedTableIdx !== null && viewMode === 'table' ? (
              <div>
                <p style={{ fontSize: '0.8rem', fontWeight: 600 }}>Table #{selectedTableIdx + 1}</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Page {allTables[selectedTableIdx]?.pageNum || allTables[selectedTableIdx]?.page}</p>
                <div style={{ marginTop: 10, fontSize: '0.78rem', whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 10, borderRadius: 'var(--radius-sm)', maxHeight: 300, overflow: 'auto' }}>
                  {allTables[selectedTableIdx]?.text || 'No text'}
                </div>
              </div>
            ) : (
              <div className="empty-state" style={{ border: 'none', marginTop: 20 }}>
                <p>{viewMode === 'text' ? 'Select a text block or drag-select text to edit or mask.' : viewMode === 'image' ? 'Select an image from the left panel.' : 'Click a table to view details.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
