# InferX Document AI - Tender Evaluation Pipeline

**Hackathon Theme 3: AI-Based Tender Evaluation and Eligibility Analysis for Government Procurement by CRPF**

InferX is an auditable, human-in-the-loop AI platform designed to automate the extraction and evaluation of tender eligibility criteria against bidder submissions. Built for government-grade procurement, it prioritizes transparency, explainability, and safety over pure automation.

## 🚀 Live Demo
- **Frontend App**: [Insert Vercel URL]
- **Backend API Docs**: [Insert Hugging Face Space URL]/docs

---

## 🎯 How We Solved the Problem Statement

We directly addressed the core "Non-Negotiables" of Theme 3:

1. **"Understand the tender & Extract eligibility criteria"**
   - Our system uses advanced LLMs to parse hundreds of pages of tender documents, automatically extracting Technical, Financial, and Compliance criteria into a strict structured schema.
   - **Human-in-the-Loop:** Extracted criteria are presented to the procurement officer for review. The officer can manually add, edit, or delete criteria before **locking the schema**.

2. **"Understand each bidder & Handle heterogeneous documents"**
   - **Hybrid Ingestion Engine:** We use `PyMuPDF` for blazing-fast digital text extraction. If the system detects scanned pages or complex regional fonts (e.g., Hindi/Devanagari scripts), it automatically routes the page through our **Tesseract OCR (eng+hin)** pipeline.
   - **Table Extraction:** We utilize `Camelot` to accurately extract financial and compliance tables from bidder documents.

3. **"Evaluate and explain (No silent disqualifications)"**
   - Our evaluation engine outputs strict JSON with three verdicts: `PASS`, `FAIL`, or `REVIEW_REQUIRED`.
   - **Null-Safety & Ambiguity Handling:** If a value is missing, OCR is blurry, or the LLM has low confidence, the system *never* silently disqualifies the bidder. It flags it as `REVIEW_REQUIRED` for human intervention.
   - **Explainability:** Every verdict includes a `raw_snippet` and `source_page` mapping directly back to the exact paragraph in the original document, ensuring full auditability.

4. **"Auditable end-to-end"**
   - The platform enforces an immutable workflow: Extract -> Lock Schema -> Evaluate -> Consolidate.
   - Support for deterministic model execution (Temperature = 0.0) ensures reproducible results.

---

## 🏗️ Architecture & Technology Stack

- **Frontend:** React (Vite), React Router, Custom CSS (Dark/Light themes with modern UI).
- **Backend:** FastAPI (Python) for asynchronous, high-performance API routing.
- **Document Processing:** PyMuPDF (fitz), Camelot, pytesseract (OCR), Pillow.
- **AI Infrastructure:** 
  - Provider-agnostic LLM Gateway.
  - Supports OpenRouter (DeepSeek V3/V4, Claude 3.5 Sonnet, GPT-4o) and Google Gemini (2.0 Flash/Pro).
  - Uses `Pydantic` for strict JSON schema enforcement and validation.

---

## 💻 Instructions to Run Locally

### Prerequisites
- Python 3.9+
- Node.js 18+
- Tesseract OCR (installed on your system `brew install tesseract` or `apt-get install tesseract-ocr`)
- Ghostscript (required by Camelot)

### 1. Backend Setup
```bash
# Navigate to the backend directory
cd InferX

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "GEMINI_API_KEY=your_gemini_key" > .env
echo "OPENROUTER_API_KEY=your_openrouter_key" >> .env

# Run the backend server
chmod +x run_backend.sh
./run_backend.sh
```
*Backend runs on `http://localhost:8000`*

### 2. Frontend Setup
```bash
# Navigate to the frontend directory
cd frontend

# Install dependencies
npm install

# Run the development server
chmod +x run_frontend.sh
./run_frontend.sh
```
*Frontend runs on `http://localhost:5173`*

---

## ⚠️ Key Technical Decisions & Trade-offs
- **Reasoning Models vs Fast Extractors:** We support DeepSeek-R1 (Reasoning) but actively strip the `<think>` tags using custom regex parsers to prevent Pydantic schema crashes. We recommend using fast-extraction models (Gemini 2.5 Flash / DeepSeek V3) for production speed.
- **Chunking Strategy:** To preserve the context of legal conditions, we bypass traditional chunking and utilize the massive context windows (up to 2M tokens) of modern models, passing entire documents in single payloads.
