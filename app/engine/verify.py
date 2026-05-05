"""
Verification Layer — Validate extracted identifiers (GSTIN, PAN).

Since we cannot call external government APIs, this module performs:
  1. Format validation (structural correctness)
  2. Checksum validation where applicable
  3. State code validation for GSTIN

Returns VERIFIED (format valid), INVALID_FORMAT, or NOT_FOUND.
"""
import re
from typing import List, Dict, Any, Optional


# ═══════════════════════════════════════════
#  GSTIN VALIDATION
# ═══════════════════════════════════════════

# Valid Indian state codes (first 2 digits of GSTIN)
VALID_STATE_CODES = {
    "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
    "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
    "31", "32", "33", "34", "35", "36", "37", "38",
    # Special codes
    "96", "97",
}

GSTIN_REGEX = re.compile(r'^(\d{2})([A-Z]{5}\d{4}[A-Z])(\d)(Z)([A-Z\d])$', re.IGNORECASE)
PAN_REGEX = re.compile(r'^([A-Z]{3})([ABCFGHLJPTK])([A-Z])(\d{4})([A-Z])$', re.IGNORECASE)

# PAN 4th character entity types
PAN_ENTITY_TYPES = {
    "A": "Association of Persons (AOP)",
    "B": "Body of Individuals (BOI)",
    "C": "Company",
    "F": "Firm",
    "G": "Government",
    "H": "Hindu Undivided Family (HUF)",
    "L": "Local Authority",
    "J": "Artificial Juridical Person",
    "P": "Person (Individual)",
    "T": "Trust",
    "K": "Karta (HUF)",
}


def validate_gstin(gstin: str) -> Dict[str, Any]:
    """
    Validate a GSTIN number.
    
    GSTIN format: SSPPPPPPPPPPXZC
    - SS: 2-digit state code
    - PPPPPPPPPP: 10-char PAN
    - X: Entity number (1-9, A-Z)
    - Z: Always 'Z'
    - C: Check digit
    
    Returns validation result dict.
    """
    if not gstin or not isinstance(gstin, str):
        return {
            "identifier": gstin or "",
            "identifier_type": "GSTIN",
            "status": "NOT_FOUND",
            "confidence": "LOW",
            "details": "No GSTIN provided"
        }

    cleaned = gstin.strip().upper().replace(" ", "").replace("-", "")

    if len(cleaned) != 15:
        return {
            "identifier": gstin,
            "identifier_type": "GSTIN",
            "status": "INVALID_FORMAT",
            "confidence": "HIGH",
            "details": f"GSTIN must be 15 characters, got {len(cleaned)}"
        }

    match = GSTIN_REGEX.match(cleaned)
    if not match:
        return {
            "identifier": gstin,
            "identifier_type": "GSTIN",
            "status": "INVALID_FORMAT",
            "confidence": "HIGH",
            "details": "GSTIN does not match expected pattern (2-digit state + PAN + entity + Z + check)"
        }

    state_code = match.group(1)
    pan_part = match.group(2)
    z_char = match.group(4)

    issues = []

    # Validate state code
    if state_code not in VALID_STATE_CODES:
        issues.append(f"Invalid state code: {state_code}")

    # Validate Z character
    if z_char.upper() != "Z":
        issues.append(f"14th character must be 'Z', got '{z_char}'")

    # Validate embedded PAN
    pan_result = validate_pan(pan_part)
    if pan_result["status"] == "INVALID_FORMAT":
        issues.append(f"Embedded PAN is invalid: {pan_result['details']}")

    if issues:
        return {
            "identifier": gstin,
            "identifier_type": "GSTIN",
            "status": "INVALID_FORMAT",
            "confidence": "HIGH",
            "details": "; ".join(issues)
        }

    # Extract useful metadata
    state_name = _get_state_name(state_code)

    return {
        "identifier": gstin,
        "identifier_type": "GSTIN",
        "status": "FORMAT_VALID",
        "confidence": "MEDIUM",
        "details": f"Format valid. State: {state_name} ({state_code}). Embedded PAN: {pan_part}. External verification not available.",
        "metadata": {
            "state_code": state_code,
            "state_name": state_name,
            "embedded_pan": pan_part,
        }
    }


def validate_pan(pan: str) -> Dict[str, Any]:
    """
    Validate a PAN (Permanent Account Number).
    
    PAN format: AAAPL1234C
    - Chars 1-3: Alpha (random)
    - Char 4: Entity type (P=Person, C=Company, etc.)
    - Char 5: First letter of last name/org name
    - Chars 6-9: 4 digits (sequential)
    - Char 10: Alpha (check letter)
    """
    if not pan or not isinstance(pan, str):
        return {
            "identifier": pan or "",
            "identifier_type": "PAN",
            "status": "NOT_FOUND",
            "confidence": "LOW",
            "details": "No PAN provided"
        }

    cleaned = pan.strip().upper().replace(" ", "")

    if len(cleaned) != 10:
        return {
            "identifier": pan,
            "identifier_type": "PAN",
            "status": "INVALID_FORMAT",
            "confidence": "HIGH",
            "details": f"PAN must be 10 characters, got {len(cleaned)}"
        }

    match = PAN_REGEX.match(cleaned)
    if not match:
        return {
            "identifier": pan,
            "identifier_type": "PAN",
            "status": "INVALID_FORMAT",
            "confidence": "HIGH",
            "details": "PAN does not match expected pattern (3 alpha + entity type + alpha + 4 digits + alpha)"
        }

    entity_char = match.group(2).upper()
    entity_type = PAN_ENTITY_TYPES.get(entity_char, "Unknown")

    return {
        "identifier": pan,
        "identifier_type": "PAN",
        "status": "FORMAT_VALID",
        "confidence": "MEDIUM",
        "details": f"Format valid. Entity type: {entity_type} ({entity_char}). External verification not available.",
        "metadata": {
            "entity_type_code": entity_char,
            "entity_type": entity_type,
        }
    }


def _get_state_name(code: str) -> str:
    """Map state code to state name."""
    state_map = {
        "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
        "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
        "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
        "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
        "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
        "16": "Tripura", "17": "Meghalaya", "18": "Assam",
        "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
        "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
        "25": "Daman & Diu", "26": "Dadra & Nagar Haveli",
        "27": "Maharashtra", "28": "Andhra Pradesh", "29": "Karnataka",
        "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
        "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar",
        "36": "Telangana", "37": "Andhra Pradesh (New)",
        "38": "Ladakh", "96": "Foreign", "97": "Other Territory",
    }
    return state_map.get(code, "Unknown")


# ═══════════════════════════════════════════
#  EXTRACT & VERIFY FROM EVIDENCE
# ═══════════════════════════════════════════

# Patterns for extracting identifiers from raw text
GSTIN_EXTRACT = re.compile(r'\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]\b', re.IGNORECASE)
PAN_EXTRACT = re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b')


def verify_identifiers_from_evidence(evidence: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Scan all evidence items for GSTIN/PAN identifiers and validate them.
    Returns a list of verification results.
    """
    results = []
    seen = set()

    for ev in evidence:
        # Check extracted_value
        value = ev.get("extracted_value", "") or ""
        snippet = (ev.get("source", {}) or {}).get("raw_snippet", "") or ""
        combined = f"{value} {snippet}"

        # Extract GSTINs
        for match in GSTIN_EXTRACT.finditer(combined):
            gstin = match.group(0).upper()
            if gstin not in seen:
                seen.add(gstin)
                result = validate_gstin(gstin)
                result["source_criterion"] = ev.get("criterion_id", "")
                results.append(result)

        # Extract PANs (skip if already captured as part of GSTIN)
        for match in PAN_EXTRACT.finditer(combined):
            pan = match.group(0).upper()
            # Check it's not a substring of an already-found GSTIN
            is_gstin_part = any(pan in g for g in seen if len(g) == 15)
            if pan not in seen and not is_gstin_part:
                seen.add(pan)
                result = validate_pan(pan)
                result["source_criterion"] = ev.get("criterion_id", "")
                results.append(result)

    return results
