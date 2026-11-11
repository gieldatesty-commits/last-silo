import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/building_art.dart';

void main() {
  test('progi wyglądu: 1–3 → 1, 4–7 → 2, 8+ → 3', () {
    expect([1, 3, 4, 7, 8, 10].map(buildingArtTier), [1, 1, 2, 2, 3, 3]);
  });

  test('każdy typ budynku z API ma grafikę; nieznany typ nie rzuca', () {
    for (final t in ['szyb_glowny', 'generator_pary', 'magazyn', 'warsztat', 'wartownia', 'laboratorium', 'radiostacja']) {
      expect(BuildingKind.fromApi(t), isNotNull, reason: t);
    }
    expect(BuildingKind.fromApi('nowy_budynek'), isNull);
    expect(() => BuildingArt.fromApi('nowy_budynek', 3), returnsNormally);
  });

  test('parser ścieżek SVG: linie, H/V, łuk, zamknięcie', () {
    final p = parseSvgPath('M40 76 A40 40 0 0 1 120 76Z');
    final b = p.getBounds();
    expect(b.left, closeTo(40, 0.01));
    expect(b.right, closeTo(120, 0.01));
    expect(b.top, closeTo(36, 0.5)); // półokrąg o promieniu 40 nad osią y=76
    final q = parseSvgPath('M24 58 L24 40 L52 58 H128 V60Z').getBounds();
    expect(q, const Rect.fromLTRB(24, 40, 128, 60));
    expect(() => parseSvgPath('M0 0 Q1 1 2 2'), throwsFormatException);
    // względne komendy i krzywe (ikony slotów w Warsztacie)
    expect(parseSvgPath('M10 10 h5 v5 l-5 0 z').getBounds(), const Rect.fromLTRB(10, 10, 15, 15));
    // środek krzywej Béziera (0,0)→(10,0) z punktami kontrolnymi na y=10 leży w (5, 7.5)
    final m = parseSvgPath('M0 0c0 10 10 10 10 0').computeMetrics().first;
    final mid = m.getTangentForOffset(m.length / 2)!.position;
    expect(mid.dx, closeTo(5, 0.05));
    expect(mid.dy, closeTo(7.5, 0.05));
    expect(parseSvgPath('M4 15a8 8 0 0 1 16 0v2H4z').getBounds().right, closeTo(20, 0.01));
  });

  testWidgets('wszystkie 7 x 3 wariantów rysuje się bez błędu i jest wykluczonych z Semantics', (tester) async {
    await tester.pumpWidget(Directionality(
      textDirection: TextDirection.ltr,
      child: Wrap(children: [for (final k in BuildingKind.values) for (final l in [1, 4, 8]) BuildingArt(kind: k, level: l, width: 80)]),
    ));
    expect(tester.takeException(), isNull);
    expect(find.byType(CustomPaint), findsAtLeastNWidgets(21));
    expect(find.byType(ExcludeSemantics), findsNWidgets(21));
  });
}
