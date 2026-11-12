import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/screens/dives_screen.dart';
import 'package:lastsilo/screens/workshop_screen.dart';

dynamic fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync());
Map<String, dynamic> mapFx(String name) => Map<String, dynamic>.from(fixture(name) as Map);
List<Map<String, dynamic>> listFx(String name) => (fixture(name) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

/// Atrapa API dla AppState: GET z fikstur, POST zapisywane.
class FakeApi extends Api {
  final posts = <String>[];
  Map<String, dynamic> items = mapFx('items_owned');

  @override
  Future<dynamic> get(String path) async => switch (path) {
        '/items' => items,
        '/silo' => mapFx('silo'),
        '/dives/routes' => fixture('routes'),
        '/dives/history' => fixture('history'),
        _ => throw ApiException(404, 'not_found'),
      };

  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    posts.add(path);
    return {};
  }
}

AppState appState(FakeApi api, {List<Map<String, dynamic>>? queue, int steam = 97}) {
  final silo = mapFx('silo');
  (silo['wallet'] as Map)['steam'] = steam;
  silo['queue'] = queue ?? <Map<String, dynamic>>[];
  silo['windedUntil'] = null;
  return AppState(api)
    ..silo = silo
    ..routes = listFx('routes')
    ..history = listFx('history');
}

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

/// Żaden przycisk na ekranie nie ucina tekstu (akapit ma tyle wysokości, ile tekst potrzebuje).
void expectNoClippedButtons(WidgetTester tester) {
  for (final type in [FilledButton, OutlinedButton]) {
    for (final b in find.byType(type).evaluate()) {
      for (final rt in find.descendant(of: find.byWidget(b.widget), matching: find.byType(RichText)).evaluate()) {
        final rp = rt.renderObject! as RenderParagraph;
        expect(rp.size.height, greaterThanOrEqualTo(rp.getMinIntrinsicHeight(rp.size.width) - 0.5), reason: 'ucięty tekst przycisku');
      }
    }
  }
}

void main() {
  group('Zjazdy', () {
    testWidgets('trasy wg stref, szansa liczbą, przycisk z kosztem; zablokowane i brak pary opisane słowami', (tester) async {
      await pump(tester, DivesScreen(state: appState(FakeApi(), steam: 12)));
      expect(find.text('STREFA GÓRNE'), findsOneWidget);
      expect(find.text('Zjedź · 3 pary'), findsOneWidget);
      expect(find.text('Zjedź · 10 pary'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Brak pary (22)'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Brak pary (22)'), findsOneWidget); // Głęboki kosztuje 22, a jest 12
      await tester.scrollUntilVisible(find.textContaining('Zablokowane · od poziomu'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('szansa '), findsWidgets);
    });

    testWidgets('„Zjedź” woła state.startDive (POST /dives)', (tester) async {
      final api = FakeApi();
      await pump(tester, DivesScreen(state: appState(api)));
      await tester.tap(find.text('Zjedź · 3 pary'));
      await tester.pump();
      expect(api.posts, ['/dives']);
    });

    testWidgets('pełna kolejka: sloty pokazują zjazd w drodze i czekający, trasy mówią „Kolejka pełna”', (tester) async {
      final now = DateTime.now().toUtc();
      final q = [
        {'id': '1', 'routeId': 'plytki', 'startsAt': now.subtract(const Duration(seconds: 60)).toIso8601String(), 'endsAt': now.add(const Duration(seconds: 120)).toIso8601String(), 'running': true},
        {'id': '2', 'routeId': 'sredni', 'startsAt': now.add(const Duration(seconds: 120)).toIso8601String(), 'endsAt': now.add(const Duration(seconds: 1020)).toIso8601String(), 'running': false},
      ];
      await pump(tester, DivesScreen(state: appState(FakeApi(), queue: q)));
      expect(find.text('KOLEJKA 2 / 2'), findsOneWidget);
      expect(find.text('Płytki · w drodze'), findsOneWidget);
      expect(find.text('Średni · czeka'), findsOneWidget);
      expect(find.text('Kolejka pełna'), findsWidgets);
    });

    for (final (size, scale) in [(const Size(320, 640), 1.0), (const Size(320, 640), 1.5)]) {
      testWidgets('bez przepełnień i ucinania: ${size.width.toInt()}x${size.height.toInt()}, tekst x$scale', (tester) async {
        await pump(tester, DivesScreen(state: appState(FakeApi())), size: size, textScale: scale);
        expect(tester.takeException(), isNull);
        expectNoClippedButtons(tester);
        await tester.scrollUntilVisible(find.text('OSTATNIE ZJAZDY'), 400, scrollable: find.byType(Scrollable).first);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('Warsztat', () {
    testWidgets('sloty: założony przedmiot i puste; karta wybranego z akcjami; receptury z filtrem', (tester) async {
      final handle = tester.ensureSemantics();
      final api = FakeApi();
      final it = (api.items['items'] as List).first as Map;
      it['equipped'] = true;
      await pump(tester, WorkshopScreen(state: appState(api)));
      expect(find.bySemanticsLabel(RegExp('^Narzędzie: ${it['name']}, zjazd [+].*, wytrzymałość ')), findsOneWidget);
      expect(find.bySemanticsLabel('Ochrona: pusto'), findsOneWidget);
      expect(find.text('Zdejmij z I'), findsOneWidget);
      expect(find.textContaining('Siła zjazdu +'), findsOneWidget);
      // filtr: tylko lampy
      await tester.scrollUntilVisible(find.text('Lampa'), 300, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Lampa'));
      await tester.pump();
      expect(find.text('Lampa karbidowa'), findsOneWidget);
      expect(find.text('Kask górnika'), findsNothing);
      handle.dispose();
    });

    testWidgets('akcje idą tymi samymi trasami API co dotąd (zdejmij, wytwórz)', (tester) async {
      final api = FakeApi();
      final it = (api.items['items'] as List).first as Map;
      it['equipped'] = true;
      await pump(tester, WorkshopScreen(state: appState(api)));
      await tester.tap(find.text('Zdejmij z I'));
      await tester.pump();
      expect(api.posts, ['/items/${it['id']}/unequip']);
      await tester.pump(const Duration(seconds: 5));
      await tester.scrollUntilVisible(find.text('Receptury'), 300, scrollable: find.byType(Scrollable).first);
      await tester.scrollUntilVisible(find.text('Wytwórz').first, 300, scrollable: find.byType(Scrollable).first);
      await tester.ensureVisible(find.text('Wytwórz').first);
      await tester.pump();
      await tester.tap(find.text('Wytwórz').first);
      await tester.pump();
      expect(api.posts.last, '/items/craft');
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('receptura, na którą nie stać: „Brak” i czerwony chip; zablokowana: „Zablokowane”', (tester) async {
      final api = FakeApi();
      final state = appState(api);
      (state.silo!['wallet'] as Map)['ore'] = 100; // mniej niż Kilof (150)
      await pump(tester, WorkshopScreen(state: state));
      await tester.scrollUntilVisible(find.text('Receptury'), 300, scrollable: find.byType(Scrollable).first);
      await tester.scrollUntilVisible(find.text('Brak').first, 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('Brak'), findsWidgets);
      await tester.scrollUntilVisible(find.text('Zablokowane').first, 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('Wymaga badania'), findsWidgets);
    });

    for (final (size, scale) in [(const Size(320, 640), 1.0), (const Size(320, 640), 1.5)]) {
      testWidgets('bez przepełnień i ucinania: ${size.width.toInt()}x${size.height.toInt()}, tekst x$scale', (tester) async {
        final api = FakeApi();
        ((api.items['items'] as List).first as Map)['equipped'] = true;
        await pump(tester, WorkshopScreen(state: appState(api)), size: size, textScale: scale);
        expect(tester.takeException(), isNull);
        expectNoClippedButtons(tester);
        await tester.scrollUntilVisible(find.text('Skaner sejsmiczny'), 400, scrollable: find.byType(Scrollable).first);
        expect(tester.takeException(), isNull);
        expectNoClippedButtons(tester);
      });
    }
  });
}
