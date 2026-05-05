from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field

# Confidence type based on rules
ConfidenceLevel = Literal["HIGH", "MEDIUM", "LOW"]

# ==========================================
# 1. Tender Analyzer Schemas
# ==========================================

class SourceInfo(BaseModel):
    page: Optional[int] = 0
    raw_snippet: Optional[str] = ""
    source_type: Optional[str] = None

class Criterion(BaseModel):
    criterion_id: Optional[str] = "unknown_id"
    name: Optional[str] = "Unnamed Criterion"
    description: Optional[str] = ""
    required_value: Optional[str] = None
    normalized_required_value: Optional[Any] = None
    type: Optional[str] = "subjective"
    category: Optional[str] = None
    mandatory: Optional[bool] = True
    comparison_operator: Optional[str] = None
    units: Optional[str] = None
    source: Optional[SourceInfo] = None
    confidence: Optional[ConfidenceLevel] = "MEDIUM"

class TenderCriteriaList(BaseModel):
    criteria: List[Criterion]

# ==========================================
# 2. Bidder Parser Schemas
# ==========================================

class BidderSourceInfo(BaseModel):
    document: Optional[str] = ""
    page: Optional[int] = 0
    raw_snippet: Optional[str] = ""
    source_type: Optional[str] = None

class Evidence(BaseModel):
    criterion_id: Optional[str] = "unknown_id"
    field_detected: Optional[str] = ""
    extracted_value: Optional[str] = None
    normalized_value: Optional[Any] = None
    source: Optional[BidderSourceInfo] = None
    confidence: Optional[ConfidenceLevel] = "MEDIUM"

class BidderEvidenceList(BaseModel):
    evidence: List[Evidence]

# ==========================================
# 3. Field Mapping Schemas
# ==========================================

class MappedField(BaseModel):
    mapped_field: Optional[str] = None
    confidence: Optional[ConfidenceLevel] = "LOW"
    reason: Optional[str] = ""

class FieldMappingEntry(BaseModel):
    criterion_id: Optional[str] = "unknown_id"
    matched_field: Optional[str] = None
    mapping_confidence: Optional[ConfidenceLevel] = "LOW"
    reason: Optional[str] = None

class FieldMappingList(BaseModel):
    mappings: List[FieldMappingEntry]

# ==========================================
# 4. Error / Vigilance Detection Schemas
# ==========================================

IssueSeverity = Literal["HIGH", "MEDIUM", "LOW"]
IssueType = Literal[
    "MISSING_VALUE",
    "LOW_CONFIDENCE",
    "OCR_UNCERTAIN",
    "CONFLICTING_VALUES",
    "HIGH_SIMILARITY",
    "ANOMALY",
    "OTHER"
]

class Issue(BaseModel):
    criterion_id: Optional[str] = None
    issue_type: Optional[IssueType] = "OTHER"
    reason: Optional[str] = "No reason provided"
    severity: Optional[IssueSeverity] = "LOW"
    description: Optional[str] = None
    affected_bidders: Optional[List[str]] = None
    confidence: Optional[ConfidenceLevel] = None

class ErrorDetectionReport(BaseModel):
    issues: List[Issue]

# ==========================================
# 5. PII Masking Schemas
# ==========================================

class PIIMappingEntry(BaseModel):
    token: Optional[str] = None
    original: Optional[str] = None
    type: Optional[str] = "unknown"

# ==========================================
# 6. Final Evaluation Schemas (LLM-based)
# ==========================================

VerdictType = Literal["PASS", "FAIL", "REVIEW_REQUIRED"]

class FinalEvaluationEntry(BaseModel):
    criterion_id: Optional[str] = "unknown_id"
    required_value: Optional[str] = None
    extracted_value: Optional[str] = None
    verdict: Optional[VerdictType] = "REVIEW_REQUIRED"
    confidence: Optional[ConfidenceLevel] = "LOW"
    reason: Optional[str] = ""
    source: Optional[BidderSourceInfo] = None

class FinalEvaluationReport(BaseModel):
    evaluations: List[FinalEvaluationEntry]

# ==========================================
# 7. Verification Layer Schemas
# ==========================================

VerificationStatus = Literal["FORMAT_VALID", "INVALID_FORMAT", "NOT_FOUND", "MISMATCH"]

class VerificationEntry(BaseModel):
    identifier: Optional[str] = ""
    identifier_type: Optional[str] = ""
    status: Optional[VerificationStatus] = "NOT_FOUND"
    confidence: Optional[ConfidenceLevel] = "LOW"
    details: Optional[str] = None
    source_criterion: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

# ==========================================
# 8. OCR Cleaning Schemas
# ==========================================

class OCRCleanResult(BaseModel):
    cleaned_text: str
