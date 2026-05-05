import re
from datetime import datetime, date
from typing import List, Dict, Any, Optional

try:
    from dateutil import parser as dateutil_parser  # type: ignore
except Exception:
    dateutil_parser = None


def normalize_date(value: str) -> Optional[date]:
    """
    Parse various date formats common in Indian government documents.
    Handles: DD-MM-YYYY, DD/MM/YYYY, March 2024, FY 2023-24, etc.
    Returns a date object or None if parsing fails.
    """
    if not isinstance(value, str) or not value.strip():
        return None

    text = value.strip()

    # Handle "FY 2023-24" → March 31, 2024
    fy_match = re.search(r'FY\s*(\d{4})[/-](\d{2,4})', text, re.IGNORECASE)
    if fy_match:
        end_year = fy_match.group(2)
        if len(end_year) == 2:
            end_year = fy_match.group(1)[:2] + end_year
        try:
            return date(int(end_year), 3, 31)
        except ValueError:
            pass

    # Handle "last N years" → compute cutoff date
    years_match = re.search(r'(?:last|past)\s+(\d+)\s+years?', text, re.IGNORECASE)
    if years_match:
        n = int(years_match.group(1))
        today = date.today()
        try:
            return date(today.year - n, today.month, today.day)
        except ValueError:
            return date(today.year - n, today.month, min(today.day, 28))

    # Use dateutil for everything else
    if dateutil_parser is not None:
        try:
            parsed = dateutil_parser.parse(text, dayfirst=True)  # Indian format: DD/MM/YYYY
            return parsed.date()
        except (ValueError, OverflowError):
            pass

    return None


def normalize_indian_currency(value: str) -> float:
    """
    Normalize Indian currency strings to a numeric value in INR.
    Handles: ₹, Crore, Cr, Lakh, Lac, commas, and plain numbers.
    
    Examples:
        "₹5 crore"       → 50000000.0
        "5 Cr"            → 50000000.0
        "₹6.2 crore"     → 62000000.0
        "₹50 lakh"       → 5000000.0
        "1,50,000"        → 150000.0
        "₹1.8 crore"     → 18000000.0
    """
    if not isinstance(value, str):
        return 0.0

    text = value.lower().strip()
    # Remove currency symbols and whitespace variations
    text = text.replace("₹", "").replace("rs.", "").replace("rs", "").replace("inr", "").strip()
    # Remove commas (Indian style: 1,50,000 or Western: 1,500,000)
    text = text.replace(",", "")

    # Try to find a number followed by a multiplier
    crore_match = re.search(r'([\d.]+)\s*(?:crore|cr)', text)
    if crore_match:
        return float(crore_match.group(1)) * 1e7

    lakh_match = re.search(r'([\d.]+)\s*(?:lakh|lac|lakhs)', text)
    if lakh_match:
        return float(lakh_match.group(1)) * 1e5

    thousand_match = re.search(r'([\d.]+)\s*(?:thousand|k)', text)
    if thousand_match:
        return float(thousand_match.group(1)) * 1e3

    # Fallback: extract plain number
    digits = re.sub(r'[^\d.]+', '', text)
    try:
        return float(digits) if digits else 0.0
    except ValueError:
        return 0.0


def normalize(value: str) -> float:
    """
    Universal normalizer. First tries Indian currency normalization,
    then falls back to plain numeric extraction.
    """
    if not isinstance(value, str):
        return 0.0

    # Try Indian currency first (handles crore/lakh/₹)
    result = normalize_indian_currency(value)
    if result > 0.0:
        return result

    # Fallback: strip all non-numeric characters
    digits = re.sub(r'[^\d.]+', '', value)
    try:
        return float(digits) if digits else 0.0
    except ValueError:
        return 0.0


def find_matching_evidence(criterion: Dict[str, Any], evidence_list: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Helper to locate the matching evidence array element for a given criterion_id"""
    for ev in evidence_list:
        if ev.get("criterion_id") == criterion.get("criterion_id"):
            return ev
    return None


def evaluate(criteria: List[Dict[str, Any]], evidence: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deterministic rule engine that evaluates whether evidence fulfills the criteria.
    Doesn't rely on LLM for logical evaluation, just threshold comparisons.
    
    Enhanced with:
    - Indian currency normalization (₹, Crore, Lakh)
    - Confidence propagation from evidence
    - Reason field for explainability
    """
    results = []

    for c in criteria:
        ev = find_matching_evidence(c, evidence)
        
        reason = ""
        confidence = "LOW"

        # Determine the logical result based on standard rules
        if ev is None or ev.get("extracted_value") is None:
            # Missing completely
            result = "REVIEW"
            confidence = "LOW"
            if c.get("mandatory", False):
                reason = f"Mandatory criterion '{c.get('name')}' — no evidence found in bidder document."
            else:
                reason = f"Optional criterion '{c.get('name')}' — no evidence found, manual review needed."

        elif c.get("type", "").lower() == "numeric":
            # Compare numeric thresholds using Indian currency normalization
            req_val = c.get("required_value", "")
            ext_val = ev.get("extracted_value", "")
            
            # Use normalized values from LLM if available, otherwise normalize ourselves
            req_num = ev.get("normalized_value") if c.get("normalized_required_value") is None else c.get("normalized_required_value")
            if req_num is None or not isinstance(req_num, (int, float)):
                req_num = normalize(str(req_val))
            
            ext_num = ev.get("normalized_value")
            if ext_num is None or not isinstance(ext_num, (int, float)):
                ext_num = normalize(str(ext_val))

            # Determine comparison operator
            op = c.get("comparison_operator", ">=")
            
            if op == ">=" and ext_num >= req_num:
                result = "PASS"
                reason = f"Required: {req_val} (₹{req_num:,.0f}) | Found: {ext_val} (₹{ext_num:,.0f}) — meets threshold."
            elif op == "<=" and ext_num <= req_num:
                result = "PASS"
                reason = f"Required: ≤{req_val} | Found: {ext_val} — within limit."
            elif op == "==" and ext_num == req_num:
                result = "PASS"
                reason = f"Required: {req_val} | Found: {ext_val} — exact match."
            elif req_num == 0.0 or ext_num == 0.0:
                result = "REVIEW"
                reason = f"Could not parse numeric values. Required: '{req_val}' | Found: '{ext_val}'. Manual review needed."
            else:
                result = "FAIL"
                reason = f"Required: {req_val} (₹{req_num:,.0f}) | Found: {ext_val} (₹{ext_num:,.0f}) — does NOT meet threshold."
            
            confidence = ev.get("confidence", "MEDIUM")

        else:
            # For non-numeric (booleans, docs like ISO cert, etc)
            if ev.get("extracted_value"):
                result = "PASS"
                reason = f"Evidence found: '{ev.get('extracted_value')}'"
                confidence = ev.get("confidence", "MEDIUM")
            else:
                result = "REVIEW"
                reason = f"No clear evidence for '{c.get('name')}'. Manual review needed."
                confidence = "LOW"

        results.append({
            "criterion_id": c.get("criterion_id"),
            "criteria_name": c.get("name"),
            "category": c.get("category", ""),
            "required_value": c.get("required_value"),
            "evidence_found": ev.get("extracted_value") if ev else None,
            "result": result,
            "confidence": confidence,
            "reason": reason
        })

    return results
