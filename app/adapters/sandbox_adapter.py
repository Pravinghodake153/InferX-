"""
Sandbox Adapter — Interoperability layer between InferX and external sandbox systems.

Architecture:
  - Hybrid mode: Uses real API if available, falls back to mock data
  - UBID is the ONLY join key across all operations
  - External sandbox schema is NEVER modified
  - All responses are normalized through schema_map

Rules:
  - If sandbox API is unavailable → graceful fallback to mock
  - If sandbox response is partial → missing fields = None
  - If sandbox schema is inconsistent → normalization handles it
  - All fetched data includes UBID for downstream joins
"""
import os
import json
import logging
from typing import Dict, Any, List, Optional

from app.adapters.schema_map import map_tender, map_bidder, map_criteria_list
from app.adapters.ubid import generate_tender_ubid, generate_bidder_ubid, validate_ubid
from app.sandbox.mock_data import (
    get_mock_tender,
    get_mock_bidder,
    get_mock_bidders_for_tender,
    list_mock_tenders,
    list_mock_bidders,
)
from app.services.normalization_service import (
    normalize_currency,
    normalize_date,
    normalize_field_name,
    auto_normalize_value,
)

logger = logging.getLogger(__name__)


class SandboxAdapter:
    """
    Adapter for interfacing with external sandbox APIs.

    Modes:
      - LIVE: Calls real sandbox API endpoints
      - MOCK: Uses local mock_data.py for testing

    Usage:
        adapter = SandboxAdapter()                    # auto-detect mode
        adapter = SandboxAdapter(base_url="https://sandbox.example.com", api_key="xxx")  # live mode

        tender = await adapter.fetch_tender_by_ubid("INFERX-TENDER-D4E5F6A7B8C9")
        bidders = await adapter.fetch_bidders_for_tender("INFERX-TENDER-D4E5F6A7B8C9")
    """

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        self.base_url = base_url or os.getenv("SANDBOX_API_URL")
        self.api_key = api_key or os.getenv("SANDBOX_API_KEY")
        self.mode = "LIVE" if self.base_url else "MOCK"
        logger.info(f"[SandboxAdapter] Initialized in {self.mode} mode")

    def _is_live(self) -> bool:
        return self.mode == "LIVE" and self.base_url is not None

    # ═══════════════════════════════════════════
    #  TENDER OPERATIONS
    # ═══════════════════════════════════════════

    async def fetch_tender_by_ubid(self, ubid: str) -> Dict[str, Any]:
        """
        Fetch tender data by UBID.

        Returns normalized tender dict with UBID as primary key.
        Falls back to mock data if live API is unavailable.
        """
        if not validate_ubid(ubid):
            logger.warning(f"[SandboxAdapter] Invalid UBID format: {ubid}")
            return {"ubid": ubid, "error": "INVALID_UBID", "data": {}}

        raw_data = {}

        if self._is_live():
            raw_data = await self._api_call("GET", f"/api/tenders/{ubid}")
        else:
            raw_data = get_mock_tender(ubid)

        if not raw_data:
            logger.info(f"[SandboxAdapter] No tender found for UBID: {ubid}")
            return {"ubid": ubid, "found": False, "data": {}}

        # Normalize through schema map
        normalized = map_tender(raw_data)
        normalized["ubid"] = ubid
        normalized["found"] = True
        normalized["source"] = self.mode

        # Normalize values
        normalized = self._normalize_tender_values(normalized)

        return normalized

    async def fetch_bidder_by_ubid(self, ubid: str) -> Dict[str, Any]:
        """
        Fetch bidder data by UBID.

        Returns normalized bidder dict with UBID as primary key.
        """
        if not validate_ubid(ubid):
            logger.warning(f"[SandboxAdapter] Invalid UBID format: {ubid}")
            return {"ubid": ubid, "error": "INVALID_UBID", "data": {}}

        raw_data = {}

        if self._is_live():
            raw_data = await self._api_call("GET", f"/api/bidders/{ubid}")
        else:
            raw_data = get_mock_bidder(ubid)

        if not raw_data:
            logger.info(f"[SandboxAdapter] No bidder found for UBID: {ubid}")
            return {"ubid": ubid, "found": False, "data": {}}

        normalized = map_bidder(raw_data)
        normalized["ubid"] = ubid
        normalized["found"] = True
        normalized["source"] = self.mode

        # Normalize values
        normalized = self._normalize_bidder_values(normalized)

        return normalized

    async def fetch_bidders_for_tender(self, tender_ubid: str) -> List[Dict[str, Any]]:
        """
        Fetch all bidders participating in a given tender.

        Returns list of normalized bidder dicts.
        """
        if not validate_ubid(tender_ubid):
            return []

        if self._is_live():
            raw_list = await self._api_call("GET", f"/api/tenders/{tender_ubid}/bidders")
            if not isinstance(raw_list, list):
                raw_list = []
        else:
            raw_list = get_mock_bidders_for_tender(tender_ubid)

        results = []
        for raw_bidder in raw_list:
            normalized = map_bidder(raw_bidder)
            normalized["ubid"] = raw_bidder.get("ubid", "")
            normalized["found"] = True
            normalized["source"] = self.mode
            normalized = self._normalize_bidder_values(normalized)
            results.append(normalized)

        return results

    async def list_tenders(self) -> List[Dict[str, Any]]:
        """List all available tenders."""
        if self._is_live():
            raw_list = await self._api_call("GET", "/api/tenders")
            if not isinstance(raw_list, list):
                raw_list = []
        else:
            raw_list = list_mock_tenders()

        results = []
        for raw in raw_list:
            normalized = map_tender(raw)
            normalized["ubid"] = raw.get("ubid", "")
            normalized["source"] = self.mode
            results.append(normalized)

        return results

    async def list_bidders(self) -> List[Dict[str, Any]]:
        """List all available bidders."""
        if self._is_live():
            raw_list = await self._api_call("GET", "/api/bidders")
            if not isinstance(raw_list, list):
                raw_list = []
        else:
            raw_list = list_mock_bidders()

        results = []
        for raw in raw_list:
            normalized = map_bidder(raw)
            normalized["ubid"] = raw.get("ubid", "")
            normalized["source"] = self.mode
            results.append(normalized)

        return results

    # ═══════════════════════════════════════════
    #  VALUE NORMALIZATION (post-fetch)
    # ═══════════════════════════════════════════

    def _normalize_tender_values(self, tender: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize tender field values after schema mapping."""
        if "estimated_value" in tender and tender["estimated_value"]:
            tender["estimated_value_normalized"] = normalize_currency(
                str(tender["estimated_value"])
            )
        if "emd_amount" in tender and tender["emd_amount"]:
            tender["emd_amount_normalized"] = normalize_currency(
                str(tender["emd_amount"])
            )
        if "publish_date" in tender and tender["publish_date"]:
            normalized_date = normalize_date(str(tender["publish_date"]))
            if normalized_date:
                tender["publish_date"] = normalized_date
        if "deadline" in tender and tender["deadline"]:
            normalized_date = normalize_date(str(tender["deadline"]))
            if normalized_date:
                tender["deadline"] = normalized_date

        # Normalize criteria values if present
        if "criteria" in tender and isinstance(tender["criteria"], list):
            for criterion in tender["criteria"]:
                if "required_value" in criterion and criterion["required_value"]:
                    criterion["required_value_normalized"] = auto_normalize_value(
                        str(criterion["required_value"]),
                        criterion.get("type", "auto")
                    )

        return tender

    def _normalize_bidder_values(self, bidder: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize bidder field values after schema mapping."""
        if "turnover" in bidder and bidder["turnover"]:
            bidder["turnover_normalized"] = normalize_currency(str(bidder["turnover"]))
        if "net_worth" in bidder and bidder["net_worth"]:
            bidder["net_worth_normalized"] = normalize_currency(str(bidder["net_worth"]))

        return bidder

    # ═══════════════════════════════════════════
    #  LIVE API CALLS (when real sandbox is available)
    # ═══════════════════════════════════════════

    async def _api_call(self, method: str, path: str, body: Dict = None) -> Any:
        """
        Make a real HTTP call to the sandbox API.
        Returns parsed JSON response or empty dict on failure.

        This method gracefully handles:
          - Connection errors → falls back to empty response
          - Invalid JSON → returns empty dict
          - Non-200 status → logs warning, returns empty dict
        """
        import httpx

        url = f"{self.base_url.rstrip('/')}{path}"
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        headers["Content-Type"] = "application/json"

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                if method.upper() == "GET":
                    resp = await client.get(url, headers=headers)
                elif method.upper() == "POST":
                    resp = await client.post(url, headers=headers, json=body or {})
                else:
                    logger.error(f"[SandboxAdapter] Unsupported HTTP method: {method}")
                    return {}

                if resp.status_code == 200:
                    return resp.json()
                else:
                    logger.warning(
                        f"[SandboxAdapter] API returned {resp.status_code} for {url}: {resp.text[:200]}"
                    )
                    return {}

        except Exception as e:
            logger.error(f"[SandboxAdapter] API call failed for {url}: {e}")
            return {}
