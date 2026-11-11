"""Ikona aplikacji z grafiki Szybu głównego (wariant 3) z makiety Building.dc.html.

Użycie (z katalogu client/):  python tool/gen_app_icon.py <Building.dc.html>
Tworzy:
  android/app/src/main/res/drawable/ic_launcher_foreground.xml   pierwszy plan ikony adaptacyjnej (108dp)
  android/app/src/main/res/drawable/ic_launcher_monochrome.xml   sylwetka do ikon tematycznych (Android 13+)
  android/app/src/main/res/drawable/ic_launcher_background.xml   tło z poświatą
  android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml     ikona adaptacyjna
  android/app/src/main/res/mipmap-*/ic_launcher.png               PNG dla Androida < 8 (48..192 px)
  branding/ic_launcher_512.png                                   do Sklepu Play
Sama wieża Szybu wyśrodkowana w obszarze 196x196: mieści się w bezpiecznej strefie ikony adaptacyjnej (66/108).
"""
import math
import os
import re
import sys

from PIL import Image, ImageDraw

src = open(sys.argv[1], encoding='utf-8').read()
svg = src[src.index('<svg'):src.index('</svg>')]
shaft = svg[svg.index('<sc-if value="{{isShaft}}"'):svg.index('<sc-if value="{{isGenerator}}"')]

# Sama wieża (bez bocznych budynków wariantów 2 i 3): wysoka i wąska, czytelna w małej ikonie.
# Wieża zajmuje y 4..108 i x 52..108 w układzie makiety; VIEW dobrane tak, by mieściła się w strefie 66/108.
VIEW = 196
TX, TY = VIEW / 2 - 80, VIEW / 2 - 56
BG = '#0A0C12'
DARK = {'#0A0C12', '#10141D'}  # elementy tła grafiki: pomijane w sylwetce monochromatycznej
RES = 'android/app/src/main/res'


def attrs(s):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', s))


def alpha(v):
    return float(v) if v else 1.0


shapes = []
for m in re.finditer(r'<(rect|circle|ellipse|path)\b([^>]*)/>', shaft):
    kind, a = m.group(1), attrs(m.group(2))
    # pomijamy boczne budynki (prostokąty poza wieżą) i szeroki cień gruntu
    if kind == 'rect' and (float(a['x']) >= 104 or float(a['x']) + float(a['width']) <= 50):
        continue
    if kind == 'ellipse' and float(a['rx']) > 40:
        continue
    shapes.append((kind, a))


def vector_path(kind, a):
    f = float
    if kind == 'rect':
        x, y, w, h = f(a['x']), f(a['y']), f(a['width']), f(a['height'])
        return f'M{x},{y} h{w} v{h} h{-w} Z'
    if kind in ('circle', 'ellipse'):
        cx, cy = f(a['cx']), f(a['cy'])
        rx = f(a.get('r', a.get('rx'))); ry = f(a.get('r', a.get('ry')))
        return f'M{cx - rx},{cy} a{rx},{ry} 0 1,0 {2 * rx},0 a{rx},{ry} 0 1,0 {-2 * rx},0 Z'
    return a['d']


def vector(paths_xml, size_dp=108):
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- WYGENEROWANE: python tool/gen_app_icon.py <Building.dc.html>. Nie edytuj ręcznie. -->\n'
            f'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="{size_dp}dp" android:height="{size_dp}dp" '
            f'android:viewportWidth="{VIEW}" android:viewportHeight="{VIEW}">\n'
            f'    <group android:translateX="{TX}" android:translateY="{TY}">\n{paths_xml}\n    </group>\n</vector>\n')


def fg_paths(mono=False):
    out = []
    for kind, a in shapes:
        fill = a.get('fill', None if 'stroke' in a else '#000000')
        if mono and fill in DARK:
            continue
        props = [f'android:pathData="{vector_path(kind, a)}"']
        if fill and fill != 'none':
            props.append(f'android:fillColor="{"#FFFFFFFF" if mono else fill}"')
            if 'opacity' in a and not mono:
                props.append(f'android:fillAlpha="{alpha(a["opacity"])}"')
        if 'stroke' in a:
            props.append(f'android:strokeColor="{"#FFFFFFFF" if mono else a["stroke"]}"')
            props.append(f'android:strokeWidth="{a.get("stroke-width", "1")}"')
            if a.get('stroke-opacity') and not mono:
                props.append(f'android:strokeAlpha="{alpha(a["stroke-opacity"])}"')
        out.append('        <path ' + ' '.join(props) + ' />')
    return '\n'.join(out)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8').write(text)


write(f'{RES}/drawable/ic_launcher_foreground.xml', vector(fg_paths()))
write(f'{RES}/drawable/ic_launcher_monochrome.xml', vector(fg_paths(mono=True)))
write(f'{RES}/drawable/ic_launcher_background.xml', f'''<?xml version="1.0" encoding="utf-8"?>
<!-- WYGENEROWANE: python tool/gen_app_icon.py. Tło ikony: ciemne z bursztynową poświatą za kołem szybu. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="{VIEW}" android:viewportHeight="{VIEW}">
    <path android:pathData="M0,0 h{VIEW} v{VIEW} h-{VIEW} Z" android:fillColor="#10141D" />
    <path android:pathData="M{VIEW / 2 - 52},{VIEW / 2 - 6} a52,52 0 1,0 104,0 a52,52 0 1,0 -104,0 Z" android:fillColor="#F0B45A" android:fillAlpha="0.10" />
    <path android:pathData="M{VIEW / 2 - 30},{VIEW / 2 - 30} a30,30 0 1,0 60,0 a30,30 0 1,0 -60,0 Z" android:fillColor="#F0B45A" android:fillAlpha="0.14" />
    <path android:pathData="M0,{VIEW * 0.82} h{VIEW} v{VIEW * 0.18} h-{VIEW} Z" android:fillColor="#0A0C12" />
</vector>
''')
write(f'{RES}/mipmap-anydpi-v26/ic_launcher.xml', '''<?xml version="1.0" encoding="utf-8"?>
<!-- Ikona adaptacyjna (Android 8+); monochrome = ikony tematyczne (Android 13+). Źródło: tool/gen_app_icon.py -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
''')


# --- PNG (Pillow): te same kształty, rysowane z nadpróbkowaniem ---
def hexrgba(h, a=1.0):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(round(255 * a)))


def poly_from_path(d):
    """Podzbiór M/L/Z z bezwzględnymi współrzędnymi (Szyb w makiecie używa tylko tych)."""
    polys, cur = [], []
    for cmd, args in re.findall(r'([MLZ])([^MLZ]*)', d):
        nums = [float(n) for n in re.findall(r'-?\d*\.?\d+', args)]
        if cmd == 'M':
            if cur:
                polys.append(cur)
            cur = [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]
        elif cmd == 'L':
            cur += [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]
        else:
            polys.append(cur + ['Z'])
            cur = []
    if cur:
        polys.append(cur)
    return polys


def render(px):
    ss = 4
    S = px * ss
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    k = S / VIEW
    # tło: zaokrąglony kwadrat (Android < 8 pokazuje PNG bez maski)
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(bg).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2), fill=hexrgba('#10141D'))
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r, a, dy in ((52, 0.10, 6), (30, 0.14, 30)):
        cx, cy = VIEW / 2 * k, (VIEW / 2 - dy) * k
        gd.ellipse([cx - r * k, cy - r * k, cx + r * k, cy + r * k], fill=hexrgba('#F0B45A', a))
    gd.rectangle([0, VIEW * 0.82 * k, S, S], fill=hexrgba(BG))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2), fill=255)
    bg = Image.alpha_composite(bg, Image.composite(glow, Image.new('RGBA', (S, S), (0, 0, 0, 0)), mask))
    img = Image.alpha_composite(img, bg)

    def T(x, y):
        return ((x + TX) * k, (y + TY) * k)

    for kind, a in shapes:
        layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        fill = a.get('fill', None if 'stroke' in a else '#000000')
        op = alpha(a.get('opacity'))
        if kind == 'rect':
            x, y, w, h = (float(a[q]) for q in ('x', 'y', 'width', 'height'))
            d.rectangle([*T(x, y), *T(x + w, y + h)], fill=hexrgba(fill, op))
        elif kind in ('circle', 'ellipse'):
            cx, cy = float(a['cx']), float(a['cy'])
            rx = float(a.get('r', a.get('rx'))); ry = float(a.get('r', a.get('ry')))
            box = [*T(cx - rx, cy - ry), *T(cx + rx, cy + ry)]
            if fill and fill != 'none':
                d.ellipse(box, fill=hexrgba(fill, op))
            if 'stroke' in a:
                d.ellipse(box, outline=hexrgba(a['stroke'], op), width=max(1, int(float(a.get('stroke-width', 1)) * k)))
        else:
            for poly in poly_from_path(a['d']):
                closed = poly and poly[-1] == 'Z'
                pts = [T(x, y) for x, y in (poly[:-1] if closed else poly)]
                if fill and fill != 'none' and closed:
                    d.polygon(pts, fill=hexrgba(fill, op))
                if 'stroke' in a and len(pts) > 1:
                    so = alpha(a.get('stroke-opacity'))
                    d.line(pts, fill=hexrgba(a['stroke'], op * so), width=max(1, int(float(a.get('stroke-width', 1)) * k)))
        img = Image.alpha_composite(img, layer)
    return img.resize((px, px), Image.LANCZOS)


for folder, px in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
    render(px).save(f'{RES}/mipmap-{folder}/ic_launcher.png')
os.makedirs('branding', exist_ok=True)
render(512).save('branding/ic_launcher_512.png')
print('ikona: ok')
