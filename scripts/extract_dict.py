"""Extract the embedded character dictionary from the RapidOCR PP-OCRv3 rec
ONNX model into public/models/ppocr_keys.txt (UTF-8, one char per line).

The browser recogniser uses this to CTC-decode the model output. The final
character list at inference is: ['blank'] + <these lines> + [' '].
"""
import os
import onnx

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = os.path.join(
    ROOT, "..", "ExpMesoTracker", "dist", "ExpMesoTracker", "_internal",
    "rapidocr_onnxruntime", "models", "ch_PP-OCRv3_rec_infer.onnx",
)
OUT_DIR = os.path.join(ROOT, "public", "models")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "ppocr_keys.txt")

m = onnx.load(MODEL, load_external_data=False)
value = None
for p in m.metadata_props:
    if p.key == "character":
        value = p.value
        break
if value is None:
    raise SystemExit("no 'character' metadata found")

# The embedded value is the dict lines joined by newlines.
lines = value.split("\n")
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines))
print("wrote", OUT, "chars:", len(lines))
