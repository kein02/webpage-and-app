"""Render a compact aperture mark to the Windows icon sizes."""
from pathlib import Path
import math
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
image = Image.new('RGBA', (512, 512), (15, 17, 23, 255))
draw = ImageDraw.Draw(image)
for index in range(6):
    angle = index * math.pi / 3
    points = []
    for radius, offset in ((198, -.16), (198, .66), (89, 1.02), (89, .17)):
        points.append((256 + radius * math.cos(angle + offset), 256 + radius * math.sin(angle + offset)))
    draw.polygon(points, fill=(255, 107 + index * 9, 44 + index * 9, 255))
image.save(root / 'app-icon.png')
image.save(root / 'app.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
