"""
Normalization Service — Standardize extracted values for deterministic comparison.

Centralizes all value normalization that was previously scattered across modules.
Used by the rule engine, variance detection, and explainability engine.

Supports:
  - Indian currency (₹, Crore, Lakh, Thousand)
  - Dates (various formats → YYYY-MM-DD)
  - Percentages
  - Durations (years, months)
  - Semantic field name equivalents
"""
import re
from typing import Optional, Dict, Any, List
from datetime import datetime


# ═══════════════════════════════════════════
#  CURRENCY NORMALIZATION
# ═══════════════════════════════════════════

def normalize_currency(value: str) -> float:
    """
    Normalize Indian currency strings to a numeric value in INR.

    Handles: ₹, Crore, Cr, Lakh, Lac, commas, and plain numbers.

    Examples:
        "₹5 crore"     → 50000000.0
        "₹6.2 crore"   → 62000000.0
        "₹50 lakh"     → 5000000.0
        "1,50,000"      → 150000.0
        "₹1.8 crore"   → 18000000.0
    """
    if not isinstance(value, str):
        return 0.0

    text = value.lower().strip()
    text = text.replace("₹", "").replace("rs.", "").replace("rs", "").replace("inr", "").strip()
    text = text.replace(",", "")

    crore_match = re.search(r'([\d.]+)\s*(?:crore|cr)', text)
    if crore_match:
        return float(crore_match.group(1)) * 1e7

    lakh_match = re.search(r'([\d.]+)\s*(?:lakh|lac|lakhs)', text)
    if lakh_match:
        return float(lakh_match.group(1)) * 1e5

    thousand_match = re.search(r'([\d.]+)\s*(?:thousand|k)', text)
    if thousand_match:
        return float(thousand_match.group(1)) * 1e3

    digits = re.sub(r'[^\d.]+', '', text)
    try:
        return float(digits) if digits else 0.0
    except ValueError:
        return 0.0


def format_currency_inr(amount: float) -> str:
    """
    Format a numeric INR amount to human-readable string.

    Examples:
        50000000.0 → "₹5.00 Crore"
        5000000.0  → "₹50.00 Lakh"
        150000.0   → "₹1,50,000"
    """
    if amount >= 1e7:
        return f"₹{amount / 1e7:.2f} Crore"
    elif amount >= 1e5:
        return f"₹{amount / 1e5:.2f} Lakh"
    else:
        return f"₹{amount:,.0f}"


# ═══════════════════════════════════════════
#  DATE NORMALIZATION
# ═══════════════════════════════════════════

DATE_FORMATS = [
    "%Y-%m-%d",          # 2026-01-15
    "%d-%m-%Y",          # 15-01-2026
    "%d/%m/%Y",          # 15/01/2026
    "%Y/%m/%d",          # 2026/01/15
    "%d %B %Y",          # 15 January 2026
    "%d %b %Y",          # 15 Jan 2026
    "%B %d, %Y",         # January 15, 2026
    "%b %d, %Y",         # Jan 15, 2026
    "%d.%m.%Y",          # 15.01.2026
    "%d-%b-%Y",          # 15-Jan-2026
    "%d %B, %Y",         # 15 January, 2026
]


def normalize_date(value: str) -> Optional[str]:
    """
    Normalize various date formats to YYYY-MM-DD.

    Returns None if the date cannot be parsed.

    Examples:
        "15-01-2026"     → "2026-01-15"
        "15 January 2026" → "2026-01-15"
        "Jan 15, 2026"   → "2026-01-15"
    """
    if not isinstance(value, str) or not value.strip():
        return None

    text = value.strip()

    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue

    return None


# ═══════════════════════════════════════════
#  PERCENTAGE NORMALIZATION
# ═══════════════════════════════════════════

def normalize_percentage(value: str) -> Optional[float]:
    """
    Extract percentage value from string.

    Examples:
        "12%"       → 12.0
        "12 percent" → 12.0
        "0.12"      → 12.0 (if < 1, assumes it's a ratio)
    """
    if not isinstance(value, str):
        return None

    text = value.lower().strip()
    match = re.search(r'([\d.]+)\s*(?:%|percent|pct)', text)
    if match:
        return float(match.group(1))

    # Try plain number
    digits = re.sub(r'[^\d.]+', '', text)
    if digits:
        try:
            num = float(digits)
            if 0 < num < 1:
                return num * 100  # Assume ratio
            return num
        except ValueError:
            pass

    return None


# ═══════════════════════════════════════════
#  DURATION NORMALIZATION
# ═══════════════════════════════════════════

def normalize_duration(value: str) -> Optional[Dict[str, Any]]:
    """
    Parse duration strings.

    Examples:
        "3 years"    → {"value": 3, "unit": "years"}
        "18 months"  → {"value": 18, "unit": "months"}
        "5"          → {"value": 5, "unit": "unknown"}
    """
    if not isinstance(value, str):
        return None

    text = value.lower().strip()

    year_match = re.search(r'([\d.]+)\s*(?:year|yr|yrs|years)', text)
    if year_match:
        return {"value": float(year_match.group(1)), "unit": "years"}

    month_match = re.search(r'([\d.]+)\s*(?:month|months|mo)', text)
    if month_match:
        return {"value": float(month_match.group(1)), "unit": "months"}

    day_match = re.search(r'([\d.]+)\s*(?:day|days)', text)
    if day_match:
        return {"value": float(day_match.group(1)), "unit": "days"}

    # Plain number
    digits = re.sub(r'[^\d.]+', '', text)
    if digits:
        try:
            return {"value": float(digits), "unit": "unknown"}
        except ValueError:
            pass

    return None


# ═══════════════════════════════════════════
#  COUNT NORMALIZATION
# ═══════════════════════════════════════════

def normalize_count(value: str) -> Optional[float]:
    """
    Extract a numeric count from text.

    Examples:
        "3 projects"     → 3.0
        "5"              → 5.0
        "at least 3"     → 3.0
    """
    if not isinstance(value, str):
        return None

    text = value.lower().strip()
    match = re.search(r'([\d.]+)', text)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return None


# ═══════════════════════════════════════════
#  SEMANTIC FIELD EQUIVALENTS
# ═══════════════════════════════════════════

SEMANTIC_EQUIVALENTS: Dict[str, List[str]] = {
    "turnover": [
        "revenue", "sales", "gross income", "annual turnover",
        "total turnover", "aggregate turnover", "gross turnover",
    ],
    "gstin": [
        "gst no", "gst number", "tax id", "gst registration",
        "gst registration number", "gst certificate",
    ],
    "pan": [
        "pan number", "permanent account number", "pan card",
    ],
    "net_worth": [
        "equity", "net assets", "shareholder equity",
        "shareholders equity", "net asset value",
    ],
    "iso_cert": [
        "iso certification", "iso 9001", "quality certification",
        "iso certificate", "quality management",
    ],
    "experience": [
        "years of experience", "experience years",
        "work experience", "relevant experience",
    ],
    "similar_projects": [
        "completed projects", "past projects",
        "relevant projects", "project experience",
    ],
    "emd": [
        "earnest money", "earnest money deposit",
        "bid security", "bid bond",
    ],
}


def normalize_field_name(name: str) -> str:
    """
    Normalize a field name to its canonical form using semantic equivalents.

    Examples:
        "Annual Turnover"  → "turnover"
        "GST No"           → "gstin"
        "Net Assets"       → "net_worth"
        "Random Field"     → "random field"  (unchanged, lowered)
    """
    if not isinstance(name, str):
        return ""

    lower_name = name.lower().strip()

    for canonical, equivalents in SEMANTIC_EQUIVALENTS.items():
        if lower_name == canonical or lower_name in equivalents:
            return canonical

    return lower_name


def auto_normalize_value(value: str, data_type: str = "auto") -> Any:
    """
    Automatically normalize a value based on its detected or specified type.

    Args:
        value: Raw value string
        data_type: "numeric", "date", "percentage", "duration", "count", or "auto"

    Returns:
        Normalized value (float, str, dict) or original string if cannot normalize
    """
    if not isinstance(value, str) or not value.strip():
        return value

    if data_type == "numeric" or data_type == "auto":
        currency = normalize_currency(value)
        if currency > 0:
            return currency

    if data_type == "date" or data_type == "auto":
        date = normalize_date(value)
        if date:
            return date

    if data_type == "percentage" or data_type == "auto":
        pct = normalize_percentage(value)
        if pct is not None:
            return pct

    if data_type == "duration" or data_type == "auto":
        dur = normalize_duration(value)
        if dur:
            return dur

    if data_type == "count" or data_type == "auto":
        count = normalize_count(value)
        if count is not None:
            return count

    return value
