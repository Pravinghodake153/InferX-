"""
UBID Module — Universal Business Identifier for InferX.

UBID is the ONLY primary key used across all entities (tender, bidder, evaluation).
No custom IDs are introduced for joining data.

UBID Format: INFERX-{ENTITY_TYPE}-{HASH_12}
  - ENTITY_TYPE: TENDER | BIDDER | EVAL | PROJECT
  - HASH_12: First 12 chars of SHA-256 hash of canonical seed data

UBID is deterministic: same seed_data → same UBID.
This supports idempotency — re-processing the same input produces the same identifiers.
"""
import hashlib
import json
import re
from typing import Dict, Any, Optional, Literal


# Valid entity types
EntityType = Literal["TENDER", "BIDDER", "EVAL", "PROJECT"]

UBID_PATTERN = re.compile(r'^INFERX-(TENDER|BIDDER|EVAL|PROJECT)-([A-F0-9]{12})$')


def _canonical_json(data: Dict[str, Any]) -> str:
    """
    Produce a canonical JSON string for hashing.
    Keys are sorted, values are stringified deterministically.
    This ensures the same logical data always produces the same hash.
    """
    return json.dumps(data, sort_keys=True, default=str, ensure_ascii=True)


def generate_ubid(entity_type: EntityType, seed_data: Dict[str, Any]) -> str:
    """
    Generate a deterministic UBID from entity type and seed data.

    Args:
        entity_type: One of TENDER, BIDDER, EVAL, PROJECT
        seed_data: Dict of identifying attributes. Must include enough
                   fields to uniquely identify the entity.

    Returns:
        UBID string, e.g. "INFERX-TENDER-A3F2B8C1D4E5"

    Examples:
        >>> generate_ubid("TENDER", {"name": "CRPF Solar Panel", "reference": "RFP-2026-001"})
        'INFERX-TENDER-...'  # deterministic based on input

        >>> # Same input always produces same UBID
        >>> ubid1 = generate_ubid("BIDDER", {"name": "ABC Pvt Ltd", "gstin": "27AABCA1234M1Z0"})
        >>> ubid2 = generate_ubid("BIDDER", {"name": "ABC Pvt Ltd", "gstin": "27AABCA1234M1Z0"})
        >>> ubid1 == ubid2
        True
    """
    if entity_type not in ("TENDER", "BIDDER", "EVAL", "PROJECT"):
        raise ValueError(f"Invalid entity type: {entity_type}. Must be TENDER, BIDDER, EVAL, or PROJECT.")

    if not seed_data:
        raise ValueError("seed_data cannot be empty — need identifying attributes to generate UBID.")

    canonical = _canonical_json(seed_data)
    hash_hex = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    hash_12 = hash_hex[:12].upper()

    return f"INFERX-{entity_type}-{hash_12}"


def validate_ubid(ubid: str) -> bool:
    """
    Validate that a string is a well-formed UBID.

    Args:
        ubid: String to validate

    Returns:
        True if valid UBID format, False otherwise
    """
    if not ubid or not isinstance(ubid, str):
        return False
    return bool(UBID_PATTERN.match(ubid))


def parse_ubid(ubid: str) -> Optional[Dict[str, str]]:
    """
    Parse a UBID into its components.

    Args:
        ubid: Valid UBID string

    Returns:
        Dict with 'entity_type' and 'hash' keys, or None if invalid.

    Example:
        >>> parse_ubid("INFERX-TENDER-A3F2B8C1D4E5")
        {'entity_type': 'TENDER', 'hash': 'A3F2B8C1D4E5', 'ubid': 'INFERX-TENDER-A3F2B8C1D4E5'}
    """
    if not validate_ubid(ubid):
        return None

    match = UBID_PATTERN.match(ubid)
    return {
        "entity_type": match.group(1),
        "hash": match.group(2),
        "ubid": ubid,
    }


def generate_tender_ubid(tender_name: str, reference_no: str = "", authority: str = "") -> str:
    """
    Convenience: generate UBID for a tender document.
    Uses tender name + reference number as seed for determinism.
    """
    seed = {
        "name": (tender_name or "").strip().lower(),
        "reference_no": (reference_no or "").strip().lower(),
        "authority": (authority or "").strip().lower(),
    }
    return generate_ubid("TENDER", seed)


def generate_bidder_ubid(bidder_name: str, gstin: str = "", pan: str = "") -> str:
    """
    Convenience: generate UBID for a bidder entity.
    Uses bidder name + GSTIN/PAN as seed for determinism.
    """
    seed = {
        "name": (bidder_name or "").strip().lower(),
        "gstin": (gstin or "").strip().upper(),
        "pan": (pan or "").strip().upper(),
    }
    return generate_ubid("BIDDER", seed)


def generate_eval_ubid(tender_ubid: str, bidder_ubid: str, input_hash: str = "") -> str:
    """
    Convenience: generate UBID for an evaluation run.
    Deterministic: same tender + bidder + input → same eval UBID.
    """
    seed = {
        "tender_ubid": tender_ubid,
        "bidder_ubid": bidder_ubid,
        "input_hash": input_hash,
    }
    return generate_ubid("EVAL", seed)
