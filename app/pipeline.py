"""
Pipeline Orchestrator — connects Ingestion → LLM → Rule Engine → Structured Output.
This module is designed to be called from both CLI and the FastAPI endpoint.

Pipeline Steps:
  Step 0: PII Masking        → Mask sensitive identifiers before LLM calls
  Step 1: Tender Analyzer    → Extract criteria from tender document
  Step 2: Bidder Parser      → Extract evidence from bidder document (with built-in field mapping)
  Step 3: Field Mapping      → LLM semantic fallback for unmatched criteria
  Step 4: Final Evaluation   → LLM-based verdict (second opinion on top of rule engine)
  Step 5: Verification       → GSTIN/PAN format validation
  Step 6: Vigilance Engine   → Error + anomaly + fraud pattern detection
"""
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple

if __package__ is None or __package__ == "":
    # Allow running as: python app/pipeline.py
    sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.llm.client import call_llm, clear_error_log, get_error_log, get_provider, get_context_size
from app.llm.prompts import (
    TENDER_ANALYZER_PROMPT,
    BIDDER_PARSER_PROMPT,
    FIELD_MAPPING_PROMPT,
    FINAL_EVALUATION_PROMPT,
    ERROR_DETECTION_PROMPT
)
from app.models.schemas import (
    TenderCriteriaList,
    BidderEvidenceList,
    FieldMappingList,
    FinalEvaluationReport,
    ErrorDetectionReport
)
from app.ingestion.pdf import extract_pdf_text, extract_pdf_package, load_text
from app.engine.rules import evaluate
from app.engine.pii import PIIMasker
from app.engine.verify import verify_identifiers_from_evidence


def _normalize_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().lower()

def clean_ocr_text_conditionally(text: str) -> Tuple[str, bool, float]:
    """
    Checks if text needs OCR cleaning (e.g., contains Hindi characters).
    If so, calls LLM to clean it. Returns (cleaned_text, was_cleaned, duration).
    """
    start = time.time()
    # Detect Hindi characters (Devanagari block)
    if not text or not re.search(r'[\u0900-\u097F]', text):
        return text, False, 0.0
    
    print("[PIPELINE]   Detected Hindi/Mixed text — running OCR cleaner...")
    try:
        from app.llm.prompts import HINGLISH_OCR_CLEANING_PROMPT
        from app.models.schemas import OCRCleanResult
        
        prompt = HINGLISH_OCR_CLEANING_PROMPT.replace("{ocr_text}", text)
        result = call_llm(prompt, OCRCleanResult)
        
        if result and result.cleaned_text:
            duration = round(time.time() - start, 2)
            return result.cleaned_text, True, duration
    except Exception as e:
        print(f"[PIPELINE]   OCR cleaning failed: {e}")
        traceback.print_exc()
        
    return text, False, round(time.time() - start, 2)


def _infer_source_type(snippet: Optional[str], source_text: str) -> str:
    normalized_snippet = _normalize_text(snippet)
    if not normalized_snippet:
        return "PyMuPDF"

    normalized_source = _normalize_text(source_text)
    match_index = normalized_source.find(normalized_snippet)
    if match_index < 0:
        # Relaxed fallback: search on a shorter phrase when the snippet is long.
        parts = normalized_snippet.split()
        if len(parts) > 8:
            shortened = " ".join(parts[:8])
            match_index = normalized_source.find(shortened)
            normalized_snippet = shortened if match_index >= 0 else normalized_snippet

    if match_index < 0:
        return "PyMuPDF"

    prefix = normalized_source[max(0, match_index - 250):match_index]
    if "table data" in prefix or "table (page" in prefix:
        return "TABLE"
    if "image data" in prefix or "image (page" in prefix:
        return "IMAGE"
    if "ocr" in prefix:
        return "OCR"
    if "scanned" in prefix:
        return "OCR"
    return "PyMuPDF"


def _annotate_source_metadata(items: List[Dict[str, Any]], source_text: str) -> List[Dict[str, Any]]:
    annotated: List[Dict[str, Any]] = []
    for item in items:
        cloned = dict(item)
        source = dict(cloned.get("source") or {})
        source.setdefault("source_type", _infer_source_type(source.get("raw_snippet"), source_text))
        cloned["source"] = source
        annotated.append(cloned)
    return annotated


def _build_hybrid_context(text: str, package: Optional[Dict[str, Any]] = None) -> str:
    if package and package.get("context_text"):
        return package["context_text"]
    return text


def _find_unmatched_criteria(criteria: List[Dict[str, Any]], evidence: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Find criteria that have no matching evidence (extracted_value is None or missing)."""
    evidence_map = {ev.get("criterion_id"): ev for ev in evidence}
    unmatched = []
    for c in criteria:
        cid = c.get("criterion_id")
        ev = evidence_map.get(cid)
        if ev is None or ev.get("extracted_value") is None:
            unmatched.append(c)
    return unmatched


def run_pipeline_from_text(tender_text: str, bidder_text: str, bidder_filename: str = "uploaded_document") -> Dict[str, Any]:
    """
    Core pipeline logic that accepts raw text strings.
    Returns a structured dict suitable for JSON serialization to the frontend.

    Pipeline Steps:
      0. PII Masking        → Mask sensitive data before LLM calls
      1. Tender Analyzer    → Extract criteria
      2. Bidder Parser      → Extract evidence + inline field mapping
      3. Field Mapping      → LLM semantic fallback for unmatched criteria
      4. Final Evaluation   → LLM-based verdict
      5. Verification       → GSTIN/PAN format validation
      6. Vigilance Engine   → Error + anomaly detection
    """
    # Clear previous error log
    clear_error_log()

    response: Dict[str, Any] = {
        "status": "success",
        "provider": get_provider(),
        "criteria": [],
        "evidence": [],
        "evaluation": [],
        "final_evaluation": [],
        "field_mappings": [],
        "verification": [],
        "pii_masking": {
            "enabled": True,
            "mappings": [],
            "masked_fields_count": 0
        },
        "issues": [],
        "errors": [],
        "error_details": [],
        "pipeline_steps": []
    }

    if not tender_text or not bidder_text:
        response["status"] = "error"
        response["errors"].append("One or both documents were empty or could not be read.")
        return response

    # ══════════════════════════════════════════════
    #  PRE-STEP: OCR Post-Processing (Conditional)
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ PRE-STEP: Conditional OCR Cleaning... ═══")
    pre_start = time.time()
    clean_tender_text, tender_cleaned, t_time = clean_ocr_text_conditionally(tender_text)
    clean_bidder_text, bidder_cleaned, b_time = clean_ocr_text_conditionally(bidder_text)
    
    if tender_cleaned or bidder_cleaned:
        total_clean_time = round(t_time + b_time, 2)
        response["pipeline_steps"].append({
            "step": 0.5,
            "name": "OCR Cleaning",
            "description": "Clean raw OCR text containing Hindi/Hinglish",
            "status": "success",
            "duration_seconds": total_clean_time,
            "output_count": int(tender_cleaned) + int(bidder_cleaned)
        })
        print(f"[PIPELINE] ✅ Pre-Step complete — text cleaned ({total_clean_time}s)")
        # Override the text with cleaned text
        tender_text = clean_tender_text
        bidder_text = clean_bidder_text
    else:
        print("[PIPELINE] ✅ Pre-Step skipped — no Hindi text detected.")

    # ══════════════════════════════════════════════
    #  STEP 0: PII Masking
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ STEP 0/7: PII Masking... ═══")
    step0_start = time.time()
    
    from app.services.pii_service import get_pii_service
    pii_service = get_pii_service()
    
    # Generate a unique session ID for this pipeline run
    import hashlib as _hl
    _input_hash = _hl.sha256((tender_text + bidder_text).encode()).hexdigest()[:12]
    pii_session_id = f"pipeline-{_input_hash}"
    
    masked_tender_text, _ = pii_service.mask_for_llm(tender_text, session_id=pii_session_id)
    masked_bidder_text, _ = pii_service.mask_for_llm(bidder_text, session_id=pii_session_id)
    
    # Get masking stats (safe — no originals exposed)
    pii_stats = pii_service.get_stats(session_id=pii_session_id)
    masker = pii_service.get_masker(session_id=pii_session_id)
    pii_mappings = masker.get_mapping_list()
    
    step0_time = round(time.time() - step0_start, 2)
    
    # Response includes tokens + types only (NO originals in API response)
    response["pii_masking"] = {
        "enabled": True,
        "session_id": pii_session_id,
        "masked_fields_count": pii_stats["total_tokens"],
        "by_type": pii_stats["by_type"],
        "tokens": pii_service.get_mapping_masked(session_id=pii_session_id),
    }
    response["pipeline_steps"].append({
        "step": 0,
        "name": "PII Masking",
        "description": "Mask sensitive identifiers before LLM processing",
        "status": "success",
        "duration_seconds": step0_time,
        "output_count": pii_stats["total_tokens"]
    })
    print(f"[PIPELINE] ✅ Step 0 complete — {pii_stats['total_tokens']} fields masked ({step0_time}s)")
    if pii_mappings:
        for pm in pii_mappings:
            print(f"[PIPELINE]   🔒 {pm['type']}: {pm['original'][:20]}... → {pm['token']}")

    # COMPLIANCE: Send MASKED text to LLM — no raw PII must reach the AI
    # The rule engine will use unmasked values for numeric comparison later
    llm_tender_text = masked_tender_text
    llm_bidder_text = masked_bidder_text

    # ══════════════════════════════════════════════
    #  STEP 1: Tender Criteria Extraction
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ STEP 1/7: Extracting tender criteria... ═══")
    step1_start = time.time()
    context_size_chars = get_context_size() * 4
    try:
        if len(llm_tender_text) > context_size_chars:
            print(f"[PIPELINE]   Tender text exceeds context size ({len(llm_tender_text)} chars > {context_size_chars}). Auto-chunking...")
            chunks = [llm_tender_text[i:i+context_size_chars] for i in range(0, len(llm_tender_text), context_size_chars)]
            all_criteria = []
            for i, chunk in enumerate(chunks):
                print(f"[PIPELINE]   Processing chunk {i+1}/{len(chunks)}...")
                prompt = TENDER_ANALYZER_PROMPT.replace("{tender_text}", chunk)
                chunk_result = call_llm(prompt, TenderCriteriaList)
                if chunk_result and chunk_result.criteria:
                    all_criteria.extend(chunk_result.criteria)
            criteria_result = TenderCriteriaList(criteria=all_criteria)
        else:
            prompt = TENDER_ANALYZER_PROMPT.replace("{tender_text}", llm_tender_text)
            criteria_result = call_llm(prompt, TenderCriteriaList)
    except Exception as e:
        criteria_result = None
        response["errors"].append(f"Tender analysis LLM call failed: {e}")
        traceback.print_exc()

    step1_time = round(time.time() - step1_start, 2)
    response["pipeline_steps"].append({
        "step": 1,
        "name": "Tender Analyzer",
        "description": "Extract eligibility criteria from tender document",
        "status": "success" if criteria_result else "failed",
        "duration_seconds": step1_time,
        "output_count": len(criteria_result.model_dump().get("criteria", [])) if criteria_result else 0
    })

    if not criteria_result:
        response["status"] = "error"
        # Merge the detailed error log from the LLM client
        detailed_errors = get_error_log()
        if detailed_errors:
            response["error_details"] = detailed_errors
            response["errors"].append("All AI providers failed. See details below.")
        else:
            response["errors"].append("Could not extract criteria from tender document after retries.")
        return response

    criteria_data = criteria_result.model_dump()
    criteria_data["criteria"] = _annotate_source_metadata(criteria_data.get("criteria", []), tender_text)
    response["criteria"] = criteria_data["criteria"]
    print(f"[PIPELINE] ✅ Step 1 complete — {len(response['criteria'])} criteria extracted ({step1_time}s)")

    # ══════════════════════════════════════════════
    #  STEP 2: Bidder Evidence Extraction
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ STEP 2/7: Parsing bidder evidence... ═══")
    step2_start = time.time()
    try:
        criteria_json = criteria_result.model_dump_json()
        if len(llm_bidder_text) > context_size_chars:
            print(f"[PIPELINE]   Bidder text exceeds context size ({len(llm_bidder_text)} chars > {context_size_chars}). Auto-chunking...")
            chunks = [llm_bidder_text[i:i+context_size_chars] for i in range(0, len(llm_bidder_text), context_size_chars)]
            all_evidence = []
            for i, chunk in enumerate(chunks):
                print(f"[PIPELINE]   Processing chunk {i+1}/{len(chunks)}...")
                prompt = BIDDER_PARSER_PROMPT.replace("{criteria_json}", criteria_json).replace("{bidder_text}", chunk)
                chunk_result = call_llm(prompt, BidderEvidenceList)
                if chunk_result and chunk_result.evidence:
                    all_evidence.extend(chunk_result.evidence)
            # Remove duplicate criterion evidence by keeping the one with best confidence or first match
            unique_evidence = {}
            for ev in all_evidence:
                cid = ev.criterion_id
                if cid not in unique_evidence or (unique_evidence[cid].confidence == "LOW" and ev.confidence in ["HIGH", "MEDIUM"]):
                    unique_evidence[cid] = ev
            evidence_result = BidderEvidenceList(evidence=list(unique_evidence.values()))
        else:
            prompt = BIDDER_PARSER_PROMPT.replace("{criteria_json}", criteria_json).replace("{bidder_text}", llm_bidder_text)
            evidence_result = call_llm(prompt, BidderEvidenceList)
    except Exception as e:
        evidence_result = None
        response["errors"].append(f"Bidder parsing LLM call failed: {e}")
        traceback.print_exc()

    step2_time = round(time.time() - step2_start, 2)

    if not evidence_result:
        response["status"] = "partial"
        response["errors"].append("Could not parse bidder evidence. Evaluation will be incomplete.")
        # Still continue — we can mark all as REVIEW
        evidence_data = {"evidence": []}
    else:
        evidence_data = evidence_result.model_dump()

    evidence_data["evidence"] = _annotate_source_metadata(evidence_data.get("evidence", []), bidder_text)
    response["evidence"] = evidence_data["evidence"]
    
    response["pipeline_steps"].append({
        "step": 2,
        "name": "Bidder Parser",
        "description": "Extract evidence from bidder document with field mapping",
        "status": "success" if evidence_result else "failed",
        "duration_seconds": step2_time,
        "output_count": len(response["evidence"])
    })
    print(f"[PIPELINE] ✅ Step 2 complete — {len(response['evidence'])} evidence items ({step2_time}s)")

    # ══════════════════════════════════════════════
    #  STEP 3: Field Mapping (Fallback for Unmatched)
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ STEP 3/7: Field mapping for unmatched criteria... ═══")
    step3_start = time.time()
    unmatched = _find_unmatched_criteria(criteria_data["criteria"], evidence_data["evidence"])
    field_mappings_data = []

    if unmatched:
        print(f"[PIPELINE]   {len(unmatched)} criteria have no evidence — running field mapping LLM...")
        try:
            unmatched_json = json.dumps(unmatched, indent=2)
            prompt = FIELD_MAPPING_PROMPT.replace("{unmatched_criteria}", unmatched_json).replace("{document_text}", llm_bidder_text)
            mapping_result = call_llm(prompt, FieldMappingList)
            if mapping_result:
                field_mappings_data = mapping_result.model_dump().get("mappings", [])
                print(f"[PIPELINE]   Found {len(field_mappings_data)} field mappings")
        except Exception as e:
            response["errors"].append(f"Field mapping step failed (non-critical): {e}")
            traceback.print_exc()
    else:
        print("[PIPELINE]   All criteria matched — skipping field mapping")

    step3_time = round(time.time() - step3_start, 2)
    response["field_mappings"] = field_mappings_data
    response["pipeline_steps"].append({
        "step": 3,
        "name": "Field Mapping",
        "description": "Semantic matching for unmatched criteria",
        "status": "skipped" if not unmatched else ("success" if field_mappings_data else "no_matches"),
        "duration_seconds": step3_time,
        "output_count": len(field_mappings_data),
        "unmatched_count": len(unmatched)
    })
    print(f"[PIPELINE] ✅ Step 3 complete — {len(field_mappings_data)} mappings ({step3_time}s)")

    # ── Deterministic Rule Engine (between Step 3 and Step 4) ──
    print("\n[PIPELINE]   Running deterministic rule engine...")
    evaluation_results = evaluate(criteria_data["criteria"], evidence_data["evidence"])
    response["evaluation"] = evaluation_results
    print(f"[PIPELINE]   Evaluated {len(evaluation_results)} criteria")

    # ══════════════════════════════════════════════
    #  STEP 4: Final Evaluation (LLM-based)
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ STEP 4/7: Running LLM-based final evaluation... ═══")
    step4_start = time.time()
    final_eval_data = []
    try:
        prompt = FINAL_EVALUATION_PROMPT.replace(
            "{current_date}", datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ).replace(
            "{criteria_data}", json.dumps(criteria_data, indent=2)
        ).replace(
            "{evidence_data}", json.dumps(evidence_data, indent=2)
        ).replace(
            "{rule_engine_results}", json.dumps(evaluation_results, indent=2)
        )
        final_eval_result = call_llm(prompt, FinalEvaluationReport)
        if final_eval_result:
            final_eval_data = final_eval_result.model_dump().get("evaluations", [])
    except Exception as e:
        response["errors"].append(f"Final evaluation step failed (non-critical): {e}")
        traceback.print_exc()

    step4_time = round(time.time() - step4_start, 2)
    response["final_evaluation"] = final_eval_data
    response["pipeline_steps"].append({
        "step": 4,
        "name": "Final Evaluation",
        "description": "LLM-based verdict with confidence and reasoning",
        "status": "success" if final_eval_data else "failed",
        "duration_seconds": step4_time,
        "output_count": len(final_eval_data)
    })
    print(f"[PIPELINE] ✅ Step 4 complete — {len(final_eval_data)} evaluations ({step4_time}s)")

    # ══════════════════════════════════════════════
    #  STEP 5: Verification Layer (GSTIN / PAN)
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ STEP 5/7: Running identifier verification... ═══")
    step5_start = time.time()
    verification_results = []
    try:
        verification_results = verify_identifiers_from_evidence(evidence_data["evidence"])
    except Exception as e:
        response["errors"].append(f"Verification step failed (non-critical): {e}")
        traceback.print_exc()

    step5_time = round(time.time() - step5_start, 2)
    response["verification"] = verification_results
    response["pipeline_steps"].append({
        "step": 5,
        "name": "Verification",
        "description": "GSTIN/PAN format validation and metadata extraction",
        "status": "success" if verification_results else "no_identifiers",
        "duration_seconds": step5_time,
        "output_count": len(verification_results)
    })
    print(f"[PIPELINE] ✅ Step 5 complete — {len(verification_results)} identifiers verified ({step5_time}s)")
    for vr in verification_results:
        status_icon = "✅" if vr["status"] == "FORMAT_VALID" else ("❌" if vr["status"] == "INVALID_FORMAT" else "❓")
        print(f"[PIPELINE]   {status_icon} {vr['identifier_type']}: {vr['identifier'][:15]}... → {vr['status']}")

    # ══════════════════════════════════════════════
    #  STEP 6: Vigilance / Error Detection
    # ══════════════════════════════════════════════
    print("\n[PIPELINE] ═══ STEP 6/7: Running vigilance detection... ═══")
    step6_start = time.time()
    try:
        combined = {
            "tender_criteria": criteria_data,
            "bidder_evidence": evidence_data,
            "evaluation_results": evaluation_results,
            "final_evaluation": final_eval_data,
            "field_mappings": field_mappings_data,
            "verification": verification_results
        }
        prompt = ERROR_DETECTION_PROMPT.replace("{extracted_data}", json.dumps(combined, indent=2))
        error_result = call_llm(prompt, ErrorDetectionReport)
        if error_result:
            response["issues"] = error_result.model_dump()["issues"]
    except Exception as e:
        response["errors"].append(f"Vigilance detection step failed (non-critical): {e}")
        traceback.print_exc()

    step6_time = round(time.time() - step6_start, 2)
    response["pipeline_steps"].append({
        "step": 6,
        "name": "Vigilance Detection",
        "description": "Error, anomaly, and suspicious pattern detection",
        "status": "success" if response["issues"] is not None else "failed",
        "duration_seconds": step6_time,
        "output_count": len(response.get("issues", []))
    })

    total_time = round(step0_time + step1_time + step2_time + step3_time + step4_time + step5_time + step6_time, 2)
    print(f"\n[PIPELINE] ✅ Pipeline complete — 7 steps in {total_time}s")
    return response


def run_pipeline_with_criteria(
    tender_text: str,
    bidder_text: str,
    pre_criteria: List[Dict[str, Any]],
    bidder_filename: str = "uploaded_document"
) -> Dict[str, Any]:
    """
    Optimized pipeline that skips Step 1 (tender analysis) using pre-extracted criteria.
    Saves ~40% time per additional bidder in consolidated evaluation.
    """
    clear_error_log()

    response: Dict[str, Any] = {
        "status": "success",
        "provider": get_provider(),
        "criteria": pre_criteria,
        "evidence": [],
        "evaluation": [],
        "final_evaluation": [],
        "field_mappings": [],
        "verification": [],
        "pii_masking": {"enabled": True, "mappings": [], "masked_fields_count": 0},
        "issues": [],
        "errors": [],
        "error_details": [],
        "pipeline_steps": []
    }

    if not bidder_text:
        response["status"] = "error"
        response["errors"].append("Bidder document text is empty.")
        return response

    # ── PRE-STEP: OCR Cleaning ──
    clean_bidder_text, bidder_cleaned, b_time = clean_ocr_text_conditionally(bidder_text)
    if bidder_cleaned:
        bidder_text = clean_bidder_text

    # ── STEP 0: PII Masking ──
    step0_start = time.time()
    from app.services.pii_service import get_pii_service
    pii_service = get_pii_service()
    import hashlib as _hl
    _input_hash = _hl.sha256(bidder_text.encode()).hexdigest()[:12]
    pii_session_id = f"pipeline-{_input_hash}"
    masked_bidder_text, _ = pii_service.mask_for_llm(bidder_text, session_id=pii_session_id)
    pii_stats = pii_service.get_stats(session_id=pii_session_id)
    step0_time = round(time.time() - step0_start, 2)
    response["pii_masking"] = {
        "enabled": True,
        "session_id": pii_session_id,
        "masked_fields_count": pii_stats["total_tokens"],
        "by_type": pii_stats["by_type"],
    }
    response["pipeline_steps"].append({
        "step": 0, "name": "PII Masking",
        "status": "success", "duration_seconds": step0_time,
        "output_count": pii_stats["total_tokens"]
    })

    # ── STEP 1: SKIPPED (using pre-extracted criteria) ──
    step1_time = 0.0
    response["pipeline_steps"].append({
        "step": 1, "name": "Tender Analyzer",
        "description": "Skipped — using pre-extracted criteria",
        "status": "skipped", "duration_seconds": 0.0,
        "output_count": len(pre_criteria)
    })
    print(f"[PIPELINE] ⏭ Step 1 skipped — reusing {len(pre_criteria)} pre-extracted criteria")

    # Build criteria object for downstream steps
    criteria_data = {"criteria": pre_criteria}

    # ── STEP 2: Bidder Evidence Extraction ──
    print("\n[PIPELINE] ═══ STEP 2/7: Parsing bidder evidence... ═══")
    step2_start = time.time()
    llm_bidder_text = masked_bidder_text
    try:
        criteria_json = json.dumps(pre_criteria, indent=2)
        prompt = BIDDER_PARSER_PROMPT.replace("{bidder_text}", llm_bidder_text).replace("{criteria_list}", criteria_json)
        evidence_result = call_llm(prompt, BidderEvidenceList)
    except Exception as e:
        evidence_result = None
        response["errors"].append(f"Bidder parsing failed: {e}")
        traceback.print_exc()

    step2_time = round(time.time() - step2_start, 2)
    evidence_data = evidence_result.model_dump() if evidence_result else {"evidence": []}
    evidence_data["evidence"] = _annotate_source_metadata(evidence_data.get("evidence", []), bidder_text)
    response["evidence"] = evidence_data["evidence"]
    response["pipeline_steps"].append({
        "step": 2, "name": "Bidder Parser",
        "status": "success" if evidence_result else "failed",
        "duration_seconds": step2_time,
        "output_count": len(response["evidence"])
    })

    # ── STEP 3: Field Mapping ──
    step3_start = time.time()
    unmatched = _find_unmatched_criteria(pre_criteria, evidence_data["evidence"])
    field_mappings_data = []
    if unmatched:
        try:
            prompt = FIELD_MAPPING_PROMPT.replace("{unmatched_criteria}", json.dumps(unmatched, indent=2)).replace("{document_text}", llm_bidder_text)
            mapping_result = call_llm(prompt, FieldMappingList)
            if mapping_result:
                field_mappings_data = mapping_result.model_dump().get("mappings", [])
        except Exception as e:
            response["errors"].append(f"Field mapping failed: {e}")
    step3_time = round(time.time() - step3_start, 2)
    response["field_mappings"] = field_mappings_data
    response["pipeline_steps"].append({
        "step": 3, "name": "Field Mapping",
        "status": "skipped" if not unmatched else "success",
        "duration_seconds": step3_time, "output_count": len(field_mappings_data)
    })

    # ── Rule Engine ──
    evaluation_results = evaluate(pre_criteria, evidence_data["evidence"])
    response["evaluation"] = evaluation_results

    # ── STEP 4: Final Evaluation ──
    step4_start = time.time()
    final_eval_data = []
    try:
        prompt = FINAL_EVALUATION_PROMPT.replace(
            "{current_date}", datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ).replace(
            "{criteria_data}", json.dumps(criteria_data, indent=2)
        ).replace(
            "{evidence_data}", json.dumps(evidence_data, indent=2)
        ).replace(
            "{rule_engine_results}", json.dumps(evaluation_results, indent=2)
        )
        final_eval_result = call_llm(prompt, FinalEvaluationReport)
        if final_eval_result:
            final_eval_data = final_eval_result.model_dump().get("evaluations", [])
    except Exception as e:
        response["errors"].append(f"Final evaluation failed: {e}")
    step4_time = round(time.time() - step4_start, 2)
    response["final_evaluation"] = final_eval_data
    response["pipeline_steps"].append({
        "step": 4, "name": "Final Evaluation",
        "status": "success" if final_eval_data else "failed",
        "duration_seconds": step4_time, "output_count": len(final_eval_data)
    })

    # ── STEP 5: Verification ──
    step5_start = time.time()
    response["verification"] = verify_identifiers_from_evidence(response["evidence"])
    step5_time = round(time.time() - step5_start, 2)
    response["pipeline_steps"].append({
        "step": 5, "name": "Verification",
        "status": "success", "duration_seconds": step5_time,
        "output_count": len(response["verification"])
    })

    # ── STEP 6: Vigilance ──
    step6_start = time.time()
    try:
        extracted_json = json.dumps({
            "criteria": pre_criteria,
            "evidence": response["evidence"],
            "evaluation": evaluation_results,
        }, indent=2)
        prompt = ERROR_DETECTION_PROMPT.replace("{extracted_data}", extracted_json)
        error_result = call_llm(prompt, ErrorDetectionReport)
        if error_result:
            response["issues"] = error_result.model_dump().get("issues", [])
    except Exception as e:
        response["errors"].append(f"Vigilance detection failed: {e}")
    step6_time = round(time.time() - step6_start, 2)
    response["pipeline_steps"].append({
        "step": 6, "name": "Vigilance Detection",
        "status": "success", "duration_seconds": step6_time,
        "output_count": len(response.get("issues", []))
    })

    total_time = round(step0_time + step2_time + step3_time + step4_time + step5_time + step6_time, 2)
    print(f"\n[PIPELINE] ✅ Pipeline (optimized) complete — {total_time}s")
    return response


def run_pipeline_from_paths(tender_path: str, bidder_path: str) -> Dict[str, Any]:
    """
    Convenience wrapper that accepts file paths, handles ingestion,
    then delegates to the core pipeline.
    """
    if tender_path.endswith('.pdf'):
        try:
            tender_text = extract_pdf_package(tender_path)["context_text"]
        except Exception:
            tender_text = extract_pdf_text(tender_path)
    else:
        tender_text = load_text(tender_path)

    if bidder_path.endswith('.pdf'):
        try:
            bidder_text = extract_pdf_package(bidder_path)["context_text"]
        except Exception:
            bidder_text = extract_pdf_text(bidder_path)
    else:
        bidder_text = load_text(bidder_path)

    return run_pipeline_from_text(tender_text, bidder_text, bidder_filename=os.path.basename(bidder_path))


# ── CLI Entry Point ──
if __name__ == "__main__":
    import os
    tender_file = "dummy_tender.txt"
    bidder_file = "dummy_bidder.txt"

    if not os.path.exists(tender_file):
        with open(tender_file, "w") as f:
            f.write(
                "[Page 1] Request for Proposal\n"
                "[Page 2] Eligibility Criteria:\n"
                "1. The bidder must have a minimum annual turnover of ₹5 crore.\n"
                "2. The bidder must possess a valid ISO 9001 certification.\n"
                "3. The bidder must have completed at least 3 similar projects in the last 5 years.\n"
                "4. The bidder must be registered under GST.\n"
                "5. The bidder must have a minimum net worth of ₹2 crore.\n"
            )
    if not os.path.exists(bidder_file):
        with open(bidder_file, "w") as f:
            f.write(
                "[Page 1] ABC Pvt Ltd Company Profile\n"
                "[Page 4] Total turnover for FY 2023-24 is ₹6.2 crore.\n"
                "[Page 5] ISO 9001 certification attached (valid till 2028).\n"
                "[Page 6] Completed 5 solar panel projects in the last 3 years.\n"
                "[Page 7] GST Registration Number: 27AABCA1234M1Z0\n"
                "[Page 8] Net worth as of March 2024: ₹1.8 crore.\n"
            )

    result = run_pipeline_from_paths(tender_file, bidder_file)

    print("\n" + "=" * 60)
    print("FINAL EVALUATION (DETERMINISTIC)")
    print("=" * 60)
    for r in result.get("evaluation", []):
        res = r['result']
        symbol = "✅" if res == "PASS" else ("❌" if res == "FAIL" else "⚠️")
        conf = r.get('confidence', '')
        print(f"  {symbol} {res} [{conf}]: {r['criteria_name']}")
        if r.get('reason'):
            print(f"     → {r['reason']}")
    
    print("\n" + "-" * 60)
    print("FINAL EVALUATION (LLM-BASED)")
    print("-" * 60)
    for fe in result.get("final_evaluation", []):
        verdict = fe.get('verdict', '')
        symbol = "✅" if verdict == "PASS" else ("❌" if verdict == "FAIL" else "⚠️")
        print(f"  {symbol} {verdict} [{fe.get('confidence', '')}]: {fe.get('criterion_id', '')}")
        print(f"     → {fe.get('reason', '')}")

    print("\n" + "-" * 60)
    print("PII MASKING")
    print("-" * 60)
    for pm in result.get("pii_masking", {}).get("mappings", []):
        print(f"  🔒 {pm['type']}: {pm['original']} → {pm['token']}")

    print("\n" + "-" * 60)
    print("VERIFICATION")
    print("-" * 60)
    for vr in result.get("verification", []):
        icon = "✅" if vr['status'] == 'FORMAT_VALID' else ("❌" if vr['status'] == 'INVALID_FORMAT' else "❓")
        print(f"  {icon} {vr['identifier_type']}: {vr['identifier']} → {vr['status']}")
        print(f"     → {vr.get('details', '')}")

    print("\n" + "-" * 60)
    print("FIELD MAPPINGS")
    print("-" * 60)
    for m in result.get("field_mappings", []):
        print(f"  🔗 {m['criterion_id']}: {m.get('matched_field', 'N/A')} (confidence: {m.get('mapping_confidence', 'N/A')})")
    
    print("\n" + "-" * 60)
    print("ISSUES / VIGILANCE")
    print("-" * 60)
    for issue in result.get("issues", []):
        sev = issue.get('severity', '')
        icon = "🔴" if sev == "HIGH" else ("🟡" if sev == "MEDIUM" else "🔵")
        print(f"  {icon} [{sev}] {issue['issue_type']}: {issue['reason']}")
    
    print("\n" + "-" * 60)
    print("PIPELINE STEPS")
    print("-" * 60)
    for step in result.get("pipeline_steps", []):
        status_icon = "✅" if step['status'] == 'success' else ("⏭" if step['status'] == 'skipped' else "❌")
        print(f"  {status_icon} Step {step['step']}: {step['name']} — {step['status']} ({step['duration_seconds']}s)")

    print("=" * 60)
