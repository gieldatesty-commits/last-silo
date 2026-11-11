import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/lab_layout.dart';

/// Fikstura: prawdziwa odpowiedź `GET /research` z serwera (config 1.5.0).
List<Map<String, dynamic>> fixtureTechs() =>
    ((jsonDecode(File('test/fixtures/research.json').readAsStringSync()) as Map)['techs'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

void main() {
  test('każde badanie z fikstury ma ręczną pozycję w techPos, i odwrotnie', () {
    final ids = fixtureTechs().map((t) => t['id'] as String).toSet();
    expect(ids.difference(techPos.keys.toSet()), isEmpty, reason: 'badania bez pozycji');
    expect(techPos.keys.toSet().difference(ids), isEmpty, reason: 'pozycje nieistniejących badań');
  });

  test('nowe badanie z configu dostaje zapasową pozycję w mapie, bez wyjątku i bez kolizji ze sobą', () {
    final techs = [
      ...fixtureTechs(),
      for (var i = 0; i < 5; i++) {'id': 'nowe_$i', 'name': 'Nowe $i', 'branch': 'rdzeniowcy', 'state': 'locked', 'labRequired': 7, 'requires': ['izolacja_rdzenia']},
      {'id': 'obca_galaz', 'name': 'Obca', 'branch': 'kosmos', 'state': 'locked', 'labRequired': 1, 'requires': ['nie_istnieje']},
    ];
    final built = buildConstellation(techs);
    final fresh = built.nodes.where((n) => !techPos.containsKey(n.id)).toList();
    expect(fresh, hasLength(6));
    for (final n in fresh) {
      expect(n.pos.dx, inInclusiveRange(labNodeRadius, labMapSize.width - labNodeRadius));
      expect(n.pos.dy, inInclusiveRange(labNodeRadius, labMapSize.height - labNodeRadius));
    }
    expect(fresh.map((n) => n.pos).toSet(), hasLength(fresh.length));
    expect(colorOfBranch('kosmos'), unknownBranchColor);
  });

  test('żadna krawędź nie przechodzi przez środek obcego węzła (odległość > promień + 4 dp)', () {
    final built = buildConstellation(fixtureTechs());
    final points = [labCenter, ...built.nodes.map((n) => n.pos)];
    for (final e in built.scene.edges) {
      for (final p in points) {
        if (p == e.a || p == e.b) continue;
        final d = distanceToSegment(p, e.a, e.b);
        expect(d, greaterThan(labNodeRadius + 4), reason: 'krawędź ${e.a}→${e.b} za blisko węzła $p (${d.toStringAsFixed(1)} dp)');
      }
    }
  });

  test('krawędzie z requires: wagi wg stanu, przerywane między gałęziami, bez requires → do środka', () {
    final techs = fixtureTechs();
    void setState(String id, String s) => techs.firstWhere((t) => t['id'] == id)['state'] = s;
    setState('geologia_1', 'done');
    setState('geologia_2', 'done');
    setState('sejsmika', 'active');
    final built = buildConstellation(techs);
    LabEdge edge(String a, String b) => built.scene.edges.firstWhere((e) => e.a == techPos[a] && e.b == techPos[b]);
    expect(edge('geologia_1', 'geologia_2').weight, EdgeWeight.full);
    expect(edge('geologia_1', 'sejsmika').weight, EdgeWeight.half);
    expect(edge('sejsmika', 'obserwacja_rdzeniowcow').weight, EdgeWeight.faint);
    expect(edge('sejsmika', 'obserwacja_rdzeniowcow').dashed, isTrue); // górnictwo → rdzeniowcy
    expect(edge('geologia_1', 'geologia_2').dashed, isFalse);
    final roots = built.scene.edges.where((e) => e.a == labCenter).length;
    expect(roots, techs.where((t) => (t['requires'] as List).isEmpty).length);
    expect(built.scene.pulseAt, techPos['sejsmika']);
    // ta sama lista → równa scena (shouldRepaint = porównanie wartości)
    expect(buildConstellation(techs).scene, built.scene);
  });

  test('podpis zaznaczonego węzła mieści się w mapie i nie zakrywa swojego węzła', () {
    final nodes = buildConstellation(fixtureTechs()).nodes;
    for (final n in nodes) {
      final r = captionRect(n.pos, [for (final o in nodes) if (o.id != n.id) o.pos]);
      expect(r.left >= 0 && r.top >= 0 && r.right <= labMapSize.width && r.bottom <= labMapSize.height, isTrue, reason: n.id);
      expect(r.contains(n.pos), isFalse, reason: n.id);
    }
  });

  test('stany z API', () {
    expect(['done', 'active', 'available', 'locked', 'cos'].map(TechState.fromApi), [TechState.done, TechState.active, TechState.available, TechState.locked, TechState.locked]);
    expect(distanceToSegment(const Offset(0, 5), Offset.zero, const Offset(10, 0)), 5);
  });
}
