import sys, os
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from PIL import Image

z = int(sys.argv[1]) if len(sys.argv) > 1 else 18
m = meta(z)
W, H = m["cols"] * 256, m["rows"] * 256
im = Image.new("RGB", (W, H), (0, 0, 0))
missing = []
for r in range(m["rows"]):
    for c in range(m["cols"]):
        f = f"{S}/t{z}/{m['x0'] + c}_{m['y0'] + r}.jpg"
        if os.path.exists(f):
            im.paste(Image.open(f).convert("RGB"), (c * 256, r * 256))
        else:
            missing.append((m["x0"] + c, m["y0"] + r))
im.save(f"{S}/mosaic{z}.png")
print("mosaic", z, im.size, "missing tiles:", missing)
