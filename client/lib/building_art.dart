import 'package:flutter/widgets.dart';

part 'building_art_data.dart';

/// Grafiki budynków Silosu (docs/warstwa-wizualna-v1.0.md §4). Czysta prezentacja: wektory z makiety
/// `Building.dc.html` (viewBox 160x120), trzy warianty wyglądu wg progów poziomu. Żadnych liczb gry.

/// Rozmiar przestrzeni projektowej grafiki.
const buildingArtSize = Size(160, 120);

/// Progi wyglądu: poz. 1–3 = wariant 1, 4–7 = 2, 8+ = 3. Prezentacja, nie balans.
const buildingArtTier2From = 4;
const buildingArtTier3From = 8;

int buildingArtTier(int level) => level >= buildingArtTier3From ? 3 : level >= buildingArtTier2From ? 2 : 1;

enum BuildingKind {
  szybGlowny('szyb_glowny'),
  generatorPary('generator_pary'),
  magazyn('magazyn'),
  warsztat('warsztat'),
  wartownia('wartownia'),
  laboratorium('laboratorium'),
  radiostacja('radiostacja');

  const BuildingKind(this.apiType);

  /// `type` z odpowiedzi `/silo`.
  final String apiType;

  static BuildingKind? fromApi(String type) {
    for (final k in values) {
      if (k.apiType == type) return k;
    }
    return null;
  }
}

enum ArtKind { rect, circle, ellipse, path }

/// Jeden kształt z makiety. `v`: rect [x, y, w, h, rx], circle [cx, cy, r], ellipse [cx, cy, rx, ry].
@immutable
class ArtShape {
  const ArtShape(this.kind, this.v, {this.d, this.fill, this.opacity = 1, this.stroke, this.strokeWidth = 1, this.strokeOpacity = 1, this.roundCap = false});
  final ArtKind kind;
  final List<double> v;
  final String? d;
  final int? fill;
  final double opacity;
  final int? stroke;
  final double strokeWidth;
  final double strokeOpacity;
  final bool roundCap;
}

/// Ścieżka gotowa do rysowania (budowana raz, przy pierwszym użyciu).
class _Prepared {
  _Prepared(this.shape, this.path);
  final ArtShape shape;
  final Path path;
}

final Map<BuildingKind, List<List<_Prepared>>> _cache = {};

List<List<_Prepared>> _prepared(BuildingKind kind) => _cache.putIfAbsent(
      kind,
      () => [
        for (final layer in _art[kind]!) [for (final s in layer) _Prepared(s, artShapePath(s))],
      ],
    );

/// Ścieżka kształtu w jego układzie (viewBox makiety). Używana też przez resource_art.dart.
Path artShapePath(ArtShape s) {
  final v = s.v;
  switch (s.kind) {
    case ArtKind.rect:
      final r = Rect.fromLTWH(v[0], v[1], v[2], v[3]);
      return Path()..addRRect(RRect.fromRectAndRadius(r, Radius.circular(v[4])));
    case ArtKind.circle:
      return Path()..addOval(Rect.fromCircle(center: Offset(v[0], v[1]), radius: v[2]));
    case ArtKind.ellipse:
      return Path()..addOval(Rect.fromCenter(center: Offset(v[0], v[1]), width: v[2] * 2, height: v[3] * 2));
    case ArtKind.path:
      return parseSvgPath(s.d!);
  }
}

/// Parser podzbioru SVG path data używanego w makietach: M, L, H, V, C, A, Z, bezwzględne i względne (małe litery).
Path parseSvgPath(String d) {
  final path = Path();
  final tokens = RegExp(r'[A-Za-z]|-?\d*\.?\d+').allMatches(d).map((m) => m.group(0)!).toList();
  var i = 0;
  var cmd = 'M';
  var cur = Offset.zero;
  var start = Offset.zero;
  double n() => double.parse(tokens[i++]);
  while (i < tokens.length) {
    if (RegExp(r'^[A-Za-z]$').hasMatch(tokens[i])) {
      cmd = tokens[i++];
      if (cmd == 'Z' || cmd == 'z') {
        path.close();
        cur = start;
        continue;
      }
    }
    final rel = cmd == cmd.toLowerCase();
    Offset pt() {
      final p = Offset(n(), n());
      return rel ? cur + p : p;
    }

    switch (cmd.toUpperCase()) {
      case 'M':
        cur = pt();
        start = cur;
        path.moveTo(cur.dx, cur.dy);
        cmd = rel ? 'l' : 'L'; // kolejne pary po M to linie
      case 'L':
        cur = pt();
        path.lineTo(cur.dx, cur.dy);
      case 'H':
        final x = n();
        cur = Offset(rel ? cur.dx + x : x, cur.dy);
        path.lineTo(cur.dx, cur.dy);
      case 'V':
        final y = n();
        cur = Offset(cur.dx, rel ? cur.dy + y : y);
        path.lineTo(cur.dx, cur.dy);
      case 'C':
        final c1 = pt(), c2 = pt(), end = pt();
        path.cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, end.dx, end.dy);
        cur = end;
      case 'A':
        final rx = n(), ry = n(), rot = n(), large = n() != 0, sweep = n() != 0;
        cur = pt();
        path.arcToPoint(cur, radius: Radius.elliptical(rx, ry), rotation: rot, largeArc: large, clockwise: sweep);
      default:
        throw FormatException('nieobsługiwana komenda SVG $cmd w "$d"');
    }
  }
  return path;
}

/// Rysuje budynek w wariancie `tier` (1–3), skalując viewBox 160x120 do rozmiaru płótna (z zachowaniem proporcji).
class BuildingPainter extends CustomPainter {
  BuildingPainter({required this.kind, required this.tier});
  final BuildingKind kind;
  final int tier;

  final Paint _fill = Paint()..style = PaintingStyle.fill;
  final Paint _stroke = Paint()..style = PaintingStyle.stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = (size.width / buildingArtSize.width) < (size.height / buildingArtSize.height) ? size.width / buildingArtSize.width : size.height / buildingArtSize.height;
    final dx = (size.width - buildingArtSize.width * scale) / 2;
    final dy = (size.height - buildingArtSize.height * scale) / 2;
    canvas.save();
    canvas.translate(dx, dy);
    canvas.scale(scale);
    final layers = _prepared(kind);
    for (var t = 0; t < tier && t < layers.length; t++) {
      for (final p in layers[t]) {
        final s = p.shape;
        if (s.fill != null) {
          _fill.color = Color(s.fill!).withValues(alpha: s.opacity);
          canvas.drawPath(p.path, _fill);
        }
        if (s.stroke != null) {
          _stroke
            ..color = Color(s.stroke!).withValues(alpha: s.opacity * s.strokeOpacity)
            ..strokeWidth = s.strokeWidth
            ..strokeCap = s.roundCap ? StrokeCap.round : StrokeCap.butt;
          canvas.drawPath(p.path, _stroke);
        }
      }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(BuildingPainter old) => old.kind != kind || old.tier != tier;
}

/// Grafika budynku jako dekoracja (informację niesie tekst obok, więc ExcludeSemantics).
class BuildingArt extends StatelessWidget {
  const BuildingArt({super.key, required this.kind, required this.level, this.width = 160});

  /// Z typu z API; nieznany typ (nowy budynek w configu) daje pusty prostokąt zamiast wyjątku.
  factory BuildingArt.fromApi(String type, int level, {Key? key, double width = 160}) {
    final k = BuildingKind.fromApi(type);
    return k == null ? BuildingArt._empty(key: key, width: width) : BuildingArt(key: key, kind: k, level: level, width: width);
  }

  const BuildingArt._empty({super.key, required this.width})
      : kind = null,
        level = 1;

  final BuildingKind? kind;
  final int level;
  final double width;

  @override
  Widget build(BuildContext context) {
    final h = width * buildingArtSize.height / buildingArtSize.width;
    if (kind == null) return SizedBox(width: width, height: h);
    return ExcludeSemantics(
      child: RepaintBoundary(
        child: CustomPaint(size: Size(width, h), painter: BuildingPainter(kind: kind!, tier: buildingArtTier(level))),
      ),
    );
  }
}
