import sys
sys.path.append('.')
from app.ingestion.pdf import _iter_pages, _render_page_to_png_bytes, _run_tesseract_ocr, _get_ocr_engine
import fitz
import io
from PIL import Image
import numpy as np

doc = fitz.open('_uploads/ICB 7 Final document .pdf')
for i, page in _iter_pages(doc):
    if i == 6: # Page 7
        image_bytes = _render_page_to_png_bytes(page)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(image)
        text = _run_tesseract_ocr(img_array)
        break
