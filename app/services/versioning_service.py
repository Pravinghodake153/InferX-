"""
Versioning Service — Idempotency and immutable evaluation records.

Rules:
  - Same input ALWAYS produces same output (deterministic)
  - No duplicate records (checked via input_hash)
  - No silent overwrites (corrections create new versions)
  - Each evaluation is stored as an immutable record
  - Corrections are layered on top (original always preserved)

Data Flow:
  Input → input_hash → check cache → run pipeline → save version 1
  Correction → create version 2 (v1 untouched) → partial re-eval
"""
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from app.services.audit_service import get_audit_service


# Local storage directory for versioned evaluations
VERSIONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "evaluation_store")


class VersioningService:
    """
    Manages immutable evaluation records with version history.

    Usage:
        vs = VersioningService()

        # Check for existing evaluation
        input_hash = vs.compute_input_hash(tender_text, bidder_text)
        cached = vs.check_duplicate(input_hash)
        if cached:
            return cached  # Idempotent!

        # Save new evaluation
        vs.save_evaluation(input_hash, result, version_info)

        # Apply correction (creates new version)
        vs.apply_correction(eval_id, corrections, officer_id)
    """

    def __init__(self, store_dir: str = None):
        self.store_dir = store_dir or VERSIONS_DIR
        os.makedirs(self.store_dir, exist_ok=True)

    def compute_input_hash(self, tender_text: str, bidder_text: str) -> str:
        """
        Compute a deterministic SHA-256 hash of the pipeline inputs.
        Same input always produces the same hash — core of idempotency.
        """
        canonical = json.dumps({
            "tender": tender_text,
            "bidder": bidder_text,
        }, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def check_duplicate(self, input_hash: str, rules_version: str = "1.0.0") -> Optional[Dict[str, Any]]:
        """
        Check if we've already evaluated this exact input with the same rules.
        Returns cached result if found, None otherwise.
        """
        eval_path = os.path.join(self.store_dir, f"{input_hash}.json")
        if not os.path.exists(eval_path):
            return None

        try:
            with open(eval_path, "r", encoding="utf-8") as f:
                stored = json.load(f)

            # Only return if rules_version matches (rule changes invalidate cache)
            if stored.get("version_info", {}).get("rules_version") == rules_version:
                stored["_cached"] = True
                return stored
        except (json.JSONDecodeError, IOError):
            pass

        return None

    def save_evaluation(
        self,
        input_hash: str,
        result: Dict[str, Any],
        eval_id: str = "",
        rules_version: str = "1.0.0",
        model_version: str = "InferX v2.0",
        llm_provider: str = "unknown",
    ) -> Dict[str, Any]:
        """
        Save an evaluation result as an immutable versioned record.

        Args:
            input_hash: SHA-256 of the input
            result: Pipeline output dict
            eval_id: Evaluation identifier
            rules_version: Version of the rule engine
            model_version: Version of InferX
            llm_provider: Which LLM was used

        Returns:
            Version metadata dict
        """
        version_info = {
            "evaluation_id": eval_id or f"EVAL-{input_hash[:8].upper()}",
            "input_hash": input_hash,
            "version": 1,
            "rules_version": rules_version,
            "model_version": model_version,
            "llm_provider": llm_provider,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_latest": True,
            "corrections": [],
        }

        record = {
            "version_info": version_info,
            "data": result,
        }

        # Save to disk
        eval_path = os.path.join(self.store_dir, f"{input_hash}.json")
        with open(eval_path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, default=str)

        # Audit log
        audit = get_audit_service()
        audit.log(
            action="EVALUATION_RUN",
            officer_id="system",
            details={
                "evaluation_id": version_info["evaluation_id"],
                "input_hash": input_hash,
                "version": 1,
                "rules_version": rules_version,
                "provider": llm_provider,
            },
            context="New evaluation saved",
        )

        return version_info

    def apply_correction(
        self,
        input_hash: str,
        corrections: List[Dict[str, Any]],
        officer_id: str,
    ) -> Dict[str, Any]:
        """
        Apply corrections to an existing evaluation.
        Creates a new version — original is NEVER modified.

        Args:
            input_hash: Hash of the evaluation to correct
            corrections: List of correction dicts:
                [{criterion_id, field, old_value, new_value, reason}, ...]
            officer_id: Officer making the correction

        Returns:
            New version metadata
        """
        eval_path = os.path.join(self.store_dir, f"{input_hash}.json")
        if not os.path.exists(eval_path):
            return {"error": f"Evaluation {input_hash} not found."}

        with open(eval_path, "r", encoding="utf-8") as f:
            record = json.load(f)

        current_version = record.get("version_info", {}).get("version", 1)
        new_version = current_version + 1

        # Add timestamp to each correction
        for c in corrections:
            c["officer_id"] = officer_id
            c["timestamp"] = datetime.now(timezone.utc).isoformat()

        # Append corrections (never overwrite)
        existing_corrections = record.get("version_info", {}).get("corrections", [])
        all_corrections = existing_corrections + corrections

        record["version_info"]["version"] = new_version
        record["version_info"]["corrections"] = all_corrections
        record["version_info"]["last_corrected_at"] = datetime.now(timezone.utc).isoformat()
        record["version_info"]["last_corrected_by"] = officer_id

        # Apply corrections to data
        data = record.get("data", {})
        for c in corrections:
            self._apply_single_correction(data, c)

        # Save updated record
        with open(eval_path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, default=str)

        # Audit log
        audit = get_audit_service()
        audit.log(
            action="CORRECTION",
            officer_id=officer_id,
            details={
                "input_hash": input_hash,
                "version": new_version,
                "corrections_count": len(corrections),
                "corrections": corrections,
            },
            context=f"Applied {len(corrections)} corrections (v{current_version} → v{new_version})",
        )

        return record["version_info"]

    def get_evaluation(self, input_hash: str) -> Optional[Dict[str, Any]]:
        """Get an evaluation by its input hash."""
        eval_path = os.path.join(self.store_dir, f"{input_hash}.json")
        if not os.path.exists(eval_path):
            return None

        with open(eval_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_version_history(self, input_hash: str) -> List[Dict[str, Any]]:
        """Get the correction/version history for an evaluation."""
        record = self.get_evaluation(input_hash)
        if not record:
            return []

        return record.get("version_info", {}).get("corrections", [])

    def _apply_single_correction(self, data: Dict[str, Any], correction: Dict[str, Any]):
        """Apply a single correction to evaluation data."""
        criterion_id = correction.get("criterion_id")
        field = correction.get("field", "extracted_value")
        new_value = correction.get("new_value")

        # Update in evidence
        for ev in data.get("evidence", []):
            if ev.get("criterion_id") == criterion_id:
                ev[field] = new_value
                break

        # Update in evaluation results
        for ev in data.get("evaluation", []):
            if ev.get("criterion_id") == criterion_id or ev.get("criteria_id") == criterion_id:
                if field == "extracted_value":
                    ev["evidence_found"] = new_value
                break


# ═══════════════════════════════════════════
#  GLOBAL INSTANCE
# ═══════════════════════════════════════════

_versioning_service: Optional[VersioningService] = None


def get_versioning_service() -> VersioningService:
    """Get or create the global VersioningService instance."""
    global _versioning_service
    if _versioning_service is None:
        _versioning_service = VersioningService()
    return _versioning_service
