import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/screens/workshop_screen.dart';
import 'package:lastsilo/strings.dart';

/// Komplety (docs/ekwipunek-v1.0.md §6, makieta WarsztatKomplety.dc.html). Fikstura z prawdziwego API (config 1.9.0):
/// Sztygar 4/4 w zestawie I (aktywny), Wartownik 2/4 (Płyta Wartownika, Noktowizor) w zestawie II.
Map<String, dynamic> mapFx(String name) => Map<String, dynamic>.from(jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map);

class FakeApi extends Api {
  final items = mapFx('items_sets');
  @override
  Future<dynamic> get(String path) async => path == '/items' ? items : throw ApiException(404, 'not_found');
  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async => {};
}

Future<void> pump(WidgetTester tester, {Size size = const Size(411, 860), double textScale = 1}) async {
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: WorkshopScreen(state: AppState(FakeApi())..silo = mapFx('silo_sets'))),
      ),
    ),
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void expectNoClippedText(WidgetTester tester) {
  for (final rt in find.byType(RichText).evaluate()) {
    final rp = rt.renderObject! as RenderParagraph;
    if (!rp.hasSize) continue;
    expect(rp.size.height, greaterThanOrEqualTo(rp.getMinIntrinsicHeight(rp.size.width) - 0.5), reason: 'ucięty tekst: ${rp.text.toPlainText()}');
  }
}

void main() {
  testWidgets('kafelki zestawów: aktywne komplety ze znakiem, postępem i efektami słowem', (tester) async {
    await pump(tester);
    expect(find.text('✓ Sztygar 4/4: ruda ze zjazdów +5%, zjazd +0,8'), findsOneWidget);
    expect(find.text('✓ Wartownik 2/4: obrona +1,5'), findsOneWidget);
  });

  testWidgets('karta części kompletu: postęp w zestawie, progi ✓/○, części', (tester) async {
    await pump(tester); // wybrany Młot pneumatyczny (pierwszy w zestawie I)
    expect(find.text('Komplet Sztygara'), findsOneWidget);
    expect(find.text('4 z 4 w zestawie I'), findsOneWidget);
    expect(find.text('✓ 2 części: ruda ze zjazdów +5%'), findsOneWidget);
    expect(find.text('✓ 4 części: zjazd +0,8'), findsOneWidget);
    expect(find.text('✓ Lampa wibracyjna'), findsOneWidget);
    // ramka kompletu na całą szerokość karty (nie dopasowana do tekstu) — na szerokim ekranie treść jest węższa niż karta
    await pump(tester, size: const Size(600, 1000));
    final box = find.ancestor(of: find.text('CZĘŚCI'), matching: find.byType(Container)).first;
    // najszerszy pasek postępu to wytrzymałość na karcie: zajmuje całą szerokość wnętrza karty
    final full = find.byType(LinearProgressIndicator).evaluate().map((e) => tester.getSize(find.byWidget(e.widget)).width).reduce((a, b) => a > b ? a : b);
    expect(tester.getSize(box).width, closeTo(full, 1));
  });

  testWidgets('zestaw II: Wartownik 2 z 4, brakujące części i niespełniony próg', (tester) async {
    final handle = tester.ensureSemantics();
    await pump(tester);
    await tester.tap(find.bySemanticsLabel(RegExp(r'^Zestaw II, ')));
    await tester.pump();
    await tester.tap(find.bySemanticsLabel(RegExp(r'^Ochrona: Płyta Wartownika')));
    await tester.pump();
    await tester.scrollUntilVisible(find.text('2 z 4 w zestawie II'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Komplet Wartownika'), findsOneWidget);
    expect(find.text('○ 4 części: atak +0,5, obrona +1'), findsOneWidget);
    expect(find.text('○ brakuje: Karabin pneumatyczny'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('receptury: dopisek kompletu przy częściach', (tester) async {
    await pump(tester);
    await tester.scrollUntilVisible(find.text('Celownik'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('komplet Wartownika'), findsWidgets);
    expect(find.text('komplet Sztygara'), findsWidgets);
  });

  for (final scale in [1.0, 1.5]) {
    testWidgets('bez przepełnień i ucinania: 320x640, tekst x$scale', (tester) async {
      await pump(tester, size: const Size(320, 640), textScale: scale);
      expect(tester.takeException(), isNull);
      expectNoClippedText(tester);
      await tester.scrollUntilVisible(find.text('4 z 4 w zestawie I'), 200, scrollable: find.byType(Scrollable).first);
      expect(tester.takeException(), isNull);
      expectNoClippedText(tester);
    });
  }

  test('efekty kompletu słowem', () {
    expect(setEffectText({'dive_ore_pct': 5}), 'ruda ze zjazdów +5%');
    expect(setEffectText({'repair_pct': -25, 'dive_power': 1.2}), 'naprawy −25%, zjazd +1,2');
    expect(setEffectText({'attack': 0.5, 'defense': 1}), 'atak +0,5, obrona +1');
  });
}
