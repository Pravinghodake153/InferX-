"""
PII Masking Module — Light, safe masking of sensitive identifiers.

Masks:
  - Company names (detected heuristically) → ORG_1, ORG_2, ...
  - GSTIN (15-char alphanumeric) → ID_GSTIN_1, ID_GSTIN_2, ...
  - PAN (10-char: 5 alpha + 4 digits + 1 alpha) → ID_PAN_1, ID_PAN_2, ...
  - Phone numbers → CONTACT_PHONE_1, ...
  - Email addresses → CONTACT_EMAIL_1, ...

Does NOT mask:
  - Financial numbers (₹, crore, lakh, etc.)
  - Dates
  - Certification numbers (ISO, etc.)
"""
import re
from typing import Dict, List, Tuple, Any


# ═══════════════════════════════════════════
#  REGEX PATTERNS
# ═══════════════════════════════════════════

# GSTIN: 2 digits (state) + 10 char PAN + 1 entity code (digit) + Z + 1 check digit
GSTIN_PATTERN = re.compile(
    r'\b(\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d])\b',
    re.IGNORECASE
)

# PAN: 5 uppercase letters + 4 digits + 1 uppercase letter
PAN_PATTERN = re.compile(
    r'\b([A-Z]{5}\d{4}[A-Z])\b'
)

# Indian phone: +91, 0-prefix, or 10-digit starting with 6-9
PHONE_PATTERN = re.compile(
    r'(?:\+91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})\b'
)

# Email
EMAIL_PATTERN = re.compile(
    r'\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b'
)

# Company name heuristics — matches "XYZ Pvt Ltd", "ABC Limited", "DEF Inc", etc.
COMPANY_SUFFIXES = [
    r'(?:Pvt\.?\s*)?Ltd\.?',
    r'Limited',
    r'Inc\.?',
    r'Corporation',
    r'Corp\.?',
    r'LLP',
    r'Enterprises?',
    r'Solutions?',
    r'Technologies',
    r'Services',
    r'Associates',
    r'Partners',
    r'Industries',
    r'Group',
    r'Foundation',
]
COMPANY_PATTERN = re.compile(
    r'\b([A-Z][A-Za-z\s&.\'-]{1,50}?\s+(?:' + '|'.join(COMPANY_SUFFIXES) + r'))\b',
    re.IGNORECASE
)


# ═══════════════════════════════════════════
#  MASKING ENGINE
# ═══════════════════════════════════════════

class PIIMasker:
    """
    Stateful PII masker that replaces sensitive identifiers with tokens
    and maintains a reverse mapping for de-masking.
    """

    def __init__(self):
        self.mapping: Dict[str, str] = {}        # token → original
        self.reverse_mapping: Dict[str, str] = {} # original → token
        self._counters = {
            "org": 0,
            "gstin": 0,
            "pan": 0,
            "phone": 0,
            "email": 0,
        }

    def _get_token(self, category: str) -> str:
        """Generate a unique masked token for a category."""
        self._counters[category] += 1
        idx = self._counters[category]
        token_map = {
            "org": f"ORG_{idx}",
            "gstin": f"ID_GSTIN_{idx}",
            "pan": f"ID_PAN_{idx}",
            "phone": f"CONTACT_PHONE_{idx}",
            "email": f"CONTACT_EMAIL_{idx}",
        }
        return token_map.get(category, f"MASKED_{idx}")

    def _register(self, original: str, category: str) -> str:
        """Register an original value and return its token. Reuse if already seen."""
        normalized = original.strip()
        if normalized in self.reverse_mapping:
            return self.reverse_mapping[normalized]
        token = self._get_token(category)
        self.mapping[token] = normalized
        self.reverse_mapping[normalized] = token
        return token

    def mask_text(self, text: str) -> str:
        """
        Apply PII masking to input text.
        Returns the masked text.
        Order matters: GSTIN before PAN (GSTIN contains a PAN substring).
        """
        if not text:
            return text

        masked = text

        # 1. Mask GSTIN first (contains PAN as substring)
        for match in GSTIN_PATTERN.finditer(masked):
            original = match.group(0)
            token = self._register(original, "gstin")
            masked = masked.replace(original, token)

        # 2. Mask PAN (only if not already masked as part of GSTIN)
        for match in PAN_PATTERN.finditer(masked):
            original = match.group(0)
            if original not in self.reverse_mapping and not original.startswith("ID_"):
                token = self._register(original, "pan")
                masked = masked.replace(original, token)

        # 3. Mask emails
        for match in EMAIL_PATTERN.finditer(masked):
            original = match.group(0)
            token = self._register(original, "email")
            masked = masked.replace(original, token)

        # 4. Mask phone numbers
        for match in PHONE_PATTERN.finditer(masked):
            original = match.group(0)
            # Don't mask if it looks like a financial number (e.g., ₹ prefix)
            start = match.start()
            prefix_char = text[max(0, start - 1):start]
            if prefix_char in ('₹', '#', 'C', 'c'):
                continue
            token = self._register(original, "phone")
            masked = masked.replace(original, token)

        # 5. Mask company names
        for match in COMPANY_PATTERN.finditer(masked):
            original = match.group(0).strip()
            if len(original) < 4:  # Skip very short matches
                continue
            token = self._register(original, "org")
            masked = masked.replace(original, token)

        return masked

    def unmask_text(self, masked_text: str) -> str:
        """Reverse masking — restore original values."""
        result = masked_text
        # Sort tokens by length (longest first) to avoid partial replacements
        for token in sorted(self.mapping.keys(), key=len, reverse=True):
            result = result.replace(token, self.mapping[token])
        return result

    def get_mapping_list(self) -> List[Dict[str, str]]:
        """Return the mapping as a list of dicts for JSON serialization."""
        return [
            {"token": token, "original": original, "type": self._classify_token(token)}
            for token, original in self.mapping.items()
        ]

    def _classify_token(self, token: str) -> str:
        if token.startswith("ORG_"):
            return "organization"
        elif token.startswith("ID_GSTIN_"):
            return "gstin"
        elif token.startswith("ID_PAN_"):
            return "pan"
        elif token.startswith("CONTACT_PHONE_"):
            return "phone"
        elif token.startswith("CONTACT_EMAIL_"):
            return "email"
        return "unknown"


def mask_document(text: str) -> Tuple[str, PIIMasker]:
    """
    Convenience function: mask a document and return (masked_text, masker).
    The masker object contains the mapping for de-masking.
    """
    masker = PIIMasker()
    masked = masker.mask_text(text)
    return masked, masker
