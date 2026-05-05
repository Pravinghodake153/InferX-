"""
Variance Service — Data mismatch detection between document extraction and sandbox data.

Compares extracted values with sandbox (ground truth) values for each criterion.
Produces variance alerts that officers must resolve before finalization.

Variance Types:
  - MATCH: Values agree (within tolerance)
  - MINOR_VARIANCE: Small difference (< 5% for numeric, high fuzzy match for text)
  - MAJOR_VARIANCE: Significant difference (> 5% for numeric, low fuzzy match for text)
  - NOT_AVAILABLE: Sandbox has no data for this criterion

Resolution Options:
  - ACCEPT_DOCUMENT: Use the document-extracted value
  - ACCEPT_SANDBOX: Use the sandbox value
  - REVIEW: Flag for manual review (no decision yet)

All resolutions are audit-logged and reversible.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Literal

from app.services.normalization_service import normalize_currency, normalize_count, normalize_field_name
from app.services.audit_service import get_audit_service


VarianceStatus = Literal["MATCH", "MINOR_VARIANCE", "MAJOR_VARIANCE", "NOT_AVAILABLE"]
ResolutionType = Literal["ACCEPT_DOCUMENT", "ACCEPT_SANDBOX", "REVIEW"]

# Thresholds
NUMERIC_MINOR_THRESHOLD = 0.05   # 5% difference = minor
NUMERIC_MAJOR_THRESHOLD = 0.05   # > 5% = major
TEXT_MATCH_THRESHOLD = 0.85      # Fuzzy match score for text similarity


class VarianceEntry:
    """A single data variance between document and sandbox."""

    def __init__(
        self,
        criterion_id: str,
        criterion_name: str,
        document_value: str,
        sandbox_value: str,
        data_type: str = "text",
    ):
        self.variance_id = str(uuid.uuid4())[:8]
        self.criterion_id = criterion_id
        self.criterion_name = criterion_name
        self.document_value = document_value
        self.sandbox_value = sandbox_value
        self.data_type = data_type

        # Computed
        self.variance_status: VarianceStatus = "NOT_AVAILABLE"
        self.variance_detail: str = ""
        self.numeric_diff_pct: Optional[float] = None

        # Resolution
        self.resolution: Optional[ResolutionType] = None
        self.resolved_by: Optional[str] = None
        self.resolved_at: Optional[str] = None
        self.resolution_reason: Optional[str] = None

        # Auto-classify
        self._classify()

    def _classify(self):
        """Classify the variance based on value comparison."""
        if not self.sandbox_value or self.sandbox_value in ("", "None", "null", "N/A"):
            self.variance_status = "NOT_AVAILABLE"
            self.variance_detail = "Sandbox has no data for this criterion."
            return

        if not self.document_value or self.document_value in ("", "None", "null", "N/A"):
            self.variance_status = "MAJOR_VARIANCE"
            self.variance_detail = "Document has no value but sandbox has data."
            return

        if self.data_type == "numeric":
            self._classify_numeric()
        else:
            self._classify_text()

    def _classify_numeric(self):
        """Classify numeric variance by percentage difference."""
        doc_num = normalize_currency(str(self.document_value))
        sandbox_num = normalize_currency(str(self.sandbox_value))

        if doc_num == 0 and sandbox_num == 0:
            self.variance_status = "MATCH"
            self.variance_detail = "Both values are zero."
            return

        if sandbox_num == 0:
            self.variance_status = "MAJOR_VARIANCE"
            self.variance_detail = "Sandbox value is zero but document has a value."
            return

        diff_pct = abs(doc_num - sandbox_num) / sandbox_num
        self.numeric_diff_pct = round(diff_pct * 100, 2)

        if diff_pct == 0:
            self.variance_status = "MATCH"
            self.variance_detail = f"Exact match: {self.document_value}"
        elif diff_pct <= NUMERIC_MINOR_THRESHOLD:
            self.variance_status = "MINOR_VARIANCE"
            self.variance_detail = (
                f"Document value {self.numeric_diff_pct}% "
                f"{'higher' if doc_num > sandbox_num else 'lower'} than sandbox."
            )
        else:
            self.variance_status = "MAJOR_VARIANCE"
            self.variance_detail = (
                f"Document value {self.numeric_diff_pct}% "
                f"{'higher' if doc_num > sandbox_num else 'lower'} than sandbox."
            )

    def _classify_text(self):
        """Classify text variance by similarity."""
        doc_clean = self._clean_text(self.document_value)
        sandbox_clean = self._clean_text(self.sandbox_value)

        if doc_clean == sandbox_clean:
            self.variance_status = "MATCH"
            self.variance_detail = "Exact text match."
            return

        # Simple token-level similarity
        doc_tokens = set(doc_clean.split())
        sandbox_tokens = set(sandbox_clean.split())

        if not doc_tokens or not sandbox_tokens:
            self.variance_status = "MAJOR_VARIANCE"
            self.variance_detail = "Cannot compute text similarity — one value is empty."
            return

        intersection = doc_tokens & sandbox_tokens
        union = doc_tokens | sandbox_tokens
        jaccard = len(intersection) / len(union) if union else 0

        if jaccard >= TEXT_MATCH_THRESHOLD:
            self.variance_status = "MINOR_VARIANCE"
            self.variance_detail = f"Text similarity: {jaccard:.0%} — minor wording differences."
        else:
            self.variance_status = "MAJOR_VARIANCE"
            self.variance_detail = f"Text similarity: {jaccard:.0%} — significant differences."

    @staticmethod
    def _clean_text(text: str) -> str:
        """Normalize text for comparison."""
        if not text:
            return ""
        text = re.sub(r'[^\w\s]', '', str(text).lower().strip())
        return re.sub(r'\s+', ' ', text).strip()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict for API response."""
        return {
            "variance_id": self.variance_id,
            "criterion_id": self.criterion_id,
            "criterion_name": self.criterion_name,
            "document_value": self.document_value,
            "sandbox_value": self.sandbox_value,
            "data_type": self.data_type,
            "variance_status": self.variance_status,
            "variance_detail": self.variance_detail,
            "numeric_diff_pct": self.numeric_diff_pct,
            "resolution": self.resolution,
            "resolved_by": self.resolved_by,
            "resolved_at": self.resolved_at,
            "resolution_reason": self.resolution_reason,
        }


class VarianceService:
    """
    Compares extracted document data against sandbox data and produces variance alerts.

    Usage:
        service = VarianceService()
        variances = service.compare(extracted_evidence, sandbox_bidder, criteria)
        # → list of VarianceEntry dicts

        service.resolve("var-123", "ACCEPT_DOCUMENT", "OFF-001", "Document is more recent")
    """

    def __init__(self):
        self._variances: Dict[str, VarianceEntry] = {}  # variance_id → entry

    def compare(
        self,
        evidence: List[Dict[str, Any]],
        sandbox_data: Dict[str, Any],
        criteria: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Compare extracted evidence against sandbox data for each criterion.

        Args:
            evidence: List of extracted evidence dicts (from bidder parser)
            sandbox_data: Normalized sandbox bidder dict
            criteria: List of criteria dicts (from tender analyzer)

        Returns:
            List of variance entry dicts
        """
        variances = []

        # Build evidence lookup
        evidence_map = {}
        for ev in evidence:
            cid = ev.get("criterion_id")
            if cid:
                evidence_map[cid] = ev

        for criterion in criteria:
            cid = criterion.get("criterion_id", "")
            cname = criterion.get("name", "")
            data_type = criterion.get("type", "text")

            ev = evidence_map.get(cid, {})
            doc_value = str(ev.get("extracted_value", "") or "")

            # Map criterion to sandbox field
            sandbox_value = self._get_sandbox_value(cname, sandbox_data)

            entry = VarianceEntry(
                criterion_id=cid,
                criterion_name=cname,
                document_value=doc_value,
                sandbox_value=str(sandbox_value) if sandbox_value else "",
                data_type=data_type,
            )

            self._variances[entry.variance_id] = entry
            variances.append(entry.to_dict())

        return variances

    def resolve(
        self,
        variance_id: str,
        resolution: str,
        officer_id: str,
        reason: str = "",
        project_ubid: str = "",
    ) -> Dict[str, Any]:
        """
        Resolve a data variance.

        Args:
            variance_id: ID of the variance to resolve
            resolution: ACCEPT_DOCUMENT | ACCEPT_SANDBOX | REVIEW
            officer_id: Officer making the decision
            reason: Mandatory reason for the resolution
            project_ubid: UBID of the project

        Returns:
            Updated variance entry dict
        """
        entry = self._variances.get(variance_id)
        if not entry:
            return {"error": f"Variance {variance_id} not found."}

        if not reason.strip():
            return {"error": "Reason is mandatory for variance resolution."}

        entry.resolution = resolution
        entry.resolved_by = officer_id
        entry.resolved_at = datetime.now(timezone.utc).isoformat()
        entry.resolution_reason = reason

        # Audit log
        audit = get_audit_service()
        audit.log(
            action="VARIANCE_RESOLUTION",
            officer_id=officer_id,
            details={
                "variance_id": variance_id,
                "criterion_id": entry.criterion_id,
                "resolution": resolution,
                "document_value": entry.document_value,
                "sandbox_value": entry.sandbox_value,
                "reason": reason,
            },
            context=f"Resolved variance for {entry.criterion_name}",
            project_ubid=project_ubid,
        )

        return entry.to_dict()

    def get_variances(self, eval_id: str = "") -> List[Dict[str, Any]]:
        """Get all tracked variances."""
        return [v.to_dict() for v in self._variances.values()]

    def _get_sandbox_value(self, criterion_name: str, sandbox_data: Dict[str, Any]) -> Optional[str]:
        """
        Map a criterion name to the corresponding sandbox field value.
        Uses semantic field name normalization.
        """
        normalized_name = normalize_field_name(criterion_name)

        # Direct field mapping
        field_map = {
            "turnover": ["turnover", "annual_turnover", "revenue"],
            "net_worth": ["net_worth", "equity"],
            "gstin": ["gstin", "gst_no"],
            "pan": ["pan"],
            "iso_cert": ["iso_cert", "iso_certification"],
            "experience": ["experience_years"],
            "similar_projects": ["similar_projects", "completed_projects"],
        }

        for canonical, aliases in field_map.items():
            if normalized_name == canonical or normalized_name in aliases:
                for alias in [canonical] + aliases:
                    if alias in sandbox_data and sandbox_data[alias]:
                        return str(sandbox_data[alias])

        # Fallback: try direct key match
        if normalized_name in sandbox_data:
            return str(sandbox_data[normalized_name])

        return None


# ═══════════════════════════════════════════
#  GLOBAL INSTANCE
# ═══════════════════════════════════════════

_variance_service: Optional[VarianceService] = None


def get_variance_service() -> VarianceService:
    """Get or create the global VarianceService instance."""
    global _variance_service
    if _variance_service is None:
        _variance_service = VarianceService()
    return _variance_service
