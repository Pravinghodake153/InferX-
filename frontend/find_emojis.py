import os
import re

def contains_emoji(text):
    # Very basic check for characters outside typical ASCII and latin blocks
    for char in text:
        if ord(char) > 0x2000 and ord(char) not in [0x200B, 0x200C, 0x200D, 0xFEFF]: # basic heuristic
            return True
    return False

def scan_dir(dir_path):
    for root, dirs, files in os.walk(dir_path):
        for file in files:
            if file.endswith(('.jsx', '.js', '.html')):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                        for i, line in enumerate(lines):
                            if contains_emoji(line):
                                print(f"{path}:{i+1}: {line.strip()}")
                except Exception as e:
                    pass

scan_dir('src')
