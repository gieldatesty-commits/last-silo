"""Ikona ekranu startowego Androida (12+) z grafiki Szybu głównego (wariant 3) z makiety Building.dc.html.

Użycie: python tool/gen_splash_icon.py <Building.dc.html> > android/app/src/main/res/drawable/splash_icon.xml
Kształty (rect, circle, ellipse, path) zamieniane na ścieżki VectorDrawable; viewBox 160x120 wyśrodkowany
w obszarze 260x260, żeby grafika zmieściła się w okręgu ikony systemowego ekranu startowego (2/3 boku).
"""
import re
import sys

src = open(sys.argv[1], encoding='utf-8').read()
svg = src[src.index('<svg'):src.index('</svg>')]
start = svg.index('<sc-if value="{{isShaft}}"')
end = svg.index('<sc-if value="{{isGenerator}}"')
shaft = svg[start:end]

VIEW = 260
TX, TY = (VIEW - 160) / 2, (VIEW - 120) / 2


def attrs(s):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', s))


def f(v):
    return float(v)


def circle_path(cx, cy, rx, ry):
    return f'M{cx - rx},{cy} a{rx},{ry} 0 1,0 {2 * rx},0 a{rx},{ry} 0 1,0 {-2 * rx},0 Z'


out = []
for m in re.finditer(r'<(rect|circle|ellipse|path)\b([^>]*)/>', shaft):
    kind, a = m.group(1), attrs(m.group(2))
    if kind == 'rect':
        x, y, w, h = f(a['x']), f(a['y']), f(a['width']), f(a['height'])
        d = f'M{x},{y} h{w} v{h} h{-w} Z'
    elif kind == 'circle':
        d = circle_path(f(a['cx']), f(a['cy']), f(a['r']), f(a['r']))
    elif kind == 'ellipse':
        d = circle_path(f(a['cx']), f(a['cy']), f(a['rx']), f(a['ry']))
    else:
        d = a['d']
    props = [f'android:pathData="{d}"']
    fill = a.get('fill', None if 'stroke' in a else '#000000')
    if fill and fill != 'none':
        props.append(f'android:fillColor="{fill}"')
        if 'opacity' in a:
            props.append(f'android:fillAlpha="{a["opacity"] if not a["opacity"].startswith(".") else "0" + a["opacity"]}"')
    if 'stroke' in a:
        props.append(f'android:strokeColor="{a["stroke"]}"')
        props.append(f'android:strokeWidth="{a.get("stroke-width", "1")}"')
        so = a.get('stroke-opacity')
        if so:
            props.append(f'android:strokeAlpha="{so if not so.startswith(".") else "0" + so}"')
    out.append('        <path ' + ' '.join(props) + ' />')

print('<?xml version="1.0" encoding="utf-8"?>')
print('<!-- WYGENEROWANE: python tool/gen_splash_icon.py <Building.dc.html>; Szyb główny (wariant 3) z makiety. Nie edytuj ręcznie. -->')
print(f'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="288dp" android:height="288dp" android:viewportWidth="{VIEW}" android:viewportHeight="{VIEW}">')
print(f'    <group android:translateX="{TX}" android:translateY="{TY}">')
print('\n'.join(out))
print('    </group>')
print('</vector>')
