import os
import re
import emoji

def extract_emojis(text):
    return [char for char in text if char in emoji.EMOJI_DATA]

for root, _, files in os.walk('frontend/src'):
    for file in files:
        if file.endswith('.jsx'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
            emojis = extract_emojis(content)
            if emojis:
                print(f"{filepath}: {' '.join(set(emojis))}")
