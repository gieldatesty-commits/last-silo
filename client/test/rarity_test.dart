import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/lab_layout.dart';
import 'package:lastsilo/screens/workshop_screen.dart';
import 'package:lastsilo/strings.dart';

/// Rzadkość i tiery do 10 (docs/ekwipunek-v1.0.md §4). Fikstura z prawdziwego API (config 1.7.0): kilof, łom i detektor
/// „solidne”, napierśnik zwykły na tierze 5 (następny wymaga Kuźni Głębi).
Map<String, dynamic> mapFx(String name) => Map<String, dynamic>.from(jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map);

class FakeApi extends Api {
  final posts = <String>[];
  final items = mapFx('items_loadouts');

  @override
  Future<dynamic> get(String path) async => path == '/items' ? items : throw ApiException(404, 'not_found');

  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    posts.add(path);
    return {};
  }
}

Future<FakeApi> pump(WidgetTester tester, {Size size = const Size(411, 860), double textScale = 1}) async {
  final api = FakeApi();
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: WorkshopScreen(state: AppState(api)..silo = mapFx('silo_loadouts'))),
      ),
    ),
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  return api;
}

Future<void> selectNapiersnik(WidgetTester tester) async {
  final row = find.bySemanticsLabel(RegExp(r'^Napierśnik, '));
  await tester.scrollUntilVisible(row, 200, scrollable: find.byType(Scrollable).first);
  await tester.tap(row);
  await tester.pump();
  await tester.drag(find.byType(Scrollable).first, const Offset(0, 4000)); // z powrotem do karty na górze
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('rzadkość znakiem i nazwą na karcie; w Semantics wiersza ekwipunku', (tester) async {
    final handle = tester.ensureSemantics();
    await pump(tester);
    expect(find.text('◆ Solidny'), findsOneWidget); // karta wybranego (kilof)
    await tester.scrollUntilVisible(find.bySemanticsLabel(RegExp(r'^Napierśnik, ')), 200, scrollable: find.byType(Scrollable).first);
    expect(find.bySemanticsLabel(RegExp(r'^Kilof, Solidny, ')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'^Napierśnik, Zwykły, ')), findsOneWidget);
    handle.dispose();
  });

  testWidgets('tier 5 → 6 wymaga Kuźni Głębi: przycisk wyłączony z opisem, kropki 5 z 10', (tester) async {
    final handle = tester.ensureSemantics();
    final api = await pump(tester);
    await selectNapiersnik(tester);
    expect(find.text('◆ Solidny'), findsNothing);
    expect(find.text('● Zwykły'), findsOneWidget);
    expect(find.bySemanticsLabel('wzmocnienie 5 z 10'), findsOneWidget);
    expect(find.text('Wymaga badania: Kuźnia Głębi'), findsOneWidget);
    final btn = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Wzmocnij'));
    expect(btn.onPressed, isNull);
    expect(api.posts, isEmpty);
    handle.dispose();
  });

  for (final scale in [1.0, 1.5]) {
    testWidgets('10 kropek tieru i opis badania bez przepełnień: 320x640, tekst x$scale', (tester) async {
      final handle = tester.ensureSemantics();
      await pump(tester, size: const Size(320, 640), textScale: scale);
      await selectNapiersnik(tester);
      expect(tester.takeException(), isNull);
      for (final rt in find.byType(RichText).evaluate()) {
        final rp = rt.renderObject! as RenderParagraph;
        if (!rp.hasSize) continue;
        expect(rp.size.height, greaterThanOrEqualTo(rp.getMinIntrinsicHeight(rp.size.width) - 0.5), reason: 'ucięty tekst: ${rp.text.toPlainText()}');
      }
      handle.dispose();
    });
  }

  test('Kuźnie mają miejsca w konstelacji; znaki rzadkości; komunikat tech_required', () {
    expect(techPos.keys, containsAll(['kuznia_glebi', 'kuznia_rdzenia']));
    expect(rarityMarks, {'zwykly': '●', 'solidny': '◆', 'mistrzowski': '★', 'unikatowy': '✦'});
    expect(errorText('tech_required'), 'Najpierw ukończ wymagane badanie.');
  });
}
