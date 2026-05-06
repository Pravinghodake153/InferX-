# InferX Document AI

**AI-Based Tender Evaluation and Eligibility Analysis for Government Procurement by CRPF**

> Hackathon Theme 3 | AI for Bharat

InferX is an auditable, human-in-the-loop AI platform designed to automate the extraction and evaluation of tender eligibility criteria against bidder submissions. Built for government-grade procurement, it prioritizes transparency, explainability, and safety over pure automation.

---

## Quick Start (One-Click Setup)

### Prerequisites

Before running the setup, ensure you have the following installed on your system:

| Requirement  | Version | macOS / Linux                                                  | Windows                                              |
|-------------|---------|----------------------------------------------------------------|------------------------------------------------------|
| Python      | 3.9+    | Pre-installed on macOS. Linux: `sudo apt install python3`      | https://www.python.org/downloads/ (check "Add to PATH") |
| Node.js     | 18+     | macOS: `brew install node` / Linux: [NodeSource](https://deb.nodesource.com/) | https://nodejs.org/                                  |
| Tesseract   | 5.0+    | macOS: `brew install tesseract` / Linux: `sudo apt install tesseract-ocr` | https://github.com/UB-Mannheim/tesseract/wiki (add to PATH) |
| pip         | Latest  | Comes with Python                                              | Comes with Python                                    |

> **Note:** The setup scripts will attempt to install missing dependencies automatically on macOS (Homebrew) and Linux (apt). On Windows, please install prerequisites manually first.

### Step 1: Extract and Setup

**macOS / Linux:**
```bash
# Unzip the project
unzip InferX.zip
cd InferX

# Run the automated setup (installs ALL dependencies)
chmod +x setup.sh
./setup.sh
```

**Windows (Command Prompt or PowerShell):**
```cmd
REM Extract the zip, then open Command Prompt inside the folder
cd InferX

REM Run the automated setup
setup.bat
```

This single command will:
- Create a Python virtual environment (`venv/`)
- Install all Python packages from `requirements.txt`
- Install all frontend Node.js packages (`npm install`)
- Check for Tesseract OCR
- Create necessary directories (`exports/`, `_uploads/`, `audit_logs/`)
- Copy `.env.example` to `.env` if no `.env` exists

### Step 2: Configure API Keys

Edit the `.env` file in the project root and add your API keys:

```bash
# macOS/Linux: Open .env in any text editor
nano .env

# Windows: Open .env in Notepad
notepad .env
```

You need **at least one** AI provider key:

| Key                | Where to Get It                                    | Required |
|--------------------|----------------------------------------------------|----------|
| `GEMINI_API_KEY`   | https://aistudio.google.com/apikey                 | Yes*     |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys                       | Yes*     |

> *At least one provider key is required. The system will auto-fallback between providers.

Firebase keys are pre-configured for document storage. If you need to use your own Firebase project, update the `VITE_FIREBASE_*` variables.

### Step 3: Start the Application

**macOS / Linux:**
```bash
# Start both backend and frontend with one command
./start.sh
```

**Windows:**
```cmd
REM Double-click start.bat or run from Command Prompt
start.bat
```

Or start servers individually in separate terminals:

**macOS / Linux:**
```bash
# Terminal 1 — Backend (port 8000)
./run_backend.sh

# Terminal 2 — Frontend (port 5173)
./run_frontend.sh
```

**Windows:**
```cmd
REM Window 1 — Backend
run_backend.bat

REM Window 2 — Frontend
run_frontend.bat
```

### Step 4: Open the Application

| Service       | URL                          |
|---------------|------------------------------|
| Frontend App  | http://localhost:5173        |
| Backend API   | http://localhost:8000        |
| API Docs      | http://localhost:8000/docs   |

---

## How We Solved the Problem Statement

We directly addressed the core "Non-Negotiables" of Theme 3:

### "Understand the tender & Extract eligibility criteria"

Our system uses advanced LLMs to parse hundreds of pages of tender documents, automatically extracting **Technical**, **Financial**, and **Compliance** criteria into a strict structured schema.

**Human-in-the-Loop:** Extracted criteria are presented to the procurement officer for review. The officer can manually add, edit, or delete criteria before locking the schema.

### "Understand each bidder & Handle heterogeneous documents"

**Hybrid Ingestion Engine:** We use PyMuPDF for blazing-fast digital text extraction. If the system detects scanned pages or complex regional fonts (e.g., Hindi/Devanagari scripts), it automatically routes the page through our Tesseract OCR (`eng+hin`) pipeline.

**Table Extraction:** We utilize PDF table detection to accurately extract financial and compliance tables from bidder documents.

### "Evaluate and explain (No silent disqualifications)"

Our evaluation engine outputs strict JSON with three verdicts: **PASS**, **FAIL**, or **REVIEW_REQUIRED**.

**Null-Safety & Ambiguity Handling:** If a value is missing, OCR is blurry, or the LLM has low confidence, the system never silently disqualifies the bidder. It flags it as `REVIEW_REQUIRED` for human intervention.

**Explainability:** Every verdict includes a `raw_snippet` and `source_page` mapping directly back to the exact paragraph in the original document, ensuring full auditability.

### "Auditable end-to-end"

The platform enforces an immutable workflow: **Extract -> Lock Schema -> Evaluate -> Consolidate**.

Every evaluation generates:
- **PDF Report** with sign-off section for procurement officers
- **Excel Matrix** with per-bidder evaluation sheets
- **Tamper-proof JSON Audit Log** with SHA-256 hash chain verification

Support for deterministic model execution (Temperature = 0.0) ensures reproducible results.

---

## Architecture & Technology Stack

| Layer               | Technology                                                                      |
|---------------------|---------------------------------------------------------------------------------|
| **Frontend**        | React 19 (Vite), React Router, Recharts, Custom CSS (Dark/Light themes)         |
| **Backend**         | FastAPI (Python) for asynchronous, high-performance API routing                 |
| **Document Processing** | PyMuPDF (fitz), pytesseract (OCR for scanned docs), Pillow                |
| **AI Infrastructure** | Provider-agnostic LLM Gateway with auto-failover                             |
| **AI Models**       | Google Gemini 2.5 Flash, OpenRouter (Claude 3.5, GPT-4o, DeepSeek V3/V4)       |
| **Storage**         | Firebase Storage for document persistence                                       |
| **Validation**      | Pydantic v2 for strict JSON schema enforcement                                  |
| **Export**           | ReportLab (PDF), openpyxl (XLSX), hashlib (SHA-256 audit chain)                |

---

## Project Structure

```
InferX/
|-- app/                    # Backend (FastAPI)
|   |-- api.py              # All API endpoints
|   |-- engine/
|   |   |-- export.py       # PDF, XLSX, Audit JSON generation
|   |-- ingestion/
|   |   |-- pdf.py          # Document parsing (PyMuPDF + OCR)
|   |-- llm/
|       |-- client.py       # LLM provider gateway (Gemini + OpenRouter)
|       |-- prompts.py      # System prompts for extraction & evaluation
|
|-- frontend/               # Frontend (React + Vite)
|   |-- src/
|   |   |-- pages/          # Dashboard, Upload, TenderSetup, Evaluation, etc.
|   |   |-- components/     # Chatbot, Header, Sidebar, Graphs
|   |   |-- services/       # API client, Firebase config
|   |   |-- context/        # Global state management
|   |-- package.json
|
|-- requirements.txt        # Python dependencies
|-- .env.example            # Environment variable template
|-- setup.sh / setup.bat    # One-click dependency installer (macOS-Linux / Windows)
|-- start.sh / start.bat    # One-click server launcher (macOS-Linux / Windows)
|-- run_backend.sh / .bat   # Backend-only launcher
|-- run_frontend.sh / .bat  # Frontend-only launcher
|-- README.md               # This file
```

---

## Key Features

- **Multi-format Document Ingestion**: PDF (digital + scanned), DOCX, images (JPG/PNG)
- **OCR with Hindi Support**: Tesseract OCR with `eng+hin` language packs
- **AI-Powered Criteria Extraction**: Automatic extraction of eligibility criteria from tender documents
- **Human-in-the-Loop Review**: Officers can approve, modify, or add criteria before evaluation
- **Multi-Bidder Consolidated Evaluation**: Evaluate all bidders against approved criteria
- **AI Chatbot**: Context-aware assistant that understands the current evaluation state
- **Export Suite**: PDF reports, Excel matrices, and tamper-proof JSON audit logs
- **Provider Failover**: Automatic switch between Gemini and OpenRouter on API failures
- **PII Masking**: Sensitive identifiers are masked (e.g., `<ORG_1>`) in AI processing

---

## Key Technical Decisions & Trade-offs

- **Privacy:** For privacy reasons, API keys are not bundled. You must add your own keys to `.env`.
- **Reasoning Models vs Fast Extractors:** We support DeepSeek-R1 (Reasoning) but actively strip the `<think>` tags using custom regex parsers to prevent Pydantic schema crashes. We recommend using fast-extraction models (Gemini 2.5 Flash / DeepSeek V3) for production speed.
- **Chunking Strategy:** To preserve the context of legal conditions, we bypass traditional chunking and utilize the massive context windows (up to 2M tokens) of modern models, passing entire documents in single payloads.
- **Temperature 0.0:** All evaluation calls use deterministic settings to ensure reproducible results across runs.

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| `ModuleNotFoundError` | Run `./setup.sh` again to ensure all Python packages are installed |
| `tesseract not found` | macOS: `brew install tesseract` / Linux: `sudo apt install tesseract-ocr` |
| `npm: command not found` | Install Node.js 18+ from https://nodejs.org |
| Backend fails to start | Check `.env` file has valid API keys. Check port 8000 is not in use |
| Frontend blank page | Ensure backend is running first. Check browser console for errors |
| XLSX export empty | Fixed in latest version. Ensure you export from the Consolidated Report page |

---

## License

Built for the AI for Bharat Hackathon. All rights reserved.
