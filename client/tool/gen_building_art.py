import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
svg = src[src.index('<svg'):src.index('</svg>')]
TYPES = {'isShaft':'szybGlowny','isGenerator':'generatorPary','isStore':'magazyn','isWorkshop':'warsztat','isWatch':'wartownia','isLab':'laboratorium','isRadio':'radiostacja'}
# tokenize sc-if opens/closes and shapes in order
tok = re.finditer(r'<sc-if value="\{\{(\w+)\}\}"[^>]*>|</sc-if>|<(rect|circle|ellipse|path)\b([^>]*)/>', svg)
stack=[]; out={}
def attrs(s): return dict(re.findall(r'([\w-]+)="([^"]*)"', s))
def num(a,k,d=0.0): return float(a[k]) if k in a else d
def col(v):
    if v is None or v=='none': return 'null'
    v=v.lstrip('#'); return '0xFF'+v.upper()
for m in tok:
    if m.group(1): stack.append(m.group(1)); continue
    if m.group(0)=='</sc-if>': stack.pop(); continue
    kind, a = m.group(2), attrs(m.group(3))
    t = TYPES[stack[0]]; tier = 3 if 'isT3' in stack else 2 if 'isT2' in stack else 1
    if kind=='rect': geo=f"ArtKind.rect, [{num(a,'x')}, {num(a,'y')}, {num(a,'width')}, {num(a,'height')}, {num(a,'rx')}]"
    elif kind=='circle': geo=f"ArtKind.circle, [{num(a,'cx')}, {num(a,'cy')}, {num(a,'r')}]"
    elif kind=='ellipse': geo=f"ArtKind.ellipse, [{num(a,'cx')}, {num(a,'cy')}, {num(a,'rx')}, {num(a,'ry')}]"
    else: geo=f"ArtKind.path, [], d: '{a['d']}'"
    fill = a.get('fill', None if kind=='path' and 'stroke' in a and 'fill' not in a else '#000000')
    op = float(a.get('opacity', 1))
    parts=[geo, f"fill: {col(fill)}"]
    if op!=1: parts.append(f"opacity: {op}")
    if 'stroke' in a:
        parts.append(f"stroke: {col(a['stroke'])}"); parts.append(f"strokeWidth: {num(a,'stroke-width',1)}")
        if 'stroke-opacity' in a: parts.append(f"strokeOpacity: {a['stroke-opacity'] if not a['stroke-opacity'].startswith('.') else '0'+a['stroke-opacity']}")
        if a.get('stroke-linecap')=='round': parts.append("roundCap: true")
    out.setdefault(t,{1:[],2:[],3:[]})[tier].append('ArtShape('+', '.join(parts)+')')
print("// WYGENEROWANE z makiety Building.dc.html (viewBox 160x120): python tool/gen_building_art.py <Building.dc.html> > lib/building_art_data.dart")
print("// Nie edytuj ręcznie; zmień makietę i wygeneruj ponownie.")
print("part of 'building_art.dart';\n")
print("const Map<BuildingKind, List<List<ArtShape>>> _art = {")
for t,layers in out.items():
    print(f"  BuildingKind.{t}: [")
    for tier in (1,2,3):
        print("    [")
        for s in layers[tier]: print("      "+s.replace('[0.0','[0')+",")
        print("    ],")
    print("  ],")
print("};")
