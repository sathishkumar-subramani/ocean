"""
Draws the cut-out kelp frond texture (RGBA PNG): a stem with paired blades,
pale so each plant can be tinted per instance.

    pip install pillow
    python scripts/gen_kelp.py
"""
import math
import random
from PIL import Image, ImageDraw

S = 4
W, H = 128 * S, 512 * S
rnd = random.Random(5)
img = Image.new("RGBA", (W, H), (120, 140, 60, 0))
d = ImageDraw.Draw(img)
stem = lambda t: W / 2 + math.sin(t * 7.0) * W * 0.06          # gently wandering stem
d.line([(stem(t / 60), H - H * t / 60) for t in range(61)], fill=(110, 120, 50, 255), width=3 * S)
for i in range(26):
    t = 0.04 + i / 26 * 0.94
    x, y = stem(t), H - H * t
    side = 1 if i % 2 else -1
    ln = W * rnd.uniform(0.3, 0.44) * (1 - t * 0.35)
    wd = ln * rnd.uniform(0.2, 0.28)
    ang = math.radians(rnd.uniform(18, 40))
    pts = []
    for k in range(16):                                          # a long leaf with a wavy edge
        a = k / 16 * 2 * math.pi
        px = (math.cos(a) * 0.5 + 0.5) * ln
        py = math.sin(a) * wd * (0.6 + 0.4 * math.sin(a * 3 + i))
        pts.append((x + side * (px * math.cos(ang) + py * math.sin(ang)), y - px * math.sin(ang) + py * math.cos(ang)))
    v = rnd.uniform(0.75, 1.0)
    d.polygon(pts, fill=(int(170 * v), int(190 * v), int(80 * v), 255))
    d.line([(x, y), (x + side * ln * math.cos(ang), y - ln * math.sin(ang))], fill=(int(120 * v), int(135 * v), int(55 * v), 255), width=S)
img = img.resize((128, 512), Image.LANCZOS)
img.save("public/assets/kelp.png")
print("wrote kelp.png")
