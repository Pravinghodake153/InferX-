"""
Explainability Service — Human-readable explanations for every evaluation verdict.

Every verdict must be:
  - Traceable to document source (page + snippet)
  - Showing comparison logic (extracted vs required)
  - Using plain language (no black-box outputs)
  - Linkable back to the original document

Output Example:
  "Turnover: ₹6.2 Cr ≥ ₹5 Cr → PASS"
  "Source: Page 4 — 'Total turnover for FY 2023-24 is ₹6.2 crore.'"
"""
from typing import Dict, Any, List, Optional

from app.services.normalization_service import (
    normalize_currency,
    normalize_count,
    format_currency_inr,
    normalize_field_name,
)


class ExplainabilityService:
    """
    Generates human-readable explanations for evaluation verdicts.

    Usage:
        es = ExplainabilityService()
        explanation = es.explain(criterion, evidence, verdict="PASS")
        all_explanations = es.explain_all(criteria, evidence, results)
    """

    def explain(
        self,
        criterion: Dict[str, Any],
        evidence: Optional[Dict[str, Any]],
        verdict: str,
        confidence: str = "MEDIUM",
    ) -> Dict[str, Any]:
        """
        Generate a human-readable explanation for a single criterion verdict.

        Args:
            criterion: Criterion dict with name, required_value, type, etc.
            evidence: Evidence dict with extracted_value, source, etc.
            verdict: PASS, FAIL, or REVIEW_REQUIRED
            confidence: HIGH, MEDIUM, or LOW

        Returns:
            Structured explanation dict
        """
        cname = criterion.get("name", "Unknown Criterion")
        ctype = criterion.get("type", "text").lower()
        required = criterion.get("required_value", "")
        mandatory = criterion.get("mandatory", True)

        extracted = ""
        source_page = 0
        source_snippet = ""
        source_type = "Unknown"

        if evidence:
            extracted = evidence.get("extracted_value", "") or ""
            source = evidence.get("source", {}) or {}
            source_page = source.get("page", 0)
            source_snippet = source.get("raw_snippet", "")
            source_type = source.get("source_type", "PyMuPDF")

        # Build comparison string
        comparison = self._build_comparison(ctype, required, extracted, verdict)

        # Build human-readable explanation
        explanation_text = self._build_explanation(
            cname, ctype, required, extracted, verdict, confidence, mandatory
        )

        return {
            "criterion_id": criterion.get("criterion_id", ""),
            "criterion_name": cname,
            "category": criterion.get("category", ""),
            "comparison": comparison,
            "logic": self._build_logic(ctype, required, extracted),
            "verdict": verdict,
            "confidence": confidence,
            "mandatory": mandatory,
            "source": {
                "page": source_page,
                "snippet": source_snippet[:300] if source_snippet else "",
                "source_type": source_type,
            },
            "explanation": explanation_text,
            "required_value": required,
            "extracted_value": extracted,
        }

    def explain_all(
        self,
        criteria: List[Dict[str, Any]],
        evidence: List[Dict[str, Any]],
        results: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Generate explanations for all criteria.

        Args:
            criteria: List of criterion dicts
            evidence: List of evidence dicts
            results: List of evaluation result dicts

        Returns:
            List of explanation dicts
        """
        # Build lookup maps
        evidence_map = {ev.get("criterion_id"): ev for ev in evidence}
        result_map = {r.get("criterion_id", r.get("criteria_id", "")): r for r in results}

        explanations = []
        for criterion in criteria:
            cid = criterion.get("criterion_id", "")
            ev = evidence_map.get(cid)
            result = result_map.get(cid, {})

            verdict = result.get("result", result.get("verdict", "REVIEW"))
            confidence = result.get("confidence", "MEDIUM")

            explanation = self.explain(criterion, ev, verdict, confidence)
            explanations.append(explanation)

        return explanations

    def _build_comparison(self, data_type: str, required: str, extracted: str, verdict: str) -> str:
        """Build a concise comparison string like '₹6.2 Cr ≥ ₹5 Cr → PASS'."""
        if not extracted:
            return f"No evidence found → {verdict}"

        if data_type == "numeric":
            req_num = normalize_currency(str(required))
            ext_num = normalize_currency(str(extracted))

            if req_num > 0 and ext_num > 0:
                req_str = format_currency_inr(req_num)
                ext_str = format_currency_inr(ext_num)
                operator = "≥" if ext_num >= req_num else "<"
                return f"{ext_str} {operator} {req_str} → {verdict}"

        return f"'{extracted}' vs '{required}' → {verdict}"

    def _build_logic(self, data_type: str, required: str, extracted: str) -> str:
        """Build a machine-readable logic string."""
        if not extracted:
            return "extracted_value = NULL"

        if data_type == "numeric":
            req_num = normalize_currency(str(required))
            ext_num = normalize_currency(str(extracted))
            return f"extracted_value ({ext_num:,.0f}) vs required_value ({req_num:,.0f})"

        return f"extracted_value = '{extracted}' | required_value = '{required}'"

    def _build_explanation(
        self,
        name: str,
        data_type: str,
        required: str,
        extracted: str,
        verdict: str,
        confidence: str,
        mandatory: bool,
    ) -> str:
        """Build a complete human-readable explanation paragraph."""
        mandatory_str = "mandatory" if mandatory else "optional"

        if not extracted:
            if mandatory:
                return (
                    f"The {mandatory_str} criterion '{name}' could not be verified. "
                    f"No matching evidence was found in the bidder document. "
                    f"Required: {required or 'documentation'}. Manual review is needed."
                )
            else:
                return (
                    f"The {mandatory_str} criterion '{name}' was not found in the document. "
                    f"Since it is optional, this does not affect eligibility."
                )

        if data_type == "numeric":
            req_num = normalize_currency(str(required))
            ext_num = normalize_currency(str(extracted))

            if req_num > 0 and ext_num > 0:
                if verdict == "PASS":
                    return (
                        f"The bidder's {name.lower()} of {extracted} "
                        f"({format_currency_inr(ext_num)}) meets the minimum requirement "
                        f"of {required} ({format_currency_inr(req_num)})."
                    )
                elif verdict == "FAIL":
                    shortfall = format_currency_inr(req_num - ext_num)
                    return (
                        f"The bidder's {name.lower()} of {extracted} "
                        f"({format_currency_inr(ext_num)}) does NOT meet the minimum "
                        f"requirement of {required} ({format_currency_inr(req_num)}). "
                        f"Shortfall: {shortfall}."
                    )

        if verdict == "PASS":
            return (
                f"Evidence found for '{name}': '{extracted}'. "
                f"This satisfies the requirement of '{required}'. Confidence: {confidence}."
            )
        elif verdict == "FAIL":
            return (
                f"The evidence for '{name}' ('{extracted}') does not satisfy "
                f"the requirement of '{required}'."
            )
        else:
            return (
                f"The evidence for '{name}' requires manual review. "
                f"Found: '{extracted}', Required: '{required}'. "
                f"Confidence: {confidence}."
            )


# ═══════════════════════════════════════════
#  GLOBAL INSTANCE
# ═══════════════════════════════════════════

_explainability_service: Optional[ExplainabilityService] = None


def get_explainability_service() -> ExplainabilityService:
    """Get or create the global ExplainabilityService instance."""
    global _explainability_service
    if _explainability_service is None:
        _explainability_service = ExplainabilityService()
    return _explainability_service
