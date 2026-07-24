import os
import re

all_files = []

def walk(d):
    try:
        for entry in os.scandir(d):
            if entry.name not in [\ node_modules\, \.next\]:
                if entry.is_dir(): walk(entry.path)
                elif entry.name.endswith(\.ts\) or entry.name.endswith(\.tsx\): all_files.append(entry.path)
    except: pass

walk(\src\)

print(str(len(all_files)) + \ files found\)
