"""
Mock Sandbox Data — Realistic CRPF tender and bidder data for testing.

Used by SandboxAdapter in mock mode when no real sandbox API is available.
Data patterns match real Indian government tender formats.

All entities have pre-assigned UBIDs for deterministic testing.
"""
from typing import Dict, Any, List


# ═══════════════════════════════════════════
#  MOCK TENDERS
# ═══════════════════════════════════════════

MOCK_TENDERS: Dict[str, Dict[str, Any]] = {
    "INFERX-TENDER-D4E5F6A7B8C9": {
        "tender_id": "CRPF-RFP-2026-001",
        "tender_name": "Supply of Solar Panel Systems for CRPF Campuses",
        "issuing_authority": "Central Reserve Police Force (CRPF)",
        "department": "Engineering Division",
        "reference_no": "CRPF/ENG/SOLAR/2026-27/001",
        "publish_date": "2026-01-15",
        "submission_deadline": "2026-03-15",
        "opening_date": "2026-03-16",
        "estimated_value": "₹15 Crore",
        "emd_amount": "₹30 Lakh",
        "category": "Works",
        "tender_type": "Open Tender",
        "location": "Pan India",
        "state": "Delhi",
        "eligibility_criteria": [
            {
                "criterion_id": "C001",
                "name": "Annual Turnover",
                "description": "Minimum annual turnover for last 3 financial years",
                "required_value": "₹5 Crore",
                "type": "numeric",
                "category": "financial",
                "mandatory": True,
                "comparison_operator": ">=",
                "units": "INR"
            },
            {
                "criterion_id": "C002",
                "name": "GST Registration",
                "description": "Valid GST registration certificate",
                "required_value": "Valid GSTIN",
                "type": "document",
                "category": "compliance",
                "mandatory": True,
            },
            {
                "criterion_id": "C003",
                "name": "Similar Project Experience",
                "description": "Minimum number of similar projects completed in last 5 years",
                "required_value": "3 projects",
                "type": "numeric",
                "category": "technical",
                "mandatory": True,
                "comparison_operator": ">=",
                "units": "count"
            },
            {
                "criterion_id": "C004",
                "name": "ISO Certification",
                "description": "Valid ISO 9001 quality management certification",
                "required_value": "ISO 9001",
                "type": "document",
                "category": "technical",
                "mandatory": True,
            },
            {
                "criterion_id": "C005",
                "name": "Net Worth",
                "description": "Minimum net worth as per latest audited balance sheet",
                "required_value": "₹2 Crore",
                "type": "numeric",
                "category": "financial",
                "mandatory": True,
                "comparison_operator": ">=",
                "units": "INR"
            },
        ],
    },
    "INFERX-TENDER-1A2B3C4D5E6F": {
        "tender_id": "CRPF-RFP-2026-002",
        "tender_name": "Annual Maintenance Contract for IT Infrastructure",
        "issuing_authority": "Central Reserve Police Force (CRPF)",
        "department": "IT Division",
        "reference_no": "CRPF/IT/AMC/2026-27/002",
        "publish_date": "2026-02-01",
        "submission_deadline": "2026-04-01",
        "estimated_value": "₹8 Crore",
        "emd_amount": "₹16 Lakh",
        "category": "Services",
        "tender_type": "Limited Tender",
        "location": "Delhi NCR",
        "state": "Delhi",
        "eligibility_criteria": [
            {
                "criterion_id": "C001",
                "name": "Annual Turnover",
                "required_value": "₹3 Crore",
                "type": "numeric",
                "category": "financial",
                "mandatory": True,
                "comparison_operator": ">=",
                "units": "INR"
            },
            {
                "criterion_id": "C002",
                "name": "GST Registration",
                "required_value": "Valid GSTIN",
                "type": "document",
                "category": "compliance",
                "mandatory": True,
            },
            {
                "criterion_id": "C003",
                "name": "IT AMC Experience",
                "required_value": "5 years",
                "type": "numeric",
                "category": "technical",
                "mandatory": True,
                "comparison_operator": ">=",
                "units": "years"
            },
        ],
    },
}


# ═══════════════════════════════════════════
#  MOCK BIDDERS
# ═══════════════════════════════════════════

MOCK_BIDDERS: Dict[str, Dict[str, Any]] = {
    # Bidder 1: ELIGIBLE — meets all criteria
    "INFERX-BIDDER-7E9F1A2B3C4D": {
        "bidder_id": "BID-SOLAR-001",
        "company_name": "Sunrise Solar Solutions Pvt Ltd",
        "gstin": "27AABCS1234M1Z5",
        "pan": "AABCS1234M",
        "annual_turnover": "₹6.2 Crore",
        "net_worth": "₹3.1 Crore",
        "experience_years": 8,
        "similar_projects": 5,
        "iso_certification": "ISO 9001:2015 (Valid till 2028)",
        "certifications": ["ISO 9001:2015", "ISO 14001:2015"],
        "email": "info@sunrisesolar.com",
        "phone": "+91-9876543210",
        "address": "Plot 42, MIDC, Pune, Maharashtra",
        "category": "Class I Contractor",
        "msme_status": "Medium Enterprise",
        "registration_date": "2018-03-15",
        # Link to tenders this bidder is participating in
        "tender_ubids": ["INFERX-TENDER-D4E5F6A7B8C9"],
    },
    # Bidder 2: NOT ELIGIBLE — fails turnover and net worth
    "INFERX-BIDDER-B2C3D4E5F6A7": {
        "bidder_id": "BID-SOLAR-002",
        "company_name": "GreenTech Enterprises",
        "gstin": "07AAECG5678N1Z3",
        "pan": "AAECG5678N",
        "annual_turnover": "₹2.8 Crore",
        "net_worth": "₹1.2 Crore",
        "experience_years": 3,
        "similar_projects": 2,
        "iso_certification": None,
        "certifications": [],
        "email": "contact@greentech.in",
        "phone": "+91-9012345678",
        "address": "Sector 18, Noida, Uttar Pradesh",
        "category": "Class II Contractor",
        "msme_status": "Small Enterprise",
        "registration_date": "2023-06-20",
        "tender_ubids": ["INFERX-TENDER-D4E5F6A7B8C9"],
    },
    # Bidder 3: BORDERLINE — meets some, review needed for others
    "INFERX-BIDDER-F8A9B0C1D2E3": {
        "bidder_id": "BID-SOLAR-003",
        "company_name": "PowerGrid Infrastructure Ltd",
        "gstin": "29AABCP4567Q1Z8",
        "pan": "AABCP4567Q",
        "annual_turnover": "₹5.1 Crore",
        "net_worth": "₹1.8 Crore",
        "experience_years": 6,
        "similar_projects": 3,
        "iso_certification": "ISO 9001:2015 (Expired 2025)",
        "certifications": ["ISO 9001:2015 (Expired)"],
        "email": "bids@powergrid-infra.com",
        "phone": "+91-8765432109",
        "address": "Whitefield, Bengaluru, Karnataka",
        "category": "Class I Contractor",
        "msme_status": "Medium Enterprise",
        "registration_date": "2020-01-10",
        "tender_ubids": ["INFERX-TENDER-D4E5F6A7B8C9"],
    },
}


# ═══════════════════════════════════════════
#  LOOKUP HELPERS
# ═══════════════════════════════════════════

def get_mock_tender(ubid: str) -> Dict[str, Any]:
    """
    Fetch a mock tender by UBID.
    Returns empty dict if not found (graceful degradation).
    """
    return dict(MOCK_TENDERS.get(ubid, {}))


def get_mock_bidder(ubid: str) -> Dict[str, Any]:
    """
    Fetch a mock bidder by UBID.
    Returns empty dict if not found.
    """
    return dict(MOCK_BIDDERS.get(ubid, {}))


def get_mock_bidders_for_tender(tender_ubid: str) -> List[Dict[str, Any]]:
    """
    Fetch all mock bidders participating in a given tender.
    """
    results = []
    for bidder_ubid, bidder_data in MOCK_BIDDERS.items():
        if tender_ubid in bidder_data.get("tender_ubids", []):
            entry = dict(bidder_data)
            entry["ubid"] = bidder_ubid
            results.append(entry)
    return results


def list_mock_tenders() -> List[Dict[str, Any]]:
    """Return all mock tenders with their UBIDs."""
    results = []
    for ubid, data in MOCK_TENDERS.items():
        entry = dict(data)
        entry["ubid"] = ubid
        results.append(entry)
    return results


def list_mock_bidders() -> List[Dict[str, Any]]:
    """Return all mock bidders with their UBIDs."""
    results = []
    for ubid, data in MOCK_BIDDERS.items():
        entry = dict(data)
        entry["ubid"] = ubid
        results.append(entry)
    return results
