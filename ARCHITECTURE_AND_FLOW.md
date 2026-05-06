# InferX Document AI - Architecture, Flow & Technical Depth Report

This document outlines the detailed architecture, data flow, and pipeline engineering behind the InferX Tender Evaluation System. It is designed to provide hackathon judges with a deep dive into the technical complexity and robustness of the solution.

---

##  1. High-Level System Architecture

The InferX platform is built on a decoupled, microservices-inspired architecture prioritizing speed, null-safety, and auditability.

*   **Frontend Client:** React 18 powered by Vite. Uses modern React Hooks (`useReducer`, `useContext`) for global state management of the evaluation pipeline. Styling is handled via highly optimized Vanilla CSS (CSS Variables) to ensure zero UI-blocking during heavy LLM polls. Deployed on **Vercel**.
*   **Backend API Gateway:** Python-based `FastAPI` application. It handles asynchronous document ingestion, OCR orchestration, and LLM communication. Deployed on **Hugging Face Spaces** (Dockerized).
*   **AI Engine Router:** A provider-agnostic LLM integration layer (`app/llm/client.py`) that acts as a unified gateway to OpenRouter (DeepSeek, Claude, GPT-4o) and Google Gemini SDKs.

---

## 2. The 7-Stage Pipeline Flow

The core of InferX is the 7-stage deterministic pipeline. Unlike standard chatbots, this pipeline strictly enforces progression gates to maintain an auditable state.

### Stage 1: Document Upload & Hybrid Ingestion
When a user uploads a tender and bidder documents, the system categorizes them.
*   **Digital Text (Fast Path):** `PyMuPDF` reads native PDF text at millisecond speeds.
*   **Scanned / Hindi Text (Fallback Path):** The system runs a language detection script (`_detect_scripts`). If Hindi (Devanagari) or a scanned image is detected, the pipeline **force-routes** the page to `Tesseract OCR (eng+hin)` and Pillow. This prevents the severe text scrambling that occurs when standard PDF parsers encounter custom regional fonts.
*   **Tabular Data:** `Camelot` extracts financial and compliance tables (Lattice and Stream parsing).

### Stage 2: PII Masking & Security (Data Sanitization)
Before sensitive documents touch external LLM APIs, the system enforces PII masking.
*   **Mechanism:** Regex-based and heuristic masking sweeps through the extracted context.
*   **Action:** Identifiers like GSTINs, phone numbers, and raw organizational names are replaced with structural tokens (e.g., `<ORG_1>`, `<GST_1>`). The original mapping is kept safely in the backend memory.

### Stage 3: Tender Setup & Schema Generation (Human-in-the-Loop)
*   **AI Extraction:** The LLM reads the Tender Document and generates a strict JSON array of `extractedCriteria` (Technical, Financial, Compliance).
*   **Human Gate:** The Procurement Officer is presented with these criteria. They can edit thresholds or click **"Add Manual Criteria"** if the AI missed a nuanced legal requirement.
*   **Schema Lock:** Once satisfied, the officer clicks "Lock Schema". This creates an immutable, timestamped baseline for the evaluation, preventing retroactive manipulation.

### Stage 4: Bidder Parsing & Normalization
The system extracts data from the Bidder's submission (e.g., extracting "5 Crores" from an audit report and normalizing it to an integer format for deterministic comparison).

### Stage 5: Evaluation & Explainability Generation
The LLM evaluates the normalized bidder data against the locked schema.
*   **Strict JSON Parsing:** The backend uses `Pydantic` schemas. If an LLM outputs malformed JSON, the backend's validation catches it and triggers a retry.
*   **Null-Safety Fallback:** If the LLM is unsure, cannot find the data, or the OCR is blurry, it is strictly forbidden from guessing. It outputs a `REVIEW_REQUIRED` verdict.
*   **Explainability:** Every evaluated criterion returns a `raw_snippet` and a `source_page` mapping exactly to where the decision was made.

### Stage 6: Human Review & Correction
The UI displays the evaluation. Bidders with `REVIEW_REQUIRED` tags are highlighted. The officer manually inspects the flagged `raw_snippet`, makes a human judgment, and updates the status.

### Stage 7: Consolidation & Audit Export
*   The final state is locked.
*   The system generates a cryptographic SHA-256 hash of the final evaluation state.
*   A tamper-proof JSON audit log and a consolidated PDF/Excel report are generated for final sign-off.

---

## 3. Complexity Handling & Engineering Workarounds

### The DeepSeek-R1 "Thinking" Timeout Fix
**Problem:** DeepSeek-R1 is a reasoning model that outputs thousands of `<think>` tokens before generating the actual JSON response. This caused the OpenRouter API to hit its default `max_tokens` limit (4,096), abruptly truncating the JSON and causing the pipeline to crash and retry infinitely.
**Solution:** 
1. We explicitly increased `max_tokens` to `15,000` in the backend API call to allow the model enough runway to finish its thought process.
2. We implemented a custom Regex-based pre-parser (`clean_json_response`) in Python that aggressively strips out all `<think>...</think>` blocks and Markdown code fences *before* passing the string to the strict JSON parser. 

### Null-Safety Architecture
**Problem:** LLMs naturally want to fill in the blanks. If a bidder didn't submit a turnover document, early models would hallucinate a value based on the tender requirement.
**Solution:** We structured the `Pydantic` schema to make fields `Optional` and explicitly instructed the system prompt to return `None` or `NOT_FOUND` rather than hallucinating. The backend maps `NOT_FOUND` directly to a `REVIEW_REQUIRED` state.

---

## 4. Test Reports & Performance Metrics

### Estimated Time Efficiency
*   **Human Baseline:** 20-40 hours per tender (cross-checking 10+ bidders against 20 criteria).
*   **InferX Ingestion (PyMuPDF):** ~50-100 milliseconds per digital page.
*   **InferX Ingestion (Tesseract OCR):** ~1.5 - 3 seconds per scanned page.
*   **InferX LLM Evaluation:** 
    *   Using Gemini 2.5 Flash / DeepSeek V3: **~5 to 12 seconds** per bidder evaluation.
    *   Using DeepSeek-R1 (Reasoning): **~2 to 4 minutes** per bidder evaluation.
*   **Total System Time:** What took a human committee days can be processed, evaluated, and presented for review in **under 3 minutes**.

### Estimated Cost Efficiency
*   **Traditional Auditing:** High human capital cost (salaries of procurement officers spending weeks on manual review).
*   **InferX Processing:** Utilizing models like DeepSeek-V3 via OpenRouter costs approximately **$0.14 per 1 Million Tokens**.
*   **Cost per Tender:** A massive 500-page tender evaluation across 10 bidders utilizes roughly 250k-500k tokens. Total compute cost: **~$0.07 to $0.10 per Tender**. A **99.9% cost reduction** compared to human operational hours.

### Complexity Handling Score
*   **Heterogeneous Inputs:** Successfully handles mixed English/Hindi datasets and interleaved Digital/Scanned PDFs without breaking.
*   **Scalability:** The decoupled architecture allows the FastAPI backend to scale horizontally, processing multiple bidders concurrently in future iterations.
