import sys
sys.path.append('.')
from app.ingestion.pdf import _iter_pages, _render_page_to_png_bytes, _run_tesseract_ocr
import fitz
import io
from PIL import Image
import numpy as np

for pdf in ['_uploads/2023071922.pdf', '_uploads/ICB 7 Final document .pdf', '_uploads/TENDER DOCUMENT_ CRPF-TSD-2026.pdf', '_uploads/TenderDoc_uSUAhk1.pdf']:
    try:
        doc = fitz.open(pdf)
        for i, page in _iter_pages(doc):
            if i > 50: break # don't scan whole pdf
            image_bytes = _render_page_to_png_bytes(page)
            if not image_bytes: continue
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            img_array = np.array(image)
            text = _run_tesseract_ocr(img_array)
            if "[confidence=N/A]" in text or "confidence=N/A" in text:
                print(f"Found N/A on {pdf} page {i+1}")
                # Wait, the print statement is inside _run_tesseract_ocr
    except Exception as e:
        print("Error on", pdf, e)
