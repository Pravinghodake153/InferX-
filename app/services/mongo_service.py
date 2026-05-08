"""
MongoDB Service for InferX — handles all heavy data storage.
Replaces Firestore for project data, extractions, evaluations, and audit logs.
"""
import os
import time
from datetime import datetime
from typing import Optional, List, Dict, Any

from pymongo import MongoClient, DESCENDING
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

# ── Singleton connection ──
_client: Optional[MongoClient] = None
_db = None


def get_db():
    """Get or create the MongoDB connection. Thread-safe via PyMongo's built-in pooling."""
    global _client, _db

    if _db is not None:
        return _db

    mongo_uri = os.getenv("MONGO_URI", "")
    if not mongo_uri:
        print("[MongoDB] WARNING: MONGO_URI not set. Using local MongoDB fallback.")
        mongo_uri = "mongodb://localhost:27017"

    try:
        _client = MongoClient(
            mongo_uri,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=10000,
            socketTimeoutMS=120000,  # 2 min — large extraction docs can take time
            maxPoolSize=10,
        )
        # Ping to verify connection
        _client.admin.command("ping")
        _db = _client["inferx"]
        print(f"[MongoDB] Connected successfully to: {mongo_uri[:40]}...")

        # Create indexes for fast queries
        _db.projects.create_index("id", unique=True)
        _db.projects.create_index("createdAt", background=True)
        _db.extractions.create_index("project_id", unique=True)
        _db.evaluations.create_index([("project_id", 1), ("version_id", 1)])
        _db.evaluations.create_index("project_id")
        _db.consolidated.create_index("project_id", unique=True)
        _db.audit_logs.create_index("timestamp", background=True)

        return _db
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        print(f"[MongoDB] Connection FAILED: {e}")
        print("[MongoDB] The application will continue but data will NOT persist.")
        _db = None
        return None


def is_connected() -> bool:
    """Check if MongoDB is available."""
    db = get_db()
    return db is not None


# ═══════════════════════════════════════════
#  PROJECT CRUD
# ═══════════════════════════════════════════

def save_project(project: dict) -> bool:
    """Save or update a project document (lightweight metadata only)."""
    db = get_db()
    if db is None:
        return False
    try:
        # Strip heavy fields before saving to projects collection
        light_project = _strip_heavy_fields(project)
        db.projects.update_one(
            {"id": light_project["id"]},
            {"$set": light_project},
            upsert=True,
        )
        return True
    except Exception as e:
        print(f"[MongoDB] Failed to save project {project.get('id')}: {e}")
        return False


def get_project(project_id: str) -> Optional[dict]:
    """Get a single project by ID."""
    db = get_db()
    if db is None:
        return None
    try:
        doc = db.projects.find_one({"id": project_id}, {"_id": 0})
        return doc
    except Exception as e:
        print(f"[MongoDB] Failed to get project {project_id}: {e}")
        return None


def list_projects() -> List[dict]:
    """List all projects, sorted by creation date (newest first)."""
    db = get_db()
    if db is None:
        return []
    try:
        cursor = db.projects.find({}, {"_id": 0}).sort("createdAt", DESCENDING)
        return list(cursor)
    except Exception as e:
        print(f"[MongoDB] Failed to list projects: {e}")
        return []


def delete_project(project_id: str) -> bool:
    """Delete a project and all related data."""
    db = get_db()
    if db is None:
        return False
    try:
        db.projects.delete_one({"id": project_id})
        db.extractions.delete_one({"project_id": project_id})
        db.evaluations.delete_many({"project_id": project_id})
        db.consolidated.delete_one({"project_id": project_id})
        return True
    except Exception as e:
        print(f"[MongoDB] Failed to delete project {project_id}: {e}")
        return False


# ═══════════════════════════════════════════
#  EXTRACTION DATA (Heavy — up to 16MB)
# ═══════════════════════════════════════════

def save_extraction(project_id: str, data: dict) -> bool:
    """Save the full extraction result (tender text + bidder data). This is the HEAVY data."""
    db = get_db()
    if db is None:
        return False
    try:
        # Strip base64 images from raw_result to stay under MongoDB's 16MB limit
        raw_result = data.get("raw_result")
        if raw_result:
            raw_result = _strip_base64_from_result(raw_result)

        doc = {
            "project_id": project_id,
            "tender_text": data.get("tender_text", ""),
            "bidder_data": data.get("bidder_data", []),
            "raw_result": raw_result,
            "criteria": data.get("criteria", []),
            "criteria_method": data.get("criteria_method", ""),
            "criteria_logs": data.get("criteria_logs", []),
            "saved_at": datetime.utcnow().isoformat(),
        }

        # Log document size for debugging
        import json
        doc_size = len(json.dumps(doc, default=str))
        size_mb = doc_size / (1024 * 1024)
        print(f"[MongoDB] Saving extraction for {project_id}: {size_mb:.2f} MB ({doc_size:,} bytes)")

        if size_mb > 15:
            print(f"[MongoDB] WARNING: Document size {size_mb:.2f} MB approaching 16MB limit! Stripping raw_result.")
            doc["raw_result"] = {"_stripped": True, "reason": "exceeded_size_limit", "original_size_mb": round(size_mb, 2)}

        db.extractions.update_one(
            {"project_id": project_id},
            {"$set": doc},
            upsert=True,
        )
        print(f"[MongoDB] Extraction saved successfully for {project_id}")
        return True
    except Exception as e:
        print(f"[MongoDB] Failed to save extraction for {project_id}: {e}")
        return False


def get_extraction(project_id: str) -> Optional[dict]:
    """Get the full extraction data for a project."""
    db = get_db()
    if db is None:
        return None
    try:
        doc = db.extractions.find_one({"project_id": project_id}, {"_id": 0})
        return doc
    except Exception as e:
        print(f"[MongoDB] Failed to get extraction for {project_id}: {e}")
        return None


# ═══════════════════════════════════════════
#  EVALUATION VERSIONS
# ═══════════════════════════════════════════

def save_evaluation(project_id: str, version: dict) -> bool:
    """Save a single evaluation version."""
    db = get_db()
    if db is None:
        return False
    try:
        doc = {
            "project_id": project_id,
            **version,
            "saved_at": datetime.utcnow().isoformat(),
        }
        # Upsert based on project_id + version_id
        db.evaluations.update_one(
            {"project_id": project_id, "version_id": version.get("version_id")},
            {"$set": doc},
            upsert=True,
        )
        return True
    except Exception as e:
        print(f"[MongoDB] Failed to save evaluation for {project_id}: {e}")
        return False


def get_evaluations(project_id: str) -> List[dict]:
    """Get all evaluation versions for a project."""
    db = get_db()
    if db is None:
        return []
    try:
        cursor = db.evaluations.find(
            {"project_id": project_id},
            {"_id": 0}
        ).sort("version_id", 1)
        return list(cursor)
    except Exception as e:
        print(f"[MongoDB] Failed to get evaluations for {project_id}: {e}")
        return []


# ═══════════════════════════════════════════
#  CONSOLIDATED REPORT
# ═══════════════════════════════════════════

def save_consolidated(project_id: str, report: dict) -> bool:
    """Save the consolidated multi-bidder report."""
    db = get_db()
    if db is None:
        return False
    try:
        doc = {
            "project_id": project_id,
            "report": report,
            "saved_at": datetime.utcnow().isoformat(),
        }
        db.consolidated.update_one(
            {"project_id": project_id},
            {"$set": doc},
            upsert=True,
        )
        return True
    except Exception as e:
        print(f"[MongoDB] Failed to save consolidated for {project_id}: {e}")
        return False


def get_consolidated(project_id: str) -> Optional[dict]:
    """Get the consolidated report for a project."""
    db = get_db()
    if db is None:
        return None
    try:
        doc = db.consolidated.find_one({"project_id": project_id}, {"_id": 0})
        return doc
    except Exception as e:
        print(f"[MongoDB] Failed to get consolidated for {project_id}: {e}")
        return None


# ═══════════════════════════════════════════
#  AUDIT LOG
# ═══════════════════════════════════════════

def save_audit_log(entry: dict) -> bool:
    """Save an audit log entry."""
    db = get_db()
    if db is None:
        return False
    try:
        entry["timestamp"] = entry.get("timestamp", datetime.utcnow().isoformat())
        db.audit_logs.insert_one(entry)
        return True
    except Exception as e:
        print(f"[MongoDB] Failed to save audit log: {e}")
        return False


def get_audit_logs(limit: int = 100) -> List[dict]:
    """Get recent audit logs."""
    db = get_db()
    if db is None:
        return []
    try:
        cursor = db.audit_logs.find({}, {"_id": 0}).sort("timestamp", DESCENDING).limit(limit)
        return list(cursor)
    except Exception as e:
        print(f"[MongoDB] Failed to get audit logs: {e}")
        return []


# ═══════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════

def _strip_heavy_fields(project: dict) -> dict:
    """
    Remove heavy fields from a project before saving to the 'projects' collection.
    The heavy data is saved separately in 'extractions' and 'evaluations' collections.
    """
    light = dict(project)
    # Remove heavy text data (stored in extractions collection)
    light.pop("extractedText", None)
    light.pop("extractedBidderData", None)
    light.pop("extractedContent", None)
    # Remove heavy version payloads (stored in evaluations collection)
    if "versions" in light:
        light["versions"] = [
            {
                "version_id": v.get("version_id"),
                "status": v.get("status"),
                "bidder_id": v.get("bidder_id"),
                "bidder_name": v.get("bidder_name"),
                "created_at": v.get("created_at"),
            }
            for v in (light["versions"] or [])
        ]
    # Remove consolidated report (stored in consolidated collection)
    light.pop("consolidatedReport", None)
    # Remove File objects (not serializable)
    if "tenderDocuments" in light:
        light["tenderDocuments"] = [
            {**d, "file": None} for d in (light["tenderDocuments"] or [])
        ]
    if "bidders" in light:
        light["bidders"] = [
            {
                **b,
                "documents": [{**d, "file": None} for d in (b.get("documents") or [])],
            }
            for b in (light["bidders"] or [])
        ]
    return light


def _strip_base64_from_result(result) -> Any:
    """
    Recursively strip base64-encoded image data from the raw pipeline result.
    This prevents large scanned documents from exceeding MongoDB's 16MB limit.
    Text, metadata, and image URLs are preserved — only inline base64 blobs are removed.
    """
    if isinstance(result, dict):
        cleaned = {}
        for k, v in result.items():
            if isinstance(v, str) and len(v) > 5000 and (
                v.startswith("data:image") or
                v.startswith("/9j/") or      # JPEG base64
                v.startswith("iVBOR") or      # PNG base64
                v.startswith("R0lGOD")        # GIF base64
            ):
                cleaned[k] = f"[BASE64_STRIPPED: {len(v):,} chars]"
            else:
                cleaned[k] = _strip_base64_from_result(v)
        return cleaned
    elif isinstance(result, list):
        return [_strip_base64_from_result(item) for item in result]
    return result
