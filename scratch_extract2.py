import sys
sys.path.append('.')
from app.ingestion.pdf import _iter_pages, _render_page_to_png_bytes, _run_tesseract_ocr
import fitz
import io
from PIL import Image
import numpy as np

for pdf in ['_uploads/2023071922.pdf', '_uploads/TENDER DOCUMENT_ CRPF-TSD-2026.pdf', '_uploads/TenderDoc_uSUAhk1.pdf']:
    print(f"Testing {pdf}")
    try:
        doc = fitz.open(pdf)
    except Exception:
        continue
    for i, page in _iter_pages(doc):
        # limit to first 10 pages
        if i > 10: break
        image_bytes = _render_page_to_png_bytes(page)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(image)
        text = _run_tesseract_ocr(img_array)
