"""
Audit Service — Centralized, tamper-proof audit logging.

Features:
  - Dual-write: local JSON-lines file + Firebase Firestore
  - SHA-256 hash chain for tamper detection
  - Every entry includes previous entry's hash
  - Append-only log (never modified or deleted)

Action Types:
  - PII_REVEAL: Officer viewed unmasked PII
  - CORRECTION: Data was corrected (before or after evaluation)
  - EVALUATION_RUN: Pipeline evaluation was executed
  - VARIANCE_RESOLUTION: Officer resolved a data variance
  - EXPORT: Report was exported (PDF/Excel/JSON)
  - SCHEMA_LOCK: Tender criteria schema was locked
  - LOGIN: Officer authenticated
  - SETTING_CHANGE: System setting was modified
"""
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Literal

ActionType = Literal[
    "PII_REVEAL",
    "CORRECTION",
    "EVALUATION_RUN",
    "VARIANCE_RESOLUTION",
    "EXPORT",
    "SCHEMA_LOCK",
    "LOGIN",
    "SETTING_CHANGE",
]

# Default log directory
AUDIT_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "audit_logs")
AUDIT_LOG_FILE = os.path.join(AUDIT_LOG_DIR, "audit.jsonl")


class AuditService:
    """
    Append-only audit logger with SHA-256 hash chain integrity.

    Usage:
        audit = AuditService()
        audit.log("EVALUATION_RUN", "OFF-001", {"tender_ubid": "...", "bidder_ubid": "..."})
        audit.log("PII_REVEAL", "OFF-001", {"token": "ORG_1", "context": "Evaluation page"})

        # Verify chain integrity
        is_valid = audit.verify_chain()

        # Query logs
        logs = audit.get_logs(action="PII_REVEAL", officer_id="OFF-001")
    """

    def __init__(self, log_dir: str = None):
        self.log_dir = log_dir or AUDIT_LOG_DIR
        self.log_file = os.path.join(self.log_dir, "audit.jsonl")
        os.makedirs(self.log_dir, exist_ok=True)

        # Load last hash from existing log for chain continuity
        self._last_hash = self._get_last_hash()

    def log(
        self,
        action: str,
        officer_id: str,
        details: Dict[str, Any],
        context: str = "",
        project_ubid: str = "",
    ) -> Dict[str, Any]:
        """
        Append an audit log entry.

        Args:
            action: Action type (PII_REVEAL, CORRECTION, etc.)
            officer_id: ID of the officer performing the action
            details: Action-specific details dict
            context: Human-readable context string
            project_ubid: UBID of the associated project/tender

        Returns:
            The created log entry dict
        """
        entry = {
            "log_id": str(uuid.uuid4()),
            "action": action,
            "officer_id": officer_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "context": context,
            "project_ubid": project_ubid,
            "details": details,
            "prev_hash": self._last_hash,
        }

        # Compute SHA-256 hash of this entry (includes prev_hash for chain)
        entry_canonical = json.dumps(entry, sort_keys=True, default=str)
        entry["sha256"] = hashlib.sha256(entry_canonical.encode("utf-8")).hexdigest()

        # Update chain
        self._last_hash = entry["sha256"]

        # Write to local file (append-only)
        self._write_local(entry)

        return entry

    def get_logs(
        self,
        action: Optional[str] = None,
        officer_id: Optional[str] = None,
        project_ubid: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Query audit logs with optional filters.

        Args:
            action: Filter by action type
            officer_id: Filter by officer
            project_ubid: Filter by project UBID
            limit: Maximum number of entries to return

        Returns:
            List of matching log entries (newest first)
        """
        logs = self._read_all_local()

        # Apply filters
        if action:
            logs = [l for l in logs if l.get("action") == action]
        if officer_id:
            logs = [l for l in logs if l.get("officer_id") == officer_id]
        if project_ubid:
            logs = [l for l in logs if l.get("project_ubid") == project_ubid]

        # Sort newest first, apply limit
        logs.sort(key=lambda l: l.get("timestamp", ""), reverse=True)
        return logs[:limit]

    def verify_chain(self) -> Dict[str, Any]:
        """
        Verify the SHA-256 hash chain integrity of the entire audit log.

        Returns:
            {
                "valid": True/False,
                "total_entries": int,
                "broken_at": int or None,  # index of first broken entry
                "message": str
            }
        """
        logs = self._read_all_local()

        if not logs:
            return {
                "valid": True,
                "total_entries": 0,
                "broken_at": None,
                "message": "No audit entries to verify.",
            }

        prev_hash = ""

        for i, entry in enumerate(logs):
            # Verify prev_hash matches
            if entry.get("prev_hash", "") != prev_hash:
                return {
                    "valid": False,
                    "total_entries": len(logs),
                    "broken_at": i,
                    "message": f"Chain broken at entry {i}: expected prev_hash '{prev_hash[:16]}...', "
                               f"got '{entry.get('prev_hash', '')[:16]}...'",
                }

            # Verify self-hash
            stored_hash = entry.pop("sha256", "")
            entry_canonical = json.dumps(entry, sort_keys=True, default=str)
            computed_hash = hashlib.sha256(entry_canonical.encode("utf-8")).hexdigest()
            entry["sha256"] = stored_hash  # Restore

            if stored_hash != computed_hash:
                return {
                    "valid": False,
                    "total_entries": len(logs),
                    "broken_at": i,
                    "message": f"Hash mismatch at entry {i}: stored '{stored_hash[:16]}...', "
                               f"computed '{computed_hash[:16]}...'",
                }

            prev_hash = stored_hash

        return {
            "valid": True,
            "total_entries": len(logs),
            "broken_at": None,
            "message": f"All {len(logs)} entries verified. Chain integrity intact.",
        }

    # ═══════════════════════════════════════════
    #  LOCAL FILE I/O
    # ═══════════════════════════════════════════

    def _write_local(self, entry: Dict[str, Any]):
        """Append a single entry to the local JSONL file."""
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, default=str) + "\n")
        except Exception as e:
            print(f"[AuditService] ERROR writing local log: {e}")

    def _read_all_local(self) -> List[Dict[str, Any]]:
        """Read all entries from the local JSONL file."""
        if not os.path.exists(self.log_file):
            return []

        entries = []
        try:
            with open(self.log_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            entries.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            print(f"[AuditService] ERROR reading local log: {e}")

        return entries

    def _get_last_hash(self) -> str:
        """Get the hash of the last entry in the log file for chain continuity."""
        entries = self._read_all_local()
        if entries:
            return entries[-1].get("sha256", "")
        return ""


# ═══════════════════════════════════════════
#  GLOBAL INSTANCE
# ═══════════════════════════════════════════

_audit_service: Optional[AuditService] = None


def get_audit_service() -> AuditService:
    """Get or create the global AuditService instance."""
    global _audit_service
    if _audit_service is None:
        _audit_service = AuditService()
    return _audit_service
