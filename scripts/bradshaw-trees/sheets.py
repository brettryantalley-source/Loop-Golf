import os, json, math
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'localGeometry', 'bradshaw.json'))); woods = json.load(open('woods-final.json'))
M = json.load(open('mosaic.json')); z, X0, Y0 = M['z'], M['X0'], M['Y0']
def px(lat, lon):
    n = 2 ** z; x = (lon + 180) / 360 * n; y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (x - X0) * 256, (y - Y0) * 256
base = Image.open('mosaic.png').convert('RGBA')
fill = Image.new('RGBA', base.size, (0, 0, 0, 0)); fd = ImageDraw.Draw(fill)
for w in woods:
    rings = w.get('outer') or [w['pts']]
    for r in rings: fd.polygon([px(*p) for p in r], fill=(255, 40, 200, 110))
    for r in w.get('inner') or []: fd.polygon([px(*p) for p in r], fill=(0, 0, 0, 0))
im = Image.alpha_composite(base, fill).convert('RGB'); dr = ImageDraw.Draw(im)
for w in woods:
    for r in (w.get('outer') or [w['pts']]) + (w.get('inner') or []):
        xy = [px(*p) for p in r]; dr.line(xy + [xy[0]], fill=(255, 0, 230), width=3)
for w in d['ways']:
    t = w.get('tags', {})
    if t.get('golf') == 'hole' and t.get('name', '').split(' ')[0] in ('Red', 'White'):
        xy = [px(*p) for p in w['pts']]; dr.line(xy, fill=(255, 255, 255), width=3)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
holes = {w['tags']['name']: w['pts'] for w in d['ways'] if w.get('tags', {}).get('golf') == 'hole'}
C = 560
for nine in ('Red', 'White'):
    sheet = Image.new('RGB', (3 * C + 16, 3 * C + 16), 'white')
    for i in range(9):
        nm = f'{nine} {i+1}'; xy = [px(*p) for p in holes[nm]]
        xs = [p[0] for p in xy]; ys = [p[1] for p in xy]; pad = 100
        x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
        s = max(x1 - x0, y1 - y0); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        cr = im.crop((int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2))).resize((C, C), Image.LANCZOS)
        cd = ImageDraw.Draw(cr); cd.rectangle([0, 0, 150, 40], fill='black'); cd.text((8, 4), nm, fill='yellow', font=f)
        sheet.paste(cr, ((i % 3) * (C + 8), (i // 3) * (C + 8)))
    sheet.save(f'trees-{nine}.jpg', quality=84)
print('ok')
