import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'palette.dart';

/// Układ konstelacji badań (docs/warstwa-wizualna-v1.0.md §2). Czysta prezentacja: pozycje i kolory, bez liczb gry.
/// Krawędzie i stany pochodzą z odpowiedzi `GET /research`.

/// Przestrzeń projektowa mapy (dp).
const labMapSize = Size(390, 480);

/// Węzeł Laboratorium w środku.
const labCenter = Offset(195, 200);

/// Promień widocznego węzła (koło 34 dp). Obszar dotyku jest większy (44 dp).
const labNodeRadius = 17.0;

/// Pozycje ręczne z makiety (Main.dc.html, tablica T). Id jak w config/game.yaml → research.techs.
const Map<String, Offset> techPos = {
  'geologia_1': Offset(113, 152),
  'geologia_2': Offset(95, 89),
  'geologia_3': Offset(61, 51),
  'sejsmika': Offset(47, 174),
  'hydraulika_1': Offset(259, 123),
  'hydraulika_2': Offset(298, 77),
  'ekonomika_prac_1': Offset(282, 150),
  'ekonomika_prac_2': Offset(334, 120),
  'metalurgia': Offset(293, 183),
  'precyzja': Offset(353, 172),
  'balistyka': Offset(266, 258),
  'kuznia_glebi': Offset(350, 214),
  'kuznia_rdzenia': Offset(366, 246),
  'obserwacja_rdzeniowcow': Offset(195, 290),
  'rezonans_skal': Offset(255, 350),
  'anatomia_rdzeniowcow': Offset(175, 365),
  'jezyk_wibracji_1': Offset(100, 355),
  'jezyk_wibracji_2': Offset(178, 440),
  'jezyk_wibracji_3': Offset(100, 450),
  'wiertla_rdzeniowe': Offset(350, 300),
  'izolacja_rdzenia': Offset(320, 425),
};

/// Kolor gałęzi. Klucze jak `branch` z API (spec miał „geologia”, API zwraca „gornictwo”).
const Map<String, Color> branchColor = {'gornictwo': Ls.amber, 'inzynieria': Ls.teal, 'rdzeniowcy': Ls.violet};
const Color unknownBranchColor = Ls.textMuted;

/// Środki poświat gałęzi z makiety; służą też za kotwice zapasowych pozycji.
const Map<String, Offset> branchAnchor = {'gornictwo': Offset(80, 110), 'inzynieria': Offset(320, 120), 'rdzeniowcy': Offset(210, 390)};

Color colorOfBranch(String? branch) => branchColor[branch] ?? unknownBranchColor;

/// Pozycja badania: ręczna z `techPos`, a dla nowego badania z configu pierścień wokół kotwicy gałęzi
/// (kolejne miejsca co 40°, promień 46 dp, przycięte do mapy). Nigdy nie rzuca.
Offset positionOf(String id, String? branch, {int fallbackIndex = 0}) {
  final p = techPos[id];
  if (p != null) return p;
  final a = branchAnchor[branch] ?? labCenter;
  final ang = -math.pi / 2 + fallbackIndex * (2 * math.pi / 9);
  const r = 46.0;
  final x = (a.dx + r * math.cos(ang)).clamp(labNodeRadius + 4, labMapSize.width - labNodeRadius - 4);
  final y = (a.dy + r * math.sin(ang)).clamp(labNodeRadius + 4, labMapSize.height - labNodeRadius - 4);
  return Offset(x.toDouble(), y.toDouble());
}

/// Stan węzła z odpowiedzi serwera (`state`: done / active / available / locked).
enum TechState {
  done('ukończone'),
  active('w toku'),
  available('dostępne'),
  locked('zablokowane');

  const TechState(this.label);
  final String label;

  static TechState fromApi(String? s) => switch (s) {
        'done' => TechState.done,
        'active' => TechState.active,
        'available' => TechState.available,
        _ => TechState.locked,
      };
}

/// Węzeł po rozmieszczeniu.
@immutable
class LabNode {
  const LabNode({required this.id, required this.name, required this.branch, required this.pos, required this.state, required this.labRequired, required this.requires});
  final String id;
  final String name;
  final String branch;
  final Offset pos;
  final TechState state;
  final int labRequired;
  final List<String> requires;
  Color get color => colorOfBranch(branch);
}

/// Krawędź: pełna (obie strony ukończone), średnia (zaczęta: źródło ukończone), blada (reszta).
enum EdgeWeight { full, half, faint }

@immutable
class LabEdge {
  const LabEdge(this.a, this.b, this.color, this.weight, this.dashed);
  final Offset a;
  final Offset b;
  final Color color;
  final EdgeWeight weight;

  /// krawędź między gałęziami
  final bool dashed;

  @override
  bool operator ==(Object other) => other is LabEdge && other.a == a && other.b == b && other.color == color && other.weight == weight && other.dashed == dashed;
  @override
  int get hashCode => Object.hash(a, b, color, weight, dashed);
}

/// Gwiazdy tła ze stałego ziarna (jak w makiecie: LCG, ziarno 7, 64 gwiazdy).
final List<({Offset p, double r, double opacity})> labStars = () {
  var seed = 7;
  double rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  return [
    for (var k = 0; k < 64; k++)
      (() {
        final o = 0.12 + rnd() * 0.4;
        final x = (rnd() * labMapSize.width).roundToDouble();
        final y = (rnd() * labMapSize.height).roundToDouble();
        return (p: Offset(x, y), r: 0.5 + rnd() * 0.9, opacity: o);
      })(),
  ];
}();

/// Niezmienna scena konstelacji: wszystko, czego potrzebuje painter (krawędzie, puls), i nic więcej.
@immutable
class ConstellationScene {
  const ConstellationScene({required this.edges, this.pulseAt, this.pulseColor});
  final List<LabEdge> edges;
  final Offset? pulseAt;
  final Color? pulseColor;

  @override
  bool operator ==(Object other) => other is ConstellationScene && listEquals(other.edges, edges) && other.pulseAt == pulseAt && other.pulseColor == pulseColor;
  @override
  int get hashCode => Object.hash(Object.hashAll(edges), pulseAt, pulseColor);
}

/// Buduje węzły i krawędzie z listy `techs` z API. Krawędzie wynikają z `requires`; bez `requires` → do środka.
({List<LabNode> nodes, ConstellationScene scene}) buildConstellation(List<Map<String, dynamic>> techs) {
  final fallback = <String, int>{};
  final nodes = <LabNode>[];
  for (final t in techs) {
    final id = t['id'] as String;
    final branch = (t['branch'] as String?) ?? '';
    final idx = techPos.containsKey(id) ? 0 : (fallback[branch] = (fallback[branch] ?? -1) + 1);
    nodes.add(LabNode(
      id: id,
      name: (t['name'] as String?) ?? id,
      branch: branch,
      pos: positionOf(id, branch, fallbackIndex: idx),
      state: TechState.fromApi(t['state'] as String?),
      labRequired: (t['labRequired'] as num?)?.toInt() ?? 1,
      requires: ((t['requires'] as List?) ?? const []).cast<String>(),
    ));
  }
  final byId = {for (final n in nodes) n.id: n};
  bool done(LabNode n) => n.state == TechState.done;
  final edges = <LabEdge>[];
  for (final n in nodes) {
    if (n.requires.isEmpty) {
      edges.add(LabEdge(labCenter, n.pos, n.color, done(n) ? EdgeWeight.full : EdgeWeight.half, false));
    }
    for (final rid in n.requires) {
      final r = byId[rid];
      if (r == null) continue; // wymóg spoza listy: bez krawędzi, bez wyjątku
      final w = done(r) && done(n) ? EdgeWeight.full : done(r) ? EdgeWeight.half : EdgeWeight.faint;
      edges.add(LabEdge(r.pos, n.pos, n.color, w, r.branch != n.branch));
    }
  }
  final active = nodes.where((n) => n.state == TechState.active).firstOrNull;
  return (nodes: nodes, scene: ConstellationScene(edges: edges, pulseAt: active?.pos, pulseColor: active?.color));
}

/// Odległość punktu od odcinka (do testu „krawędź nie przechodzi przez obcy węzeł”).
double distanceToSegment(Offset p, Offset a, Offset b) {
  final ab = b - a;
  final len2 = ab.dx * ab.dx + ab.dy * ab.dy;
  if (len2 == 0) return (p - a).distance;
  final t = (((p.dx - a.dx) * ab.dx + (p.dy - a.dy) * ab.dy) / len2).clamp(0.0, 1.0);
  return (p - (a + ab * t)).distance;
}

/// Szerokość i przybliżona wysokość podpisu zaznaczonego węzła.
const labCaptionSize = Size(150, 30);

/// Miejsce na podpis: nad węzłem, pod nim, z prawej, z lewej; pierwsze, które nie nachodzi na inne węzły
/// (z marginesem 2 dp). Gdy żadne nie jest wolne, nad węzłem (albo pod, przy górnej krawędzi mapy).
Rect captionRect(Offset at, List<Offset> others) {
  const w = 150.0, h = 30.0, gap = labNodeRadius + 8;
  Rect clampRect(Rect r) {
    final dx = r.left < 4 ? 4 - r.left : (r.right > labMapSize.width - 4 ? labMapSize.width - 4 - r.right : 0.0);
    final dy = r.top < 4 ? 4 - r.top : (r.bottom > labMapSize.height - 4 ? labMapSize.height - 4 - r.bottom : 0.0);
    return r.shift(Offset(dx, dy));
  }

  bool free(Rect r) => others.every((o) => !r.inflate(labNodeRadius + 2).contains(o) && (r.center - o).distance > 0);
  final candidates = [
    Rect.fromLTWH(at.dx - w / 2, at.dy - gap - h, w, h),
    Rect.fromLTWH(at.dx - w / 2, at.dy + gap, w, h),
    Rect.fromLTWH(at.dx + gap, at.dy - h / 2, w, h),
    Rect.fromLTWH(at.dx - gap - w, at.dy - h / 2, w, h),
  ].map(clampRect).toList();
  for (final c in candidates) {
    // podpis nie może też przykrywać swojego węzła po przycięciu do mapy
    if (free(c) && !c.inflate(2).contains(at)) return c;
  }
  return at.dy < 60 ? candidates[1] : candidates[0];
}
