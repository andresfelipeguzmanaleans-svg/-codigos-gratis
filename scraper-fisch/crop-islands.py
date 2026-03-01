"""Crop individual islands from the Fisch world map image with transparent ocean backgrounds."""
import os
import numpy as np
from PIL import Image, ImageFilter

MAP_PATH = r'C:\Users\santi\Desktop\PROYECTOS VS CODE\WEB CODIGOS-GRATIS\public\images\map\fisch-world-map.png'
OUT_DIR = r'C:\Users\santi\Desktop\PROYECTOS VS CODE\WEB CODIGOS-GRATIS\public\images\map\islands'
os.makedirs(OUT_DIR, exist_ok=True)

img = Image.open(MAP_PATH).convert('RGBA')
W, H = img.size  # 5504 x 3072
print(f'Source image: {W}x{H}')

# Island crops: name -> (center_x, center_y, half_width, half_height)
# Coordinates are for the 5504x3072 map image
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
    """Make ocean pixels transparent using color distance from edge-sampled ocean."""
    arr = np.array(crop_img, dtype=np.float32)
    h, w = arr.shape[:2]

    # Sample ocean color from all edges (8px border)
    b = min(8, h // 4, w // 4)
    edge_pixels = np.concatenate([
        arr[:b, :, :3].reshape(-1, 3),       # top rows
        arr[-b:, :, :3].reshape(-1, 3),      # bottom rows
        arr[b:-b, :b, :3].reshape(-1, 3),    # left cols (excluding corners already counted)
        arr[b:-b, -b:, :3].reshape(-1, 3),   # right cols
    ], axis=0)

    # Use median (robust to island pixels that touch edges)
    ocean_color = np.median(edge_pixels, axis=0)
    print(f'    ocean color: R={ocean_color[0]:.0f} G={ocean_color[1]:.0f} B={ocean_color[2]:.0f}')

    # Color distance from ocean
    diff = np.sqrt(np.sum((arr[:,:,:3] - ocean_color) ** 2, axis=2))

    # Pixels close to ocean color → transparent
    is_ocean = diff < 42

    new_alpha = arr[:,:,3].copy()
    new_alpha[is_ocean] = 0
    arr[:,:,3] = new_alpha

    result = Image.fromarray(arr.astype(np.uint8))

    # Smooth alpha edges for clean transition
    alpha = result.split()[3]
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=1.5))
    result.putalpha(alpha)

    return result

# Also output positions as CSS % for FischWorldMap.tsx
print('\n--- CSS positions (left, top, width) ---')
for name, (cx, cy, hw, hh) in ISLANDS.items():
    x1, y1 = max(0, cx - hw), max(0, cy - hh)
    x2, y2 = min(W, cx + hw), min(H, cy + hh)

    left_pct = x1 / W * 100
    top_pct = y1 / H * 100
    width_pct = (x2 - x1) / W * 100

    crop = img.crop((x1, y1, x2, y2))
    crop = remove_ocean(crop)

    out = os.path.join(OUT_DIR, f'{name}.png')
    crop.save(out, 'PNG')
    print(f'  {name}: {x2-x1}x{y2-y1}px => left:{left_pct:.2f}% top:{top_pct:.2f}% w:{width_pct:.2f}%')

print(f'\nDone: {len(ISLANDS)} islands cropped')
