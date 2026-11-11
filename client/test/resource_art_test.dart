import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/resource_art.dart';
import 'package:lastsilo/strings.dart';
import 'package:lastsilo/ui.dart';

void main() {
  test('każdy surowiec gry ma ikonę (ruda, para, żetony, próbki i materiały z resourceNames)', () {
    expect(resourceArt.keys.toSet(), resourceNames.keys.toSet());
  });

  testWidgets('ikony rysują się w małym i dużym rozmiarze, są wykluczone z Semantics; nieznany surowiec nie rzuca', (tester) async {
    await tester.pumpWidget(Directionality(
      textDirection: TextDirection.ltr,
      child: Wrap(children: [
        for (final r in resourceArt.keys) ...[ResourceIcon(r), ResourceIcon(r, size: 64)],
        const ResourceIcon('nowy_surowiec'),
      ]),
    ));
    expect(tester.takeException(), isNull);
    expect(find.byType(ExcludeSemantics), findsNWidgets(resourceArt.length * 2));
    expect(tester.getSize(find.byType(ResourceIcon).last), const Size(18, 18));
  });

  testWidgets('LsResChip: ikona + tekst, czytnik ekranu dostaje sam tekst', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Row(children: [LsResChip('ore', '150 rudy'), LsResChip(null, '4 XP'), LsResChip('siarka', '8 Siarka', ok: false)]))));
    expect(find.bySemanticsLabel('150 rudy'), findsOneWidget);
    expect(find.bySemanticsLabel('8 Siarka'), findsOneWidget);
    expect(find.byType(ResourceIcon), findsNWidgets(2));
    handle.dispose();
  });
}
