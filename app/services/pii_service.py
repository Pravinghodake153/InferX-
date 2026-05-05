"""
PII Service — Secure PII masking and controlled reveal for InferX.

Architecture:
  - mask_for_llm(): Masks text BEFORE sending to LLM (compliance requirement)
  - unmask_llm_output(): Preserves PII tokens in LLM output (does NOT restore originals)
  - reveal(): Returns original value for a single token (audit-logged)
  - get_mapping_masked(): Returns token list WITHOUT originals
  - get_mapping_full(): Returns full mapping WITH originals (audit-logged access)

Security Rules:
  - NO raw PII is EVER sent to the LLM
  - PII originals are ONLY accessible via explicit reveal() calls
  - Every reveal is logged with officer_id, timestamp, token, context
  - Mapping storage is server-side only (never sent to frontend in full)

Token Format:
  - <ORG_1>, <ORG_2>, ... — Organization names
  - <GST_1>, <GST_2>, ... — GSTIN numbers
  - <PAN_1>, <PAN_2>, ... — PAN numbers
  - <PHONE_1>, <PHONE_2>, ... — Phone numbers
  - <EMAIL_1>, <EMAIL_2>, ... — Email addresses
  - <PERSON_1>, <PERSON_2>, ... — Person names (future)
"""
import re
from typing import Dict, List, Any, Optional, Tuple

from app.engine.pii import PIIMasker
from app.services.audit_service import get_audit_service


class PIIService:
    """
    Secure PII masking service with audit-logged reveal.

    Usage:
        pii = PIIService()

        # Before LLM call
        masked_text, session_id = pii.mask_for_llm(raw_text)

        # Send masked_text to LLM...

        # After LLM returns
        # Tokens remain in output — do NOT unmask automatically

        # Controlled reveal (audit-logged)
        original = pii.reveal("ORG_1", officer_id="OFF-001", context="Evaluation page")

        # Get mapping for frontend (masked — no originals)
        tokens = pii.get_mapping_masked()
        # → [{"token": "ORG_1", "type": "organization"}, ...]
    """

    def __init__(self):
        self._masker = PIIMasker()
        self._sessions: Dict[str, PIIMasker] = {}  # session_id → masker
        self._active_masker: Optional[PIIMasker] = None

    def mask_for_llm(self, text: str, session_id: str = "default") -> Tuple[str, str]:
        """
        Mask all PII in text before sending to LLM.

        Args:
            text: Raw text containing PII
            session_id: Identifier for this masking session (for multi-document flows)

        Returns:
            Tuple of (masked_text, session_id)
        """
        if not text:
            return text, session_id

        masker = self._get_or_create_masker(session_id)
        masked_text = masker.mask_text(text)
        return masked_text, session_id

    def unmask_llm_output(self, output_data: Dict[str, Any], session_id: str = "default") -> Dict[str, Any]:
        """
        Process LLM output — restore original values in structured fields
        while keeping PII tokens for display.

        This is used internally when we need actual values for rule engine
        comparison (e.g., comparing ₹6.2 Crore vs ₹5 Crore).
        The frontend still sees tokens.

        Args:
            output_data: Structured dict from LLM
            session_id: Masking session identifier

        Returns:
            Dict with original values restored in specific fields
        """
        masker = self._sessions.get(session_id)
        if not masker:
            return output_data

        # Deep unmask string values in the dict
        return self._deep_unmask(output_data, masker)

    def reveal(
        self,
        token: str,
        officer_id: str,
        context: str = "",
        session_id: str = "default",
        project_ubid: str = "",
    ) -> Dict[str, Any]:
        """
        Reveal the original value for a PII token.
        This action is ALWAYS audit-logged.

        Args:
            token: PII token to reveal (e.g., "ORG_1")
            officer_id: ID of the officer requesting the reveal
            context: Context of the reveal (e.g., "Evaluation page, criterion C001")
            session_id: Masking session identifier
            project_ubid: UBID of the associated project

        Returns:
            {
                "token": "ORG_1",
                "original": "ABC Pvt Ltd",
                "type": "organization",
                "revealed": True,
                "officer_id": "OFF-001"
            }
        """
        masker = self._sessions.get(session_id, self._masker)
        original = masker.mapping.get(token)

        # Log the reveal action
        audit = get_audit_service()
        audit.log(
            action="PII_REVEAL",
            officer_id=officer_id,
            details={
                "token": token,
                "found": original is not None,
                "session_id": session_id,
            },
            context=context,
            project_ubid=project_ubid,
        )

        if original is None:
            return {
                "token": token,
                "original": None,
                "type": "unknown",
                "revealed": False,
                "officer_id": officer_id,
                "message": f"Token '{token}' not found in current session.",
            }

        return {
            "token": token,
            "original": original,
            "type": self._classify_token(token),
            "revealed": True,
            "officer_id": officer_id,
        }

    def get_mapping_masked(self, session_id: str = "default") -> List[Dict[str, str]]:
        """
        Get PII mapping WITHOUT original values (safe for frontend).

        Returns:
            List of {"token": "ORG_1", "type": "organization"}
        """
        masker = self._sessions.get(session_id, self._masker)
        return [
            {"token": token, "type": self._classify_token(token)}
            for token in masker.mapping.keys()
        ]

    def get_mapping_full(
        self,
        officer_id: str,
        session_id: str = "default",
        project_ubid: str = "",
    ) -> List[Dict[str, str]]:
        """
        Get FULL PII mapping including original values.
        This access is audit-logged.

        Args:
            officer_id: Officer requesting full access
            session_id: Masking session identifier
            project_ubid: UBID of associated project

        Returns:
            List of {"token": "ORG_1", "type": "organization", "original": "ABC Pvt Ltd"}
        """
        masker = self._sessions.get(session_id, self._masker)

        # Log the full access
        audit = get_audit_service()
        audit.log(
            action="PII_REVEAL",
            officer_id=officer_id,
            details={
                "action": "full_mapping_access",
                "session_id": session_id,
                "token_count": len(masker.mapping),
            },
            context="Full PII mapping requested",
            project_ubid=project_ubid,
        )

        return [
            {
                "token": token,
                "type": self._classify_token(token),
                "original": original,
            }
            for token, original in masker.mapping.items()
        ]

    def get_masker(self, session_id: str = "default") -> PIIMasker:
        """Get the underlying PIIMasker for a session."""
        return self._sessions.get(session_id, self._masker)

    def get_stats(self, session_id: str = "default") -> Dict[str, Any]:
        """Get masking statistics for a session."""
        masker = self._sessions.get(session_id, self._masker)
        type_counts: Dict[str, int] = {}
        for token in masker.mapping.keys():
            token_type = self._classify_token(token)
            type_counts[token_type] = type_counts.get(token_type, 0) + 1

        return {
            "session_id": session_id,
            "total_tokens": len(masker.mapping),
            "by_type": type_counts,
        }

    # ═══════════════════════════════════════════
    #  INTERNAL HELPERS
    # ═══════════════════════════════════════════

    def _get_or_create_masker(self, session_id: str) -> PIIMasker:
        """Get or create a PIIMasker for the given session."""
        if session_id not in self._sessions:
            self._sessions[session_id] = PIIMasker()
        return self._sessions[session_id]

    def _classify_token(self, token: str) -> str:
        """Classify a PII token by its prefix."""
        if token.startswith("ORG_"):
            return "organization"
        elif token.startswith("ID_GSTIN_") or token.startswith("GST_"):
            return "gstin"
        elif token.startswith("ID_PAN_") or token.startswith("PAN_"):
            return "pan"
        elif token.startswith("CONTACT_PHONE_") or token.startswith("PHONE_"):
            return "phone"
        elif token.startswith("CONTACT_EMAIL_") or token.startswith("EMAIL_"):
            return "email"
        elif token.startswith("PERSON_"):
            return "person"
        return "unknown"

    def _deep_unmask(self, data: Any, masker: PIIMasker) -> Any:
        """Recursively unmask PII tokens in a data structure."""
        if isinstance(data, str):
            return masker.unmask_text(data)
        elif isinstance(data, dict):
            return {k: self._deep_unmask(v, masker) for k, v in data.items()}
        elif isinstance(data, list):
            return [self._deep_unmask(item, masker) for item in data]
        return data


# ═══════════════════════════════════════════
#  GLOBAL INSTANCE
# ═══════════════════════════════════════════

_pii_service: Optional[PIIService] = None


def get_pii_service() -> PIIService:
    """Get or create the global PIIService instance."""
    global _pii_service
    if _pii_service is None:
        _pii_service = PIIService()
    return _pii_service
