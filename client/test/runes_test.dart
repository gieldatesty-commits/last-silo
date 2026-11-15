import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/screens/dives_screen.dart';
import 'package:lastsilo/screens/workshop_screen.dart';
import 'package:lastsilo/strings.dart';

/// Runy (docs/ekwipunek-v1.0.md §5, makieta WarsztatRuny.dc.html). Fikstura z prawdziwego API (config 1.8.0):
/// kilof mistrzowski (2 gniazda) z Żyłami I w gnieździe 1; w magazynie Żyły I, Ostrza I, Bastionu III.
dynamic fx(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync());
Map<String, dynamic> mapFx(String name) => Map<String, dynamic>.from(fx(name) as Map);

class FakeApi extends Api {
  final posts = <(String, Object?)>[];
  final items = mapFx('items_runes');
  final silo = mapFx('silo_runes');
  List history = fx('history') as List;

  @override
  Future<dynamic> get(String path) async => switch (path) {
        '/items' => items,
        '/silo' => silo,
        '/dives/routes' => fx('routes'),
        '/dives/history' => history,
        _ => throw ApiException(404, 'not_found'),
      };

  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    posts.add((path, body));
    return {};
  }
}

Map kilofOf(FakeApi api) => (api.items['items'] as List).firstWhere((i) => i['recipeId'] == 'kilof') as Map;

Future<FakeApi> pumpWorkshop(WidgetTester tester, {Size size = const Size(411, 860), double textScale = 1}) async {
  final api = FakeApi();
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: WorkshopScreen(state: AppState(api)..silo = api.silo)),
      ),
    ),
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  return api;
}

void expectNoClippedText(WidgetTester tester) {
  for (final rt in find.byType(RichText).evaluate()) {
    final rp = rt.renderObject! as RenderParagraph;
    if (!rp.hasSize) continue;
    expect(rp.size.height, greaterThanOrEqualTo(rp.getMinIntrinsicHeight(rp.size.width) - 0.5), reason: 'ucięty tekst: ${rp.text.toPlainText()}');
  }
}

void main() {
  testWidgets('karta: gniazda z nazwą runy i efektem słowem; puste „stuknij, aby osadzić”', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpWorkshop(tester); // kilof jest wybrany (pierwszy w zestawie I)
    expect(find.text('Gniazda na runy: 1 z 2 zajęte'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'^gniazdo 1: Żyły I, zjazd \+0\.2')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'^gniazdo 2: puste')), findsOneWidget);
    expect(find.text('Wyjmij Żyły I · 100 rudy'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('osadzenie: puste gniazdo → arkusz z runami z magazynu → POST z numerem gniazda i runą', (tester) async {
    final handle = tester.ensureSemantics();
    final api = await pumpWorkshop(tester);
    await tester.tap(find.bySemanticsLabel(RegExp(r'^gniazdo 2: puste')));
    await tester.pumpAndSettle();
    expect(find.text('Osadź w gnieździe 2'), findsOneWidget);
    expect(find.text('Bastionu III'), findsOneWidget);
    expect(find.text('obrona +1'), findsOneWidget);
    await tester.tap(find.text('Ostrza I'));
    await tester.pumpAndSettle();
    expect(api.posts.single.$1, '/items/${kilofOf(api)['id']}/runes');
    expect(api.posts.single.$2, {'socket': 1, 'rune': 'runa_ostrza_1'});
    handle.dispose();
    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets('wyjęcie: potwierdzenie z opłatą → POST remove', (tester) async {
    final api = await pumpWorkshop(tester);
    await tester.ensureVisible(find.text('Wyjmij Żyły I · 100 rudy'));
    await tester.pump();
    await tester.tap(find.text('Wyjmij Żyły I · 100 rudy'));
    await tester.pumpAndSettle();
    expect(find.textContaining('100 rudy'), findsWidgets);
    await tester.tap(find.widgetWithText(FilledButton, 'Wyjmij'));
    await tester.pumpAndSettle();
    expect(api.posts.single.$1, '/items/${kilofOf(api)['id']}/runes/0/remove');
    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets('sekcja Runy: magazyn, wytwarzanie I–II, III tylko z łupu', (tester) async {
    final api = await pumpWorkshop(tester);
    await tester.scrollUntilVisible(find.widgetWithText(ChoiceChip, 'Runy'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Runy'));
    await tester.pump();
    await tester.scrollUntilVisible(find.text('Runy III tylko z łupu zjazdów'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Żyły I × 1'), findsOneWidget);
    final zyly = find.ancestor(of: find.text('zjazd +0.2 · Warsztat 3'), matching: find.byType(Container)).first;
    await tester.ensureVisible(zyly);
    await tester.tap(find.descendant(of: zyly, matching: find.text('Wytwórz')));
    await tester.pump();
    expect(api.posts.single.$1, '/runes/runa_zyly_1/craft');
    await tester.pump(const Duration(seconds: 5));
  });

  for (final scale in [1.0, 1.5]) {
    testWidgets('bez przepełnień i ucinania: 320x640, tekst x$scale (karta z gniazdami i arkusz)', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpWorkshop(tester, size: const Size(320, 640), textScale: scale);
      expect(tester.takeException(), isNull);
      expectNoClippedText(tester);
      await tester.scrollUntilVisible(find.bySemanticsLabel(RegExp(r'^gniazdo 2: puste')), 150, scrollable: find.byType(Scrollable).first);
      await tester.pump();
      expectNoClippedText(tester);
      await tester.tap(find.bySemanticsLabel(RegExp(r'^gniazdo 2: puste')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expectNoClippedText(tester);
      handle.dispose();
    });
  }

  testWidgets('Zjazdy: runa z łupu w historii', (tester) async {
    final api = FakeApi();
    final h = (api.history.first as Map)['result'] as Map;
    h['rune'] = 'runa_ostrza_3';
    final state = AppState(api)
      ..silo = api.silo
      ..routes = (fx('routes') as List).map((e) => Map<String, dynamic>.from(e as Map)).toList()
      ..history = api.history.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: DivesScreen(state: state))));
    await tester.pump();
    await tester.scrollUntilVisible(find.textContaining('runa Ostrza III'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.textContaining('runa Ostrza III'), findsOneWidget);
  });

  test('nazwy run i komunikaty błędów po polsku', () {
    expect(runeLabel({'name': 'Ostrza', 'level': 3}), 'Ostrza III');
    expect(runeEffectText('repair_pct', -10), 'naprawy −10%');
    expect(runeEffectText('attack', 0.6), 'atak +0.6');
    for (final code in ['no_socket', 'socket_taken', 'socket_empty', 'unknown_rune', 'rune_not_craftable']) {
      expect(errorText(code), isNot(startsWith('Coś poszło nie tak')), reason: code);
    }
  });
}
