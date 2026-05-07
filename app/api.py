"""
FastAPI Backend for InferX Tender Evaluation System.
Serves the frontend and exposes the /evaluate endpoint.
"""
import os
import json
import tempfile
import shutil
import threading
import uuid
import time

from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from app.pipeline import run_pipeline_from_text, run_pipeline_with_criteria
from app.ingestion.pdf import (
    extract_pdf_package,
    extract_pdf_layout,
    extract_layout_text,
    extract_docx_package,
    extract_docx_text,
    extract_image_package,
    extract_image_layout,
    extract_image_layout_debug,
    extract_text_package,
    load_text,
    text_to_layout,
)
from app.llm.client import get_provider, set_provider
import app.llm.client as llm_client
from app.engine.export import (
    generate_pdf_report,
    generate_excel_report,
    generate_audit_json,
    generate_consolidated_pdf,
    build_audit_metadata
)
from app.adapters.sandbox_adapter import SandboxAdapter
from app.adapters.ubid import validate_ubid, parse_ubid
from app.services.audit_service import get_audit_service

app = FastAPI(
    title="InferX — AI Tender Evaluation",
    description="Government-grade document intelligence for CRPF tender evaluation.",
    version="2.0.0"
)

# ── CORS middleware for React frontend ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:3000",   # Alternate dev port
        "http://localhost:8000",   # Same-origin
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Shared instances ──
sandbox_adapter = SandboxAdapter()

# ── Async extraction job store ──
_extraction_jobs: dict = {}  # job_id → { status, progress, result, error, ... }

# ── Serve frontend static files ──
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "public")
IMAGES_DIR = os.path.join(STATIC_DIR, "images")
os.makedirs(IMAGES_DIR, exist_ok=True)


@app.get("/")
async def serve_index():
    """Serve the main HTML page."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="Frontend not found.")
    return FileResponse(index_path)


# Mount /static for any CSS/JS/image assets inside public/
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")


def _sanitize_extraction_package(package: dict) -> dict:
    """Remove heavy binary payloads from extraction data before returning API response."""
    clean_images = []
    for image in package.get("images", []):
        clean_image = dict(image)
        clean_image.pop("image_bytes_b64", None)
        clean_images.append(clean_image)

    return {
        "context_text": package.get("context_text", ""),
        "pages": package.get("pages", []),
        "tables": package.get("tables", []),
        "table_entries": package.get("table_entries", []),
        "images": clean_images,
    }


def _extract_document_payload(file_path: str, filename: str):
    ext = os.path.splitext((filename or "").lower())[1]

    if ext == ".pdf":
        package = extract_pdf_package(file_path)
        text = package.get("context_text", "")
        layout = extract_pdf_layout(file_path)
        layout_debug = extract_layout_text(file_path)
        return text, package, layout, layout_debug

    if ext == ".docx":
        text = extract_docx_text(file_path)
        package = extract_docx_package(file_path)
        layout = text_to_layout(text)
        layout_debug = [{"page": 1, "text": text or ""}]
        return text, package, layout, layout_debug

    if ext in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
        package = extract_image_package(file_path)
        text = package.get("context_text", "")
        layout = extract_image_layout(file_path)
        layout_debug = extract_image_layout_debug(file_path)
        return text, package, layout, layout_debug

    text = load_text(file_path)
    package = extract_text_package(text)
    layout = text_to_layout(text)
    layout_debug = [{"page": 1, "text": text or ""}]
    return text, package, layout, layout_debug


# ═══════════════════════════════════════════
#  SETTINGS API — Provider Switching
# ═══════════════════════════════════════════

class ProviderRequest(BaseModel):
    provider: str
    model: Optional[str] = None
    context_size: Optional[int] = None
    sandbox_api_url: Optional[str] = None
    sandbox_api_key: Optional[str] = None

@app.get("/api/settings")
async def get_settings():
    """Return current LLM provider setting and key status."""
    from dotenv import load_dotenv as _reload_env
    from app.llm.client import get_model, get_context_size
    _reload_env(override=True)
    return {
        "provider": get_provider(),
        "model": get_model(),
        "context_size": get_context_size(),
        "sandbox_api_url": os.getenv("SANDBOX_API_URL", ""),
        "sandbox_api_key": os.getenv("SANDBOX_API_KEY", ""),
        "available": ["openrouter", "gemini"],
        "keys": {
            "openrouter": bool(os.getenv("OPENROUTER_API_KEY")),
            "gemini": bool(os.getenv("GEMINI_API_KEY"))
        }
    }

@app.post("/api/settings")
async def update_settings(req: ProviderRequest):
    """Switch the active LLM provider and update sandbox config."""
    from app.llm.client import get_model, get_context_size
    
    # Update .env file for Sandbox keys
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            lines = f.readlines()
            
    def update_env(key, value):
        found = False
        for i in range(len(lines)):
            if lines[i].startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                found = True
                break
        if not found:
            lines.append(f"{key}={value}\n")

    if req.sandbox_api_url is not None:
        update_env("SANDBOX_API_URL", req.sandbox_api_url)
        os.environ["SANDBOX_API_URL"] = req.sandbox_api_url
    if req.sandbox_api_key is not None:
        update_env("SANDBOX_API_KEY", req.sandbox_api_key)
        os.environ["SANDBOX_API_KEY"] = req.sandbox_api_key

    if os.path.exists(env_path):
        with open(env_path, "w") as f:
            f.writelines(lines)

    try:
        set_provider(req.provider, model=req.model, context_size=req.context_size)
        return {"status": "ok", "provider": get_provider(), "model": get_model(), "context_size": get_context_size()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════
#  EVALUATE API
# ═══════════════════════════════════════════

@app.post("/evaluate")
async def evaluate_tender(
    tender: UploadFile = File(..., description="Tender document (PDF or TXT)"),
    bidder: UploadFile = File(..., description="Bidder document (PDF or TXT)")
):
    """
    Accepts uploaded tender and bidder documents, runs the full AI pipeline,
    and returns structured evaluation results as JSON.
    """
    # Validate filenames
    if not tender.filename:
        raise HTTPException(status_code=400, detail="Tender filename is missing.")
    if not bidder.filename:
        raise HTTPException(status_code=400, detail="Bidder filename is missing.")
    
    # Create a workspace directory inside the project (not /tmp)
    workspace = os.path.join(os.path.dirname(__file__), "..", "_uploads")
    os.makedirs(workspace, exist_ok=True)

    tender_path = os.path.join(workspace, tender.filename)
    bidder_path = os.path.join(workspace, bidder.filename)

    try:
        # Save uploaded files to workspace
        with open(tender_path, "wb") as f:
            content = await tender.read()
            f.write(content)

        with open(bidder_path, "wb") as f:
            content = await bidder.read()
            f.write(content)

        tender_text, tender_package, tender_layout, tender_layout_debug = _extract_document_payload(
            tender_path,
            tender.filename,
        )

        bidder_text, bidder_package, bidder_layout, bidder_layout_debug = _extract_document_payload(
            bidder_path,
            bidder.filename,
        )

        # Run the pipeline
        result = run_pipeline_from_text(
            tender_text,
            bidder_text,
            bidder_filename=bidder.filename or "bidder.txt"
        )
        
        # Add document view layout data to response
        result["document_view"] = {
            "tender": tender_layout,
            "bidder": bidder_layout
        }
        result["extraction_view"] = {
            "tender": _sanitize_extraction_package(tender_package),
            "bidder": _sanitize_extraction_package(bidder_package),
        }
        result["layout_debug"] = {
            "tender": tender_layout_debug,
            "bidder": bidder_layout_debug,
        }
        
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        # Clean up uploaded files
        for path in [tender_path, bidder_path]:
            if os.path.exists(path):
                os.remove(path)
def _run_extraction_job(job_id: str, file_manifest: list, mapping: dict, workspace: str):
    """
    Background worker that processes all files for an extraction job.
    Updates _extraction_jobs[job_id] with progress.
    """
    job = _extraction_jobs[job_id]
    try:
        results = {
            "tender_documents": {},
            "bidder_documents": {}
        }

        total = len(file_manifest)
        for idx, entry in enumerate(file_manifest):
            if job.get("cancelled"):
                job["status"] = "complete"
                job["progress"] = f"Stopped — {idx} document(s) extracted"
                job["progress_pct"] = 100
                job["result"] = results
                return

            fname = entry["filename"]
            fpath = entry["path"]
            ftype = entry["type"]  # "tender" or "bidder"
            bidder_id = entry.get("bidder_id", "BID-UNKNOWN")

            job["progress"] = f"Extracting {idx + 1}/{total}: {fname}"
            job["progress_pct"] = int((idx / total) * 100)

            text, package, layout, layout_debug = _extract_document_payload(fpath, fname)
            doc_result = {
                "text": text,
                "package": _sanitize_extraction_package(package)
            }

            if ftype == "tender":
                results["tender_documents"][fname] = doc_result
            else:
                if bidder_id not in results["bidder_documents"]:
                    results["bidder_documents"][bidder_id] = {}
                results["bidder_documents"][bidder_id][fname] = doc_result

        job["status"] = "complete"
        job["progress"] = f"Done — {total} document(s) extracted"
        job["progress_pct"] = 100
        job["result"] = results

    except Exception as exc:
        job["status"] = "failed"
        job["error"] = str(exc)
        job["progress"] = f"Error: {exc}"
        print(f"[Extraction Job {job_id}] FAILED: {exc}")


@app.post("/api/pipeline/extract")
async def extract_pipeline_documents(
    tender_documents: List[UploadFile] = File([]),
    bidder_documents: List[UploadFile] = File([]),
    bidder_mapping: str = Form("{}"),
):
    """
    Saves uploaded files and starts extraction in a background thread.
    Returns a job_id immediately for status polling.
    """
    workspace = os.path.join(os.path.dirname(__file__), "..", "_uploads")
    os.makedirs(workspace, exist_ok=True)

    try:
        mapping = json.loads(bidder_mapping)
    except Exception:
        mapping = {}

    # Save all files to disk first (must happen in async context)
    file_manifest = []

    for file in tender_documents:
        if file.filename:
            path = os.path.join(workspace, file.filename)
            with open(path, "wb") as f:
                content = await file.read()
                f.write(content)
            file_manifest.append({"filename": file.filename, "path": path, "type": "tender"})

    for file in bidder_documents:
        if file.filename:
            path = os.path.join(workspace, file.filename)
            with open(path, "wb") as f:
                content = await file.read()
                f.write(content)
            bidder_id = mapping.get(file.filename, "BID-UNKNOWN")
            file_manifest.append({"filename": file.filename, "path": path, "type": "bidder", "bidder_id": bidder_id})

    if not file_manifest:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    # Create job and launch background thread
    job_id = str(uuid.uuid4())[:12]
    _extraction_jobs[job_id] = {
        "status": "running",
        "progress": f"Starting extraction of {len(file_manifest)} document(s)...",
        "progress_pct": 0,
        "result": None,
        "error": None,
        "file_count": len(file_manifest),
        "started_at": time.time(),
    }

    thread = threading.Thread(
        target=_run_extraction_job,
        args=(job_id, file_manifest, mapping, workspace),
        daemon=True,
    )
    thread.start()

    return {"status": "accepted", "job_id": job_id, "file_count": len(file_manifest)}


@app.get("/api/pipeline/extract/status/{job_id}")
async def extract_status(job_id: str):
    """
    Poll extraction job progress. Frontend calls this every 2-3 seconds.
    """
    job = _extraction_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    response = {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "progress_pct": job["progress_pct"],
        "file_count": job["file_count"],
        "elapsed_seconds": int(time.time() - job["started_at"]),
    }

    if job["status"] == "complete":
        response["extracted_content"] = job["result"]
    elif job["status"] == "failed":
        response["error"] = job["error"]

    return response


@app.post("/api/pipeline/extract/stop/{job_id}")
async def stop_extract_job(job_id: str):
    """
    Flags a running extraction job to cancel at the next iteration.
    """
    job = _extraction_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    
    if job["status"] == "running":
        job["cancelled"] = True
        llm_client.GLOBAL_CANCEL = True
        return {"status": "success", "message": "Cancellation requested."}
    else:
        return {"status": "ignored", "message": f"Job already {job['status']}."}


@app.post("/extract-debug")
async def extract_debug(
    tender: UploadFile = File(..., description="Tender document (PDF or TXT)"),
    bidder: UploadFile = File(..., description="Bidder document (PDF or TXT)")
):
    """
    Fast extraction-only endpoint for local debugging.
    Does NOT call LLM/pipeline and incurs zero AI API usage.
    """
    if not tender.filename:
        raise HTTPException(status_code=400, detail="Tender filename is missing.")
    if not bidder.filename:
        raise HTTPException(status_code=400, detail="Bidder filename is missing.")

    workspace = os.path.join(os.path.dirname(__file__), "..", "_uploads")
    os.makedirs(workspace, exist_ok=True)

    tender_path = os.path.join(workspace, tender.filename)
    bidder_path = os.path.join(workspace, bidder.filename)

    try:
        with open(tender_path, "wb") as f:
            content = await tender.read()
            f.write(content)

        with open(bidder_path, "wb") as f:
            content = await bidder.read()
            f.write(content)

        tender_text, tender_package, tender_layout, tender_layout_debug = _extract_document_payload(
            tender_path,
            tender.filename,
        )

        bidder_text, bidder_package, bidder_layout, bidder_layout_debug = _extract_document_payload(
            bidder_path,
            bidder.filename,
        )

        return {
            "status": "success",
            "provider": get_provider(),
            "criteria": [],
            "evidence": [],
            "evaluation": [],
            "final_evaluation": [],
            "field_mappings": [],
            "verification": [],
            "pii_masking": {"enabled": False, "mappings": [], "masked_fields_count": 0},
            "issues": [],
            "errors": [],
            "error_details": [],
            "pipeline_steps": [],
            "document_view": {
                "tender": tender_layout,
                "bidder": bidder_layout,
            },
            "extraction_view": {
                "tender": _sanitize_extraction_package(tender_package),
                "bidder": _sanitize_extraction_package(bidder_package),
            },
            "layout_debug": {
                "tender": tender_layout_debug,
                "bidder": bidder_layout_debug,
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        for path in [tender_path, bidder_path]:
            if os.path.exists(path):
                os.remove(path)


# ═══════════════════════════════════════════
#  TENDER ANALYSIS — Separate AI Criteria Extraction
# ═══════════════════════════════════════════

@app.post("/api/tender/analyze")
async def analyze_tender(request: Request):
    """
    Run ONLY Step 1 (Tender Criteria Extraction) on tender text.
    This is called once during the Upload/Setup phase.
    The extracted criteria are reviewed by the officer, then locked.
    Locked criteria are reused for ALL bidder evaluations.

    Accepts: { "tender_text": "..." }
    Returns: { "status": "success", "criteria": [...], "provider": "...", "duration_seconds": N }
    """
    import time as _time
    try:
        data = await request.json()
        tender_text = data.get("tender_text", "")

        if not tender_text or len(tender_text.strip()) < 50:
            raise HTTPException(
                status_code=400,
                detail="Tender text is too short or empty. Please ensure the document was extracted correctly."
            )

        start = _time.time()

        # PII masking before LLM
        from app.services.pii_service import get_pii_service
        pii_service = get_pii_service()
        import hashlib as _hl
        session_id = f"tender-{_hl.sha256(tender_text.encode()).hexdigest()[:12]}"
        masked_text, _ = pii_service.mask_for_llm(tender_text, session_id=session_id)

        # Run LLM extraction
        from app.llm.prompts import TENDER_ANALYZER_PROMPT
        from app.models.schemas import TenderCriteriaList
        from app.llm.client import call_llm, get_provider, get_error_log, clear_error_log

        clear_error_log()
        prompt = TENDER_ANALYZER_PROMPT.replace("{tender_text}", masked_text)
        criteria_result = call_llm(prompt, TenderCriteriaList)

        duration = round(_time.time() - start, 2)

        if not criteria_result:
            error_log = get_error_log()
            return {
                "status": "error",
                "criteria": [],
                "provider": get_provider(),
                "duration_seconds": duration,
                "error": "LLM failed to extract criteria from the tender document.",
                "error_details": error_log,
                "fallback_hint": "The system will use the regex fallback parser. You can also add criteria manually in Tender Setup."
            }

        criteria_data = criteria_result.model_dump().get("criteria", [])

        # Annotate source metadata
        from app.pipeline import _annotate_source_metadata
        criteria_data = _annotate_source_metadata(criteria_data, tender_text)

        return {
            "status": "success",
            "criteria": criteria_data,
            "criteria_count": len(criteria_data),
            "provider": get_provider(),
            "duration_seconds": duration,
            "extraction_method": "llm",
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "status": "error",
            "criteria": [],
            "error": f"Tender analysis failed: {str(e)}",
            "error_details": [{"type": type(e).__name__, "message": str(e)}],
            "fallback_hint": "The system will use the regex fallback parser. You can also add criteria manually in Tender Setup."
        }


# ═══════════════════════════════════════════
#  CONSOLIDATED MULTI-BIDDER EVALUATION
# ═══════════════════════════════════════════

@app.post("/api/evaluate/consolidated")
async def evaluate_consolidated(request: Request):
    """
    Evaluate multiple bidders against a single tender.

    PREFERRED (decoupled architecture):
    {
        "tender_text": "...",
        "criteria": [...],    ← Pre-extracted & officer-approved criteria
        "bidders": [...]
    }

    FALLBACK (legacy, if criteria not provided):
    {
        "tender_text": "...",
        "bidders": [...]
    }
    """
    llm_client.GLOBAL_CANCEL = False
    try:
        data = await request.json()
        tender_text = data.get("tender_text", "")
        bidders = data.get("bidders", [])
        pre_criteria = data.get("criteria", None)  # Officer-approved criteria from frontend

        if not tender_text:
            raise HTTPException(status_code=400, detail="tender_text is required")
        if not bidders:
            raise HTTPException(status_code=400, detail="At least one bidder is required")

        consolidated = {
            "status": "success",
            "tender_text_length": len(tender_text),
            "bidder_count": len(bidders),
            "criteria": [],
            "bidder_results": [],
            "summary": {
                "eligible": 0,
                "not_eligible": 0,
                "review_required": 0,
            },
            "architecture": "decoupled" if pre_criteria else "legacy",
        }

        shared_criteria = None

        # If officer-approved criteria provided, use them directly (decoupled path)
        if pre_criteria and len(pre_criteria) > 0:
            shared_criteria = pre_criteria
            consolidated["criteria"] = shared_criteria
            print(f"\n[CONSOLIDATED] ⚡ Decoupled mode — using {len(shared_criteria)} officer-approved criteria")
            print(f"[CONSOLIDATED]   Skipping Step 1 (Tender Analysis) for ALL {len(bidders)} bidder(s)")

        for idx, bidder in enumerate(bidders):
            bidder_id = bidder.get("bidder_id", f"BID-{idx+1:03d}")
            bidder_name = bidder.get("bidder_name", f"Bidder {idx+1}")
            bidder_text = bidder.get("bidder_text", "")

            print(f"\n[CONSOLIDATED] ═══ Evaluating bidder {idx+1}/{len(bidders)}: {bidder_name} ═══")

            if await request.is_disconnected():
                print(f"\n[CONSOLIDATED] ❌ Client disconnected. Aborting evaluation at bidder {idx+1}.")
                break

            if not bidder_text:
                consolidated["bidder_results"].append({
                    "bidder_id": bidder_id,
                    "bidder_name": bidder_name,
                    "status": "error",
                    "error": "No bidder text provided",
                    "evaluation": [],
                    "verdict": "REVIEW_REQUIRED",
                    "pass_count": 0, "fail_count": 0, "review_count": 0,
                })
                consolidated["summary"]["review_required"] += 1
                continue

            try:
                if shared_criteria is not None:
                    # Optimized path — skip Step 1
                    result = run_pipeline_with_criteria(
                        tender_text, bidder_text, shared_criteria, bidder_filename=bidder_name
                    )
                else:
                    # Legacy fallback — first bidder does full pipeline
                    result = run_pipeline_from_text(tender_text, bidder_text, bidder_filename=bidder_name)
                    if result.get("criteria"):
                        shared_criteria = result["criteria"]
                        consolidated["criteria"] = shared_criteria
            except Exception as e:
                import traceback
                traceback.print_exc()
                consolidated["bidder_results"].append({
                    "bidder_id": bidder_id,
                    "bidder_name": bidder_name,
                    "status": "error",
                    "error": f"Pipeline failed for this bidder: {str(e)}",
                    "evaluation": [],
                    "verdict": "REVIEW_REQUIRED",
                    "pass_count": 0, "fail_count": 0, "review_count": 0,
                })
                consolidated["summary"]["review_required"] += 1
                continue

            # Determine overall verdict for this bidder
            evals = result.get("evaluation", [])
            criteria_lookup = {c.get("criterion_id"): c for c in (shared_criteria or [])}
            
            if llm_client.GLOBAL_CANCEL:
                break
                
            mandatory_fails = sum(
                1 for e in evals
                if e.get("result") == "FAIL"
                and criteria_lookup.get(e.get("criterion_id"), {}).get("mandatory", True)
            )
            mandatory_reviews = sum(
                1 for e in evals
                if e.get("result") == "REVIEW"
                and criteria_lookup.get(e.get("criterion_id"), {}).get("mandatory", True)
            )

            if mandatory_fails > 0:
                verdict = "NOT_ELIGIBLE"
                consolidated["summary"]["not_eligible"] += 1
            elif mandatory_reviews > 0:
                verdict = "REVIEW_REQUIRED"
                consolidated["summary"]["review_required"] += 1
            else:
                verdict = "ELIGIBLE"
                consolidated["summary"]["eligible"] += 1

            consolidated["bidder_results"].append({
                "bidder_id": bidder_id,
                "bidder_name": bidder_name,
                "status": "success",
                "verdict": verdict,
                "evaluation": evals,
                "evidence": result.get("evidence", []),
                "final_evaluation": result.get("final_evaluation", []),
                "verification": result.get("verification", []),
                "issues": result.get("issues", []),
                "pipeline_steps": result.get("pipeline_steps", []),
                "pass_count": sum(1 for e in evals if e.get("result") == "PASS"),
                "fail_count": sum(1 for e in evals if e.get("result") == "FAIL"),
                "review_count": sum(1 for e in evals if e.get("result") == "REVIEW"),
                "errors": result.get("errors", []),
            })

        print(f"\n[CONSOLIDATED] ✅ Complete — {consolidated['summary']}")
        return consolidated

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Consolidated evaluation failed: {e}")

@app.post("/api/evaluate/stop")
async def stop_evaluation():
    """
    Aborts any currently running AI evaluation LLM calls.
    """
    llm_client.GLOBAL_CANCEL = True
    return {"status": "success", "message": "Evaluation aborted."}

# ── Export Endpoints ──
EXPORTS_DIR = os.path.join(os.path.dirname(__file__), "..", "exports")
os.makedirs(EXPORTS_DIR, exist_ok=True)


@app.post("/api/export/pdf")
async def export_pdf(request: Request):
    """Generate and download a PDF evaluation report."""
    try:
        data = await request.json()
        eval_id = data.get("_audit", {}).get("evaluation_id", "UNKNOWN")
        file_name = f"InferX_Report_{eval_id}.pdf"
        output_path = os.path.join(EXPORTS_DIR, file_name)
        generate_pdf_report(data, output_path)
        return FileResponse(
            output_path,
            media_type="application/pdf",
            filename=file_name,
            headers={"Content-Disposition": f"attachment; filename={file_name}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")


@app.post("/api/export/excel")
async def export_excel(request: Request):
    """Generate and download an Excel evaluation matrix."""
    try:
        data = await request.json()
        eval_id = data.get("_audit", {}).get("evaluation_id", "UNKNOWN")
        file_name = f"InferX_Matrix_{eval_id}.xlsx"
        output_path = os.path.join(EXPORTS_DIR, file_name)
        generate_excel_report(data, output_path)
        return FileResponse(
            output_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=file_name,
            headers={"Content-Disposition": f"attachment; filename={file_name}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel generation failed: {e}")


@app.post("/api/export/audit")
async def export_audit(request: Request):
    """Generate and download a tamper-proof audit JSON log."""
    try:
        data = await request.json()
        audit = generate_audit_json(data)
        eval_id = audit.get("audit_metadata", {}).get("evaluation_id", "UNKNOWN")
        file_name = f"InferX_Audit_{eval_id}.json"
        
        output_path = os.path.join(EXPORTS_DIR, file_name)
        with open(output_path, "w") as f:
            json.dump(audit, f, indent=2, default=str)
            
        return FileResponse(
            output_path,
            media_type="application/json",
            filename=file_name,
            headers={"Content-Disposition": f"attachment; filename={file_name}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audit log generation failed: {e}")


@app.post("/api/export/consolidated")
async def export_consolidated_pdf(request: Request):
    """Generate and download a consolidated multi-bidder comparison PDF report."""
    try:
        data = await request.json()
        file_name = f"InferX_Consolidated_{uuid.uuid4().hex[:8].upper()}.pdf"
        output_path = os.path.join(EXPORTS_DIR, file_name)
        generate_consolidated_pdf(data, output_path)
        return FileResponse(
            output_path,
            media_type="application/pdf",
            filename=file_name,
            headers={"Content-Disposition": f"attachment; filename={file_name}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Consolidated PDF generation failed: {e}")


# ═══════════════════════════════════════════
#  SANDBOX API — UBID-based data access
# ═══════════════════════════════════════════

class UBIDRequest(BaseModel):
    ubid: str


@app.post("/api/sandbox/tender")
async def sandbox_fetch_tender(req: UBIDRequest):
    """Fetch tender data from sandbox by UBID."""
    if not validate_ubid(req.ubid):
        raise HTTPException(status_code=400, detail=f"Invalid UBID format: {req.ubid}")
    
    result = await sandbox_adapter.fetch_tender_by_ubid(req.ubid)
    
    # Audit log
    audit = get_audit_service()
    audit.log("EVALUATION_RUN", "system", {
        "action": "sandbox_tender_fetch",
        "ubid": req.ubid,
        "found": result.get("found", False),
        "source": result.get("source", "UNKNOWN"),
    })
    
    return result


@app.post("/api/sandbox/bidder")
async def sandbox_fetch_bidder(req: UBIDRequest):
    """Fetch bidder data from sandbox by UBID."""
    if not validate_ubid(req.ubid):
        raise HTTPException(status_code=400, detail=f"Invalid UBID format: {req.ubid}")
    
    result = await sandbox_adapter.fetch_bidder_by_ubid(req.ubid)
    
    audit = get_audit_service()
    audit.log("EVALUATION_RUN", "system", {
        "action": "sandbox_bidder_fetch",
        "ubid": req.ubid,
        "found": result.get("found", False),
    })
    
    return result


@app.get("/api/sandbox/bidders/{tender_ubid}")
async def sandbox_fetch_bidders_for_tender(tender_ubid: str):
    """Fetch all bidders participating in a given tender."""
    if not validate_ubid(tender_ubid):
        raise HTTPException(status_code=400, detail=f"Invalid UBID format: {tender_ubid}")
    
    bidders = await sandbox_adapter.fetch_bidders_for_tender(tender_ubid)
    return {"tender_ubid": tender_ubid, "bidders": bidders, "count": len(bidders)}


@app.get("/api/sandbox/tenders")
async def sandbox_list_tenders():
    """List all available tenders from sandbox."""
    tenders = await sandbox_adapter.list_tenders()
    return {"tenders": tenders, "count": len(tenders), "source": sandbox_adapter.mode}


@app.get("/api/sandbox/bidders")
async def sandbox_list_bidders():
    """List all available bidders from sandbox."""
    bidders = await sandbox_adapter.list_bidders()
    return {"bidders": bidders, "count": len(bidders), "source": sandbox_adapter.mode}


# ═══════════════════════════════════════════
#  AUDIT API — Query audit logs
# ═══════════════════════════════════════════

@app.get("/api/audit/logs")
async def get_audit_logs(
    action: Optional[str] = None,
    officer_id: Optional[str] = None,
    project_ubid: Optional[str] = None,
    limit: int = 100,
):
    """Query audit logs with optional filters."""
    audit = get_audit_service()
    logs = audit.get_logs(
        action=action,
        officer_id=officer_id,
        project_ubid=project_ubid,
        limit=limit,
    )
    return {"logs": logs, "count": len(logs)}


@app.get("/api/audit/verify")
async def verify_audit_chain():
    """Verify the SHA-256 hash chain integrity of the audit log."""
    audit = get_audit_service()
    result = audit.verify_chain()
    return result


# ═══════════════════════════════════════════
#  PII API — Secure reveal and mapping
# ═══════════════════════════════════════════

class PIIRevealRequest(BaseModel):
    token: str
    officer_id: str
    context: str = ""
    session_id: str = "default"
    project_ubid: str = ""


class PIIMappingRequest(BaseModel):
    officer_id: str
    session_id: str = "default"
    project_ubid: str = ""


@app.post("/api/pii/reveal")
async def pii_reveal(req: PIIRevealRequest):
    """
    Reveal the original value for a PII token.
    Every reveal is audit-logged with officer_id, timestamp, and context.
    """
    from app.services.pii_service import get_pii_service
    pii = get_pii_service()
    result = pii.reveal(
        token=req.token,
        officer_id=req.officer_id,
        context=req.context,
        session_id=req.session_id,
        project_ubid=req.project_ubid,
    )
    return result


@app.get("/api/pii/mapping")
async def pii_mapping_masked(session_id: str = "default"):
    """
    Get PII token list WITHOUT original values (safe for frontend display).
    Returns: [{token, type}, ...]
    """
    from app.services.pii_service import get_pii_service
    pii = get_pii_service()
    return {"tokens": pii.get_mapping_masked(session_id=session_id)}


@app.post("/api/pii/mapping/full")
async def pii_mapping_full(req: PIIMappingRequest):
    """
    Get FULL PII mapping including original values.
    This access is audit-logged. Requires officer_id.
    Returns: [{token, type, original}, ...]
    """
    from app.services.pii_service import get_pii_service
    pii = get_pii_service()
    mapping = pii.get_mapping_full(
        officer_id=req.officer_id,
        session_id=req.session_id,
        project_ubid=req.project_ubid,
    )
    return {"tokens": mapping, "officer_id": req.officer_id}


# ═══════════════════════════════════════════
#  VARIANCE API — Data mismatch resolution
# ═══════════════════════════════════════════

class VarianceResolveRequest(BaseModel):
    variance_id: str
    resolution: str  # ACCEPT_DOCUMENT | ACCEPT_SANDBOX | REVIEW
    officer_id: str
    reason: str
    project_ubid: str = ""


@app.post("/api/variance/resolve")
async def resolve_variance(req: VarianceResolveRequest):
    """Resolve a data variance between document and sandbox."""
    from app.services.variance_service import get_variance_service
    vs = get_variance_service()
    result = vs.resolve(
        variance_id=req.variance_id,
        resolution=req.resolution,
        officer_id=req.officer_id,
        reason=req.reason,
        project_ubid=req.project_ubid,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/variance/list")
async def list_variances():
    """Get all tracked variances for the current session."""
    from app.services.variance_service import get_variance_service
    vs = get_variance_service()
    variances = vs.get_variances()
    return {"variances": variances, "count": len(variances)}


# ═══════════════════════════════════════════
#  CORRECTION API — Human-in-the-loop
# ═══════════════════════════════════════════

class CorrectionRequest(BaseModel):
    input_hash: str
    criterion_id: str
    field: str
    new_value: str
    officer_id: str
    reason: str
    project_ubid: str = ""


class OverrideRequest(BaseModel):
    input_hash: str
    criterion_id: str
    new_verdict: str
    officer_id: str
    reason: str
    project_ubid: str = ""


class ReEvalRequest(BaseModel):
    input_hash: str
    criteria_ids: List[str]
    officer_id: str = "system"


@app.post("/api/correction/before")
async def correct_before_eval(req: CorrectionRequest):
    """Correct extracted data before evaluation (creates new version)."""
    from app.services.correction_service import get_correction_service
    cs = get_correction_service()
    result = cs.correct_before_eval(
        input_hash=req.input_hash,
        criterion_id=req.criterion_id,
        field=req.field,
        new_value=req.new_value,
        officer_id=req.officer_id,
        reason=req.reason,
        project_ubid=req.project_ubid,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/correction/override")
async def override_verdict(req: OverrideRequest):
    """Override a verdict after evaluation (mandatory reason)."""
    from app.services.correction_service import get_correction_service
    cs = get_correction_service()
    result = cs.override_after_eval(
        input_hash=req.input_hash,
        criterion_id=req.criterion_id,
        new_verdict=req.new_verdict,
        officer_id=req.officer_id,
        reason=req.reason,
        project_ubid=req.project_ubid,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/correction/reeval")
async def partial_reevaluation(req: ReEvalRequest):
    """Re-run rule engine for specific criteria (no LLM call)."""
    from app.services.correction_service import get_correction_service
    cs = get_correction_service()
    result = cs.trigger_partial_reevaluation(
        input_hash=req.input_hash,
        criteria_ids=req.criteria_ids,
        officer_id=req.officer_id,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/correction/{input_hash}")
async def get_corrections(input_hash: str):
    """Get all corrections/version history for an evaluation."""
    from app.services.correction_service import get_correction_service
    cs = get_correction_service()
    corrections = cs.get_corrections(input_hash)
    return {"corrections": corrections, "count": len(corrections)}


# ═══════════════════════════════════════════
#  VERSIONING API — Idempotent evaluation records
# ═══════════════════════════════════════════

@app.get("/api/evaluation/{input_hash}")
async def get_evaluation(input_hash: str):
    """Get a stored evaluation by its input hash."""
    from app.services.versioning_service import get_versioning_service
    vs = get_versioning_service()
    record = vs.get_evaluation(input_hash)
    if not record:
        raise HTTPException(status_code=404, detail=f"Evaluation {input_hash} not found.")
    return record

# ═══════════════════════════════════════════
#  CHATBOT API
# ═══════════════════════════════════════════

class ChatRequest(BaseModel):
    message: str
    context: Dict[str, Any]

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """Context-aware AI Chatbot endpoint with fallback."""
    import os
    import requests
    import google.generativeai as genai
    try:
        system_prompt = (
            "You are an InferX AI Chatbot, an intelligent assistant for the CRPF Tender Evaluation system. "
            "Your job is to guide users, explain evaluation results, and troubleshoot issues. "
            "You have access to the current evaluation context. Be concise, helpful, and professional. "
            "If a user asks why a bidder passed or failed, look at the provided context and explain clearly."
        )
        
        full_prompt = f"System: {system_prompt}\n\nUser Message: {req.message}\n\nCurrent Context:\n{json.dumps(req.context, indent=2)}"
        
        # Try Gemini Flash first
        try:
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise Exception("GEMINI_API_KEY not set")
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            response = model.generate_content(full_prompt)
            if not response.text:
                raise Exception("Empty response from Gemini")
            reply = response.text
        except Exception as gemini_err:
            print(f"Gemini Chatbot failed, falling back to OpenRouter: {gemini_err}")
            # Fallback to OpenRouter
            or_key = os.getenv("OPENROUTER_API_KEY")
            if not or_key:
                raise Exception(f"OpenRouter key missing. Original Gemini error: {gemini_err}")
                
            headers = {
                "Authorization": f"Bearer {or_key}",
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "InferX Chatbot",
            }
            payload = {
                "model": "google/gemini-2.5-flash",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"User Message: {req.message}\n\nCurrent Context:\n{json.dumps(req.context)}"}
                ]
            }
            res = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=15)
            if res.status_code != 200:
                print(f"[OpenRouter Error]: {res.text}")
                res.raise_for_status()
            data = res.json()
            reply = data["choices"][0]["message"]["content"]
            
        return {"reply": reply}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
