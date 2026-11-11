import 'package:flutter/widgets.dart';
import 'building_art.dart' show ArtKind, ArtShape, artShapePath;

/// Ikony surowców (viewBox 32x32) w stylu grafik budynków: płaskie kształty w palecie gry. Dekoracja: nazwę
/// surowca zawsze niesie tekst obok (ExcludeSemantics). Klucze jak `resource` w API: ore, steam, tokens, samples, miedz, krysztal, siarka.
const resourceArtSize = 32.0;

// kolory z palety (lib/palette.dart) jako int, bo dane są `const`
const _steel = 0xFF3A4558, _steelLight = 0xFF55637A, _steelPale = 0xFF7A879C;
const _copper = 0xFFC8794A, _copperDark = 0xFF8E4F2E, _copperLight = 0xFFE09868;
const _amber = 0xFFF0B45A, _teal = 0xFF62C9C0, _tealDark = 0xFF3E9E96, _violet = 0xFFB79CFF, _text = 0xFFE8E3D6;
const _sulfur = 0xFFE6CF5C, _sulfurDark = 0xFFB59A2E, _sulfurLight = 0xFFF4E58F;

const Map<String, List<ArtShape>> resourceArt = {
  // Ruda: bryła skały z iskrami kruszcu
  'ore': [
    ArtShape(ArtKind.path, [], d: 'M5 22 L9 11 L17 6 L26 10 L28 20 L20 27 L10 27 Z', fill: _steelLight),
    ArtShape(ArtKind.path, [], d: 'M9 11 L17 6 L26 10 L18 14 Z', fill: _steelPale),
    ArtShape(ArtKind.path, [], d: 'M18 14 L26 10 L28 20 L20 27 Z', fill: _steel),
    ArtShape(ArtKind.circle, [13, 19, 2], fill: _amber),
    ArtShape(ArtKind.circle, [22, 18, 1.5], fill: _copper),
    ArtShape(ArtKind.circle, [16, 11.5, 1.2], fill: _amber),
  ],
  // Para: kłęby nad zaworem
  'steam': [
    ArtShape(ArtKind.rect, [12, 25, 8, 4, 1], fill: _steelLight),
    ArtShape(ArtKind.circle, [11, 18, 6], fill: _teal, opacity: 0.55),
    ArtShape(ArtKind.circle, [19, 14, 7], fill: _teal, opacity: 0.75),
    ArtShape(ArtKind.circle, [22, 21, 5], fill: _teal, opacity: 0.45),
    ArtShape(ArtKind.circle, [9, 9, 2.5], fill: _teal, opacity: 0.35),
  ],
  // Żetony: moneta z wycięciem
  'tokens': [
    ArtShape(ArtKind.circle, [16, 16, 12], fill: _amber),
    ArtShape(ArtKind.circle, [16, 16, 8.5], fill: _copperDark),
    ArtShape(ArtKind.circle, [16, 16, 6.5], fill: _amber),
    ArtShape(ArtKind.rect, [14.5, 11, 3, 10, 1], fill: _copperDark),
    ArtShape(ArtKind.path, [], d: 'M7 13 A10 10 0 0 1 13 6.5', stroke: _text, strokeWidth: 1.6, strokeOpacity: 0.5, roundCap: true),
  ],
  // Próbki: fiolka z fioletowym płynem (ślady Rdzeniowców)
  'samples': [
    ArtShape(ArtKind.rect, [11, 8, 10, 20, 4], fill: _steel),
    ArtShape(ArtKind.rect, [12.5, 15, 7, 11.5, 3], fill: _violet),
    ArtShape(ArtKind.rect, [10, 4.5, 12, 4.5, 1.5], fill: _steelLight),
    ArtShape(ArtKind.circle, [15, 19, 1.2], fill: _text, opacity: 0.6),
    ArtShape(ArtKind.circle, [17.5, 22.5, 0.9], fill: _text, opacity: 0.6),
  ],
  // Miedź: samorodek
  'miedz': [
    ArtShape(ArtKind.path, [], d: 'M6 20 L8 12 L15 7 L24 9 L27 17 L22 25 L12 26 Z', fill: _copper),
    ArtShape(ArtKind.path, [], d: 'M8 12 L15 7 L24 9 L16 13 Z', fill: _copperLight),
    ArtShape(ArtKind.path, [], d: 'M16 13 L24 9 L27 17 L22 25 Z', fill: _copperDark),
    ArtShape(ArtKind.circle, [11, 17, 1.3], fill: _text, opacity: 0.7),
  ],
  // Kryształy: kępa kryształów na skale
  'krysztal': [
    ArtShape(ArtKind.path, [], d: 'M6 27 L5 18 L8 13 L11 18 L10 27 Z', fill: _teal, opacity: 0.75),
    ArtShape(ArtKind.path, [], d: 'M22 27 L21 17 L25 12 L28 18 L26 27 Z', fill: _violet, opacity: 0.85),
    ArtShape(ArtKind.path, [], d: 'M14 27 L11 13 L16 4 L21 13 L18 27 Z', fill: _teal),
    ArtShape(ArtKind.path, [], d: 'M16 4 L21 13 L18 27 L16 27 Z', fill: _tealDark),
    ArtShape(ArtKind.rect, [4, 26, 25, 3, 1.5], fill: _steel),
  ],
  // Siarka: żółte grudki i kryształek
  'siarka': [
    ArtShape(ArtKind.path, [], d: 'M21 20 L23 9 L26 6 L28 10 L26 22 Z', fill: _sulfur),
    ArtShape(ArtKind.path, [], d: 'M26 6 L28 10 L26 22 L24 21 Z', fill: _sulfurDark),
    ArtShape(ArtKind.path, [], d: 'M5 24 L7 16 L13 12 L19 14 L22 20 L18 26 L9 27 Z', fill: _sulfur),
    ArtShape(ArtKind.path, [], d: 'M13 12 L19 14 L22 20 L15 19 Z', fill: _sulfurLight),
    ArtShape(ArtKind.path, [], d: 'M15 19 L22 20 L18 26 L9 27 Z', fill: _sulfurDark),
  ],
};

final Map<String, List<(ArtShape, Path)>> _cache = {};

/// Ikona surowca. Nieznany klucz (nowy surowiec w configu) = puste miejsce tej samej wielkości, bez wyjątku.
class ResourceIcon extends StatelessWidget {
  const ResourceIcon(this.resource, {super.key, this.size = 18});
  final String resource;
  final double size;

  @override
  Widget build(BuildContext context) {
    final shapes = resourceArt[resource];
    if (shapes == null) return SizedBox.square(dimension: size);
    final prepared = _cache.putIfAbsent(resource, () => [for (final s in shapes) (s, artShapePath(s))]);
    return ExcludeSemantics(child: CustomPaint(size: Size.square(size), painter: _ResourcePainter(resource, prepared)));
  }
}

class _ResourcePainter extends CustomPainter {
  _ResourcePainter(this.resource, this.shapes);
  final String resource;
  final List<(ArtShape, Path)> shapes;
  final Paint _fill = Paint();
  final Paint _stroke = Paint()..style = PaintingStyle.stroke;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / resourceArtSize, size.height / resourceArtSize);
    for (final (s, path) in shapes) {
      if (s.fill != null) {
        _fill.color = Color(s.fill!).withValues(alpha: s.opacity);
        canvas.drawPath(path, _fill);
      }
      if (s.stroke != null) {
        _stroke
          ..color = Color(s.stroke!).withValues(alpha: s.opacity * s.strokeOpacity)
          ..strokeWidth = s.strokeWidth
          ..strokeCap = s.roundCap ? StrokeCap.round : StrokeCap.butt;
        canvas.drawPath(path, _stroke);
      }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_ResourcePainter old) => old.resource != resource;
}
