"""
Schema Map — Declarative field mapping between sandbox API and internal InferX schema.

This module defines how external sandbox fields map to internal fields.
The adapter uses these maps to normalize data WITHOUT modifying external APIs.

Rules:
  - External schema is NEVER modified
  - Missing fields in external data → None (never crash)
  - Mapping is config-driven, not hardcoded in adapter logic
"""
from typing import Dict, Any, Optional, List


# ═══════════════════════════════════════════
#  TENDER FIELD MAPPING
#  sandbox_field → internal_field
# ═══════════════════════════════════════════

TENDER_FIELD_MAP: Dict[str, str] = {
    # Identity
    "tender_id": "external_id",
    "tender_name": "name",
    "title": "name",
    "tender_title": "name",

    # Authority
    "issuing_authority": "authority",
    "authority": "authority",
    "organization": "authority",
    "department": "department",

    # Reference
    "reference_no": "reference_no",
    "ref_no": "reference_no",
    "tender_ref": "reference_no",
    "rfp_number": "reference_no",

    # Dates
    "publish_date": "publish_date",
    "published_date": "publish_date",
    "submission_deadline": "deadline",
    "last_date": "deadline",
    "closing_date": "deadline",
    "opening_date": "opening_date",

    # Financial
    "estimated_value": "estimated_value",
    "tender_value": "estimated_value",
    "emd_amount": "emd_amount",
    "earnest_money": "emd_amount",

    # Category
    "category": "category",
    "tender_type": "tender_type",
    "work_type": "work_type",

    # Criteria (may be nested)
    "criteria_list": "criteria",
    "eligibility_criteria": "criteria",
    "criteria": "criteria",

    # Location
    "location": "location",
    "state": "state",
    "district": "district",
}


# ═══════════════════════════════════════════
#  BIDDER FIELD MAPPING
# ═══════════════════════════════════════════

BIDDER_FIELD_MAP: Dict[str, str] = {
    # Identity
    "bidder_id": "external_id",
    "company_name": "name",
    "bidder_name": "name",
    "organization_name": "name",
    "firm_name": "name",

    # Registration
    "gstin": "gstin",
    "gst_no": "gstin",
    "gst_number": "gstin",
    "tax_id": "gstin",
    "pan": "pan",
    "pan_number": "pan",

    # Financial
    "annual_turnover": "turnover",
    "turnover": "turnover",
    "revenue": "turnover",
    "sales": "turnover",
    "gross_income": "turnover",
    "net_worth": "net_worth",
    "equity": "net_worth",
    "net_assets": "net_worth",
    "shareholder_equity": "net_worth",

    # Experience
    "experience_years": "experience_years",
    "years_of_experience": "experience_years",
    "similar_projects": "similar_projects",
    "completed_projects": "similar_projects",
    "past_projects": "similar_projects",

    # Certifications
    "iso_certification": "iso_cert",
    "iso_cert": "iso_cert",
    "certifications": "certifications",

    # Contact
    "email": "email",
    "phone": "phone",
    "contact_person": "contact_person",
    "address": "address",

    # Classification
    "category": "category",
    "msme_status": "msme_status",
    "registration_date": "registration_date",
}


# ═══════════════════════════════════════════
#  CRITERION FIELD MAPPING (within tender)
# ═══════════════════════════════════════════

CRITERION_FIELD_MAP: Dict[str, str] = {
    "criterion_id": "criterion_id",
    "id": "criterion_id",
    "name": "name",
    "criterion_name": "name",
    "description": "description",
    "required_value": "required_value",
    "minimum_value": "required_value",
    "threshold": "required_value",
    "type": "type",
    "data_type": "type",
    "category": "category",
    "mandatory": "mandatory",
    "is_mandatory": "mandatory",
    "units": "units",
    "unit": "units",
    "comparison_operator": "comparison_operator",
    "operator": "comparison_operator",
}


def map_fields(raw_data: Dict[str, Any], field_map: Dict[str, str]) -> Dict[str, Any]:
    """
    Map raw external data to internal schema using field_map.

    Rules:
      - First matching key wins (order-dependent for aliases)
      - Missing fields → not included in output (caller handles defaults)
      - Nested dicts/lists are passed through as-is
      - Original raw_data is never modified

    Args:
        raw_data: External API response dict
        field_map: Mapping of external_field → internal_field

    Returns:
        Dict with internal field names
    """
    result: Dict[str, Any] = {}
    seen_internal: set = set()

    for external_key, internal_key in field_map.items():
        if external_key in raw_data and internal_key not in seen_internal:
            result[internal_key] = raw_data[external_key]
            seen_internal.add(internal_key)

    return result


def map_tender(raw_tender: Dict[str, Any]) -> Dict[str, Any]:
    """Map external tender data to internal schema."""
    mapped = map_fields(raw_tender, TENDER_FIELD_MAP)

    # Handle nested criteria if present
    if "criteria" in mapped and isinstance(mapped["criteria"], list):
        mapped["criteria"] = [
            map_fields(c, CRITERION_FIELD_MAP)
            for c in mapped["criteria"]
            if isinstance(c, dict)
        ]

    return mapped


def map_bidder(raw_bidder: Dict[str, Any]) -> Dict[str, Any]:
    """Map external bidder data to internal schema."""
    return map_fields(raw_bidder, BIDDER_FIELD_MAP)


def map_criteria_list(raw_criteria: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Map a list of raw criteria to internal schema."""
    return [
        map_fields(c, CRITERION_FIELD_MAP)
        for c in raw_criteria
        if isinstance(c, dict)
    ]
