"""
Correction Service — Human-in-the-loop control for InferX.

Features:
  - Correct data BEFORE evaluation (fix extraction errors)
  - Override verdicts AFTER evaluation (with mandatory reason)
  - Partial re-evaluation (only affected criteria, no LLM re-call)
  - All corrections are tracked, never destructive
  - Original data is ALWAYS preserved

Rules:
  - Reason is MANDATORY for all corrections and overrides
  - Corrections create new version layers (via VersioningService)
  - Partial re-eval uses rule engine only (deterministic, no AI)
  - Every action is audit-logged
"""
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from app.services.audit_service import get_audit_service
from app.services.versioning_service import get_versioning_service
from app.engine.rules import evaluate as rule_engine_evaluate


class CorrectionService:
    """
    Manages corrections and overrides for tender evaluations.

    Usage:
        cs = CorrectionService()

        # Before evaluation — fix extracted data
        cs.correct_before_eval(input_hash, "C001", "extracted_value", "₹6.5 Crore", "OFF-001", "OCR misread")

        # After evaluation — override verdict
        cs.override_after_eval(input_hash, "C001", "PASS", "OFF-001", "Verified from original doc")

        # Re-run rule engine for affected criteria
        result = cs.trigger_partial_reevaluation(input_hash, ["C001"])
    """

    def correct_before_eval(
        self,
        input_hash: str,
        criterion_id: str,
        field: str,
        new_value: str,
        officer_id: str,
        reason: str,
        project_ubid: str = "",
    ) -> Dict[str, Any]:
        """
        Correct extracted data BEFORE evaluation.
        Creates a new version layer. Original is preserved.

        Args:
            input_hash: Hash of the evaluation record
            criterion_id: Which criterion to correct
            field: Which field to correct (e.g., "extracted_value")
            new_value: The corrected value
            officer_id: Officer making the correction
            reason: Mandatory reason for the correction
            project_ubid: UBID of the project

        Returns:
            Updated version metadata
        """
        if not reason.strip():
            return {"error": "Reason is mandatory for corrections."}

        vs = get_versioning_service()
        record = vs.get_evaluation(input_hash)
        if not record:
            return {"error": f"Evaluation {input_hash} not found."}

        # Get old value for diff tracking
        old_value = self._get_field_value(record, criterion_id, field)

        corrections = [{
            "criterion_id": criterion_id,
            "field": field,
            "old_value": old_value,
            "new_value": new_value,
            "reason": reason,
            "correction_type": "BEFORE_EVAL",
        }]

        result = vs.apply_correction(input_hash, corrections, officer_id)

        # Additional audit context
        audit = get_audit_service()
        audit.log(
            action="CORRECTION",
            officer_id=officer_id,
            details={
                "type": "BEFORE_EVAL",
                "input_hash": input_hash,
                "criterion_id": criterion_id,
                "field": field,
                "old_value": old_value,
                "new_value": new_value,
                "reason": reason,
            },
            context=f"Pre-eval correction: {criterion_id}.{field}",
            project_ubid=project_ubid,
        )

        return result

    def override_after_eval(
        self,
        input_hash: str,
        criterion_id: str,
        new_verdict: str,
        officer_id: str,
        reason: str,
        project_ubid: str = "",
    ) -> Dict[str, Any]:
        """
        Override a verdict AFTER evaluation.
        Mandatory reason required. Original verdict preserved.

        Args:
            input_hash: Hash of the evaluation record
            criterion_id: Which criterion to override
            new_verdict: New verdict (PASS, FAIL, REVIEW_REQUIRED)
            officer_id: Officer making the override
            reason: Mandatory reason for the override
            project_ubid: UBID of the project

        Returns:
            Updated version metadata
        """
        if not reason.strip():
            return {"error": "Reason is mandatory for verdict overrides."}

        if new_verdict not in ("PASS", "FAIL", "REVIEW_REQUIRED", "REVIEW"):
            return {"error": f"Invalid verdict: {new_verdict}"}

        vs = get_versioning_service()
        record = vs.get_evaluation(input_hash)
        if not record:
            return {"error": f"Evaluation {input_hash} not found."}

        # Get old verdict for diff tracking
        old_verdict = self._get_verdict(record, criterion_id)

        corrections = [{
            "criterion_id": criterion_id,
            "field": "result",
            "old_value": old_verdict,
            "new_value": new_verdict,
            "reason": reason,
            "correction_type": "OVERRIDE_VERDICT",
        }]

        result = vs.apply_correction(input_hash, corrections, officer_id)

        # Audit log
        audit = get_audit_service()
        audit.log(
            action="CORRECTION",
            officer_id=officer_id,
            details={
                "type": "OVERRIDE_VERDICT",
                "input_hash": input_hash,
                "criterion_id": criterion_id,
                "old_verdict": old_verdict,
                "new_verdict": new_verdict,
                "reason": reason,
            },
            context=f"Verdict override: {criterion_id} {old_verdict} → {new_verdict}",
            project_ubid=project_ubid,
        )

        return result

    def trigger_partial_reevaluation(
        self,
        input_hash: str,
        criteria_ids: List[str],
        officer_id: str = "system",
    ) -> Dict[str, Any]:
        """
        Re-run the deterministic rule engine ONLY for specified criteria.
        Does NOT re-call LLM (saves API quota + ensures determinism).

        Args:
            input_hash: Hash of the evaluation record
            criteria_ids: List of criterion_ids to re-evaluate
            officer_id: Officer triggering the re-evaluation

        Returns:
            Dict with updated evaluation results for affected criteria
        """
        vs = get_versioning_service()
        record = vs.get_evaluation(input_hash)
        if not record:
            return {"error": f"Evaluation {input_hash} not found."}

        data = record.get("data", {})
        all_criteria = data.get("criteria", [])
        all_evidence = data.get("evidence", [])

        # Filter to only the affected criteria
        affected_criteria = [c for c in all_criteria if c.get("criterion_id") in criteria_ids]
        affected_evidence = [e for e in all_evidence if e.get("criterion_id") in criteria_ids]

        if not affected_criteria:
            return {"error": "No matching criteria found for re-evaluation."}

        # Run rule engine (deterministic, no LLM)
        new_results = rule_engine_evaluate(affected_criteria, affected_evidence)

        # Update results in the stored data
        existing_results = data.get("evaluation", [])
        result_map = {r.get("criterion_id", r.get("criteria_id", "")): r for r in existing_results}

        for new_r in new_results:
            cid = new_r.get("criterion_id")
            if cid in result_map:
                result_map[cid].update(new_r)
            else:
                existing_results.append(new_r)

        data["evaluation"] = existing_results

        # Save updated record
        eval_path = f"{vs.store_dir}/{input_hash}.json"
        import json
        with open(eval_path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, default=str)

        # Audit log
        audit = get_audit_service()
        audit.log(
            action="EVALUATION_RUN",
            officer_id=officer_id,
            details={
                "type": "PARTIAL_REEVALUATION",
                "input_hash": input_hash,
                "criteria_ids": criteria_ids,
                "results_count": len(new_results),
            },
            context=f"Partial re-eval for {len(criteria_ids)} criteria",
        )

        return {
            "status": "success",
            "re_evaluated": len(new_results),
            "results": new_results,
        }

    def get_corrections(self, input_hash: str) -> List[Dict[str, Any]]:
        """
        Get all corrections for an evaluation, with before/after diffs.
        """
        vs = get_versioning_service()
        return vs.get_version_history(input_hash)

    # ═══════════════════════════════════════════
    #  INTERNAL HELPERS
    # ═══════════════════════════════════════════

    def _get_field_value(self, record: Dict, criterion_id: str, field: str) -> Optional[str]:
        """Get current field value for a criterion from stored record."""
        data = record.get("data", {})
        for ev in data.get("evidence", []):
            if ev.get("criterion_id") == criterion_id:
                return str(ev.get(field, ""))
        return None

    def _get_verdict(self, record: Dict, criterion_id: str) -> Optional[str]:
        """Get current verdict for a criterion from stored record."""
        data = record.get("data", {})
        for ev in data.get("evaluation", []):
            cid = ev.get("criterion_id", ev.get("criteria_id", ""))
            if cid == criterion_id:
                return ev.get("result", ev.get("verdict", ""))
        return None


# ═══════════════════════════════════════════
#  GLOBAL INSTANCE
# ═══════════════════════════════════════════

_correction_service: Optional[CorrectionService] = None


def get_correction_service() -> CorrectionService:
    """Get or create the global CorrectionService instance."""
    global _correction_service
    if _correction_service is None:
        _correction_service = CorrectionService()
    return _correction_service
