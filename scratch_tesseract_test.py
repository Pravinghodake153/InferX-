import cv2
import numpy as np
import pytesseract

img = np.zeros((100, 100, 3), dtype=np.uint8)
img.fill(255)

try:
    data = pytesseract.image_to_data(img, lang='eng+hin', output_type=pytesseract.Output.DATAFRAME)
    print("Success:", data.head())
except Exception as e:
    print("Exception:", type(e), e)
