"""Crop individual islands from the Fisch world map image with transparent ocean backgrounds."""
import os
import numpy as np
from PIL import Image, ImageFilter

MAP_PATH = r'C:\Users\santi\Desktop\PROYECTOS VS CODE\WEB CODIGOS-GRATIS\public\images\map\fisch-world-map.png'
OUT_DIR = r'C:\Users\santi\Desktop\PROYECTOS VS CODE\WEB CODIGOS-GRATIS\public\images\map\islands'
os.makedirs(OUT_DIR, exist_ok=True)

img = Image.open(MAP_PATH).convert('RGBA')
W, H = img.size  # 3072 x 1729
print(f'Source image: {W}x{H}')

# Island crops: name -> (center_x, center_y, half_width, half_height)
# Centers derived from % positions mapped to actual 5504x3072 image
ISLANDS = {
    'northern-caves':        (660, 246, 400, 300),
    'sunstone-island':       (991, 553, 320, 250),
    'statue-of-sovereignty': (2092, 660, 180, 230),
    'the-laboratory':        (1816, 830, 180, 160),
    'the-arch':              (2862, 676, 220, 220),
    'birch-cay':             (3192, 369, 260, 220),
    'mushgrove-swamp':       (4293, 369, 560, 420),
    'harvesters-spike':      (1211, 1352, 210, 250),
    'roslit-bay':            (881, 1290, 460, 360),
    'moosewood':             (2312, 1290, 600, 420),
    'lushgrove':             (3082, 860, 320, 270),
    'earmark-island':        (3082, 1475, 200, 160),
    'cursed-isle':           (3633, 1536, 430, 360),
    'forsaken-shores':       (660, 1997, 530, 430),
    'terrapin-island':       (2092, 2089, 600, 440),
    'snowcap-island':        (4128, 1997, 580, 460),
    'ancient-isle':          (5229, 1075, 360, 400),
}

def remove_ocean(crop_img):
    """Make ocean (grey, low-saturation) pixels transparent."""
    arr = np.array(crop_img, dtype=np.int16)
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]

    rgb_max = np.maximum(np.maximum(r, g), b)
    rgb_min = np.minimum(np.minimum(r, g), b)
    spread = rgb_max - rgb_min
    brightness = (r + g + b) / 3

    # Ocean: low color spread + medium brightness
    is_ocean = (spread < 38) & (brightness > 65) & (brightness < 168)

    new_alpha = a.copy()
    new_alpha[is_ocean] = 0
    arr[:,:,3] = new_alpha

    result = Image.fromarray(arr.astype(np.uint8))

    # Smooth alpha edges
    alpha = result.split()[3]
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=1.2))
    result.putalpha(alpha)

    return result

for name, (cx, cy, hw, hh) in ISLANDS.items():
    x1, y1 = max(0, cx - hw), max(0, cy - hh)
    x2, y2 = min(W, cx + hw), min(H, cy + hh)

    crop = img.crop((x1, y1, x2, y2))
    crop = remove_ocean(crop)

    out = os.path.join(OUT_DIR, f'{name}.png')
    crop.save(out, 'PNG')
    print(f'  {name}: {x2-x1}x{y2-y1}px')

print(f'\nDone: {len(ISLANDS)} islands cropped')
