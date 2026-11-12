import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/lab_layout.dart';
import 'package:lastsilo/screens/dives_screen.dart';
import 'package:lastsilo/screens/raids_screen.dart';
import 'package:lastsilo/screens/workshop_screen.dart';
import 'package:lastsilo/slot_icon.dart';
import 'package:lastsilo/strings.dart';

/// Zestawy ekwipunku (docs/ekwipunek-v1.0.md §7). Fikstury z prawdziwego API (serwer deweloperski, config 1.6.0):
/// kilof w zestawie I, łom bojowy i napierśnik w II, detektor żył w obu; aktywny I.
dynamic fx(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync());
Map<String, dynamic> mapFx(String name) => Map<String, dynamic>.from(fx(name) as Map);

class FakeApi extends Api {
  final posts = <(String, Object?)>[];
  Map<String, dynamic> items = mapFx('items_loadouts');
  Map<String, dynamic> silo = mapFx('silo_loadouts');

  @override
  Future<dynamic> get(String path) async => switch (path) {
        '/items' => items,
        '/silo' => silo,
        '/dives/routes' => fx('routes'),
        '/dives/history' => fx('history'),
        '/raids/targets' => fx('more/raids_targets'),
        '/raids' => fx('more/raids'),
        _ => throw ApiException(404, 'not_found'),
      };

  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    posts.add((path, body));
    return {};
  }
}

AppState appState(FakeApi api) => AppState(api)
  ..silo = api.silo
  ..routes = (fx('routes') as List).map((e) => Map<String, dynamic>.from(e as Map)).toList()
  ..history = (fx('history') as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

Future<void> pump(WidgetTester tester, Widget child, {Size size = const Size(411, 860), double textScale = 1}) async {
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: child),
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

Map itemOf(FakeApi api, String recipeId) => (api.items['items'] as List).firstWhere((i) => i['recipeId'] == recipeId) as Map;
String idOf(FakeApi api, String recipeId) => itemOf(api, recipeId)['id'] as String;

void main() {
  group('Warsztat: zestawy', () {
    testWidgets('dwa kafelki zestawów; aktywny opisany słowem; sloty edytowanego zestawu', (tester) async {
      final handle = tester.ensureSemantics();
      final api = FakeApi();
      await pump(tester, WorkshopScreen(state: appState(api)));
      expect(find.bySemanticsLabel(RegExp(r'^Zestaw I, aktywny')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^Zestaw II, nieaktywny')), findsOneWidget);
      expect(find.text('● aktywny'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^Narzędzie: Kilof')), findsOneWidget);
      await tester.tap(find.bySemanticsLabel(RegExp(r'^Zestaw II, nieaktywny')));
      await tester.pump();
      expect(find.bySemanticsLabel(RegExp(r'^Narzędzie: Łom bojowy')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^Sprzęt: Detektor żył.*w obu zestawach')), findsOneWidget);
      expect(api.posts, isEmpty); // podgląd zestawu nie przełącza
      await tester.tap(find.text('Włącz zestaw II'));
      await tester.pump();
      expect(api.posts.single.$1, '/loadouts/2/activate');
      handle.dispose();
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('karta broni: atak słowem; zdjęcie i założenie wysyłają numer zestawu', (tester) async {
      final api = FakeApi();
      await pump(tester, WorkshopScreen(state: appState(api)));
      await tester.tap(find.bySemanticsLabel(RegExp(r'^Zestaw II, nieaktywny')));
      await tester.pump();
      await tester.tap(find.bySemanticsLabel(RegExp(r'^Narzędzie: Łom bojowy')));
      await tester.pump();
      expect(find.text('Atak +${itemOf(api, 'lom_bojowy')['attack']}'), findsOneWidget);
      expect(find.text('✓ w zestawie II'), findsOneWidget);
      await tester.tap(find.text('Zdejmij z II'));
      await tester.pump();
      expect(api.posts.last.$1, '/items/${idOf(api, 'lom_bojowy')}/unequip');
      expect(api.posts.last.$2, {'loadout': 2});
      await tester.pump(const Duration(seconds: 5));
      await tester.tap(find.text('Załóż też w I'));
      await tester.pump();
      expect(api.posts.last.$1, '/items/${idOf(api, 'lom_bojowy')}/equip');
      expect(api.posts.last.$2, {'loadout': 1});
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('ekwipunek: przynależność do zestawów znakiem I / II / I + II', (tester) async {
      await pump(tester, WorkshopScreen(state: appState(FakeApi())));
      await tester.scrollUntilVisible(find.text('I + II'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('I + II'), findsOneWidget);
      expect(find.text('II'), findsNWidgets(2)); // łom i napierśnik
    });

    testWidgets('receptury: profil słowem (atak / obrona / zjazd) i filtr „Bojowe”', (tester) async {
      await pump(tester, WorkshopScreen(state: appState(FakeApi())));
      await tester.scrollUntilVisible(find.widgetWithText(ChoiceChip, 'Bojowe'), 300, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Bojowe'));
      await tester.pump();
      await tester.scrollUntilVisible(find.text('Łom bojowy').last, 300, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('atak +0.6 · 20 wytrz.'), findsOneWidget);
      expect(find.text('Kilof'), findsNothing);
      await tester.scrollUntilVisible(find.text('Napierśnik').last, 300, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('obrona +1.2 · 25 wytrz.'), findsOneWidget);
      // broń ma własną ikonę (nie kilof ze slotu narzędzia)
      expect(find.byWidgetPredicate((w) => w is SlotIcon && w.slot == 'bron'), findsWidgets);
    });

    for (final scale in [1.0, 1.5]) {
      testWidgets('bez przepełnień i ucinania: 320x640, tekst x$scale', (tester) async {
        final api = FakeApi();
        await pump(tester, WorkshopScreen(state: appState(api)), size: const Size(320, 640), textScale: scale);
        expect(tester.takeException(), isNull);
        expectNoClippedText(tester);
        await tester.tap(find.bySemanticsLabel(RegExp(r'^Zestaw II, nieaktywny')));
        await tester.pump();
        expect(tester.takeException(), isNull);
        expectNoClippedText(tester);
      });
    }
  });

  group('Zjazdy i Najazdy: zestaw', () {
    testWidgets('Zjazdy: którym zestawem pójdzie zjazd; „Zmień” przełącza; kolejka pokazuje zestaw', (tester) async {
      final api = FakeApi();
      final now = DateTime.now().toUtc();
      api.silo['queue'] = [
        {'id': '1', 'routeId': 'plytki', 'startsAt': now.toIso8601String(), 'endsAt': now.add(const Duration(seconds: 120)).toIso8601String(), 'running': true, 'loadout': 2},
      ];
      await pump(tester, DivesScreen(state: appState(api)));
      expect(find.text('Zjazd pójdzie zestawem I'), findsOneWidget);
      expect(find.text('zestaw II'), findsOneWidget);
      await tester.tap(find.text('Zmień na II'));
      await tester.pump();
      expect(api.posts.single.$1, '/loadouts/2/activate');
    });

    testWidgets('Najazdy: aktywny zestaw, atak i obrona sprzętu, przełączenie przed najazdem', (tester) async {
      final api = FakeApi();
      await pump(tester, RaidsScreen(state: appState(api)));
      await tester.pump();
      expect(find.text('Aktywny: zestaw I'), findsOneWidget);
      final st = api.items['loadoutStats'] as Map;
      final sd = api.items['siloDefense'] as Map;
      expect(find.textContaining('atak sprzętu +${(st['1'] as Map)['attack']}'), findsOneWidget);
      expect(find.textContaining('obrona silosu +${sd['1']}'), findsOneWidget); // z częścią pancerza z zestawu II
      expect(find.textContaining('z zestawem II: atak +${(st['2'] as Map)['attack']}, obrona silosu +${sd['2']}'), findsOneWidget);
      await tester.tap(find.text('Przełącz na zestaw II'));
      await tester.pump();
      expect(api.posts.single.$1, '/loadouts/2/activate');
    });
  });

  test('Laboratorium: Balistyka ma pozycję z makiety; komunikaty błędów zestawów po polsku', () {
    expect(techPos.containsKey('balistyka'), isTrue);
    expect(errorText('already_active'), 'Ten zestaw jest już aktywny.');
    expect(errorText('invalid_loadout'), 'Nie ma takiego zestawu.');
    expect(errorText('not_equipped'), 'Tego przedmiotu nie ma w tym zestawie.');
  });
}
