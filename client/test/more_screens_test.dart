import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/screens/contracts_screen.dart';
import 'package:lastsilo/screens/market_screen.dart';
import 'package:lastsilo/screens/more_screen.dart';
import 'package:lastsilo/screens/radio_screen.dart';
import 'package:lastsilo/screens/raids_screen.dart';
import 'package:lastsilo/screens/ranking_screen.dart';
import 'package:lastsilo/screens/season_screen.dart';
import 'package:lastsilo/screens/stats_screen.dart';
import 'package:lastsilo/widgets.dart';

/// Fikstury: prawdziwe odpowiedzi API gracza testowego (test/fixtures/more/*.json), plus dwa przypadki syntetyczne
/// w kształcie z API: oferta na liście (gracz testowy nie miał żadnej) i zamknięty sezon (pierwszy jeszcze trwa).
dynamic fx(String name) => jsonDecode(File('test/fixtures/more/$name.json').readAsStringSync());

class FakeApi extends Api {
  final posts = <String>[];
  @override
  Future<dynamic> get(String path) async {
    final now = DateTime.now().toUtc();
    switch (path) {
      case '/market/listings':
        return {
          'listings': [
            {'id': '7', 'material': 'miedz', 'qty': 6, 'unitPrice': 100, 'expiresAt': now.add(const Duration(hours: 40)).toIso8601String(), 'seller': 'Rywal', 'mine': false, 'distanceKm': 18500, 'etaMinutes': 1850, 'shipPerUnit': 84, 'totalPerUnit': 184, 'ambushChance': 12, 'npcPrice': 140},
          ],
        };
      case '/season/results':
        return {
          'season': 1,
          'total': 3,
          'top': [
            {'rank': 1, 'nickname': 'Rywal', 'level': 20, 'power': 140, 'loot': 3000, 'title': 'Mistrz Głębi'},
            {'rank': 2, 'nickname': 'Tester1', 'level': 18, 'power': 120, 'loot': 0, 'title': null},
          ],
          'me': {'rank': 3, 'nickname': 'Ja', 'level': 12, 'power': 90, 'loot': 150, 'title': null, 'startBonusOre': 500},
        };
    }
    final f = path.replaceAll(RegExp(r'^/'), '').replaceAll(RegExp(r'[/?=]'), '_');
    if (File('test/fixtures/more/$f.json').existsSync()) return fx(f);
    throw ApiException(404, 'not_found');
  }

  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    posts.add(path);
    return {};
  }

  @override
  Future<dynamic> delete(String path) async {
    posts.add('DELETE $path');
    return {};
  }
}

AppState appState(FakeApi api) {
  final silo = Map<String, dynamic>.from(jsonDecode(File('test/fixtures/silo.json').readAsStringSync()) as Map);
  (silo['player'] as Map)['freePoints'] = 3;
  return AppState(api)..silo = silo;
}

Future<void> pump(WidgetTester tester, Widget child, {Size size = const Size(411, 860), double textScale = 1}) async {
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)), child: child),
    ),
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void expectNoClippedText(WidgetTester tester) {
  for (final type in [FilledButton, OutlinedButton]) {
    for (final b in find.byType(type).evaluate()) {
      for (final rt in find.descendant(of: find.byWidget(b.widget), matching: find.byType(RichText)).evaluate()) {
        final rp = rt.renderObject! as RenderParagraph;
        expect(rp.size.height, greaterThanOrEqualTo(rp.getMinIntrinsicHeight(rp.size.width) - 0.5), reason: 'ucięty tekst przycisku');
      }
    }
  }
}

/// Przewija ekran do końca (wszystkie przewijalne listy), sprawdzając po drodze brak wyjątków.
Future<void> scrollThrough(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    final s = find.byType(Scrollable);
    if (s.evaluate().isEmpty) break;
    await tester.drag(s.first, const Offset(0, -600), warnIfMissed: false);
    await tester.pump();
    expect(tester.takeException(), isNull);
    expectNoClippedText(tester);
  }
}

void main() {
  final screens = <String, Widget Function(AppState)>{
    'Więcej (kafelki)': (s) => Scaffold(body: MoreScreen(state: s)),
    'Postać': (s) => SubScreen(title: 'Postać', body: StatsScreen(state: s)),
    'Radio': (s) => SubScreen(title: 'Radio', body: RadioScreen(state: s)),
    'Najazdy': (s) => SubScreen(title: 'Najazdy', body: RaidsScreen(state: s)),
    'Ranking': (s) => SubScreen(title: 'Ranking', body: RankingScreen(state: s)),
    'Rynek': (s) => SubScreen(title: 'Rynek', body: MarketScreen(state: s)),
    'Zlecenia': (s) => SubScreen(title: 'Zlecenia', body: ContractsScreen(state: s)),
    'Sezon': (s) => SubScreen(title: 'Sezon', body: SeasonScreen(state: s)),
  };

  for (final e in screens.entries) {
    for (final (size, scale) in [(const Size(411, 860), 1.0), (const Size(320, 640), 1.5)]) {
      testWidgets('${e.key}: bez przepełnień i uciętych przycisków, ${size.width.toInt()}x${size.height.toInt()} tekst x$scale', (tester) async {
        await pump(tester, e.value(appState(FakeApi())), size: size, textScale: scale);
        expect(tester.takeException(), isNull);
        expectNoClippedText(tester);
        await scrollThrough(tester);
      });
    }
  }

  testWidgets('Rynek: wszystkie 4 zakładki renderują się na wąskim ekranie z dużą czcionką', (tester) async {
    await pump(tester, SubScreen(title: 'Rynek', body: MarketScreen(state: appState(FakeApi()))), size: const Size(320, 640), textScale: 1.5);
    for (final tab in ['Moje', 'Handlarz', 'Karawany']) {
      // przewijalny pasek zakładek: przy dużej czcionce dalsze zakładki są poza ekranem
      await tester.ensureVisible(find.text(tab));
      await tester.pumpAndSettle();
      await tester.tap(find.text(tab));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: tab);
      expectNoClippedText(tester);
      await scrollThrough(tester);
    }
    expect(find.textContaining('dojedzie za'), findsWidgets); // karawana w drodze z fikstury
  });

  testWidgets('Radio: radar z opisem dla czytnika ekranu, „Namierz” wysyła kontakt', (tester) async {
    final handle = tester.ensureSemantics();
    final api = FakeApi();
    await pump(tester, SubScreen(title: 'Radio', body: RadioScreen(state: appState(api))));
    expect(find.bySemanticsLabel(RegExp(r'^Radar: \d+ sygnał')), findsOneWidget);
    expect(find.bySemanticsLabel('Odbiornik: jest'), findsOneWidget);
    final namierz = find.textContaining('Namierz');
    if (namierz.evaluate().isNotEmpty) {
      await tester.ensureVisible(namierz.first);
      await tester.pumpAndSettle();
      await tester.tap(namierz.first);
      await tester.pump();
      expect(api.posts, ['/radio/contact']);
      await tester.pump(const Duration(seconds: 5));
    }
    handle.dispose();
  });

  testWidgets('Postać: + i − rozdzielają wolne punkty, „Przydziel” wysyła POST /players/stats', (tester) async {
    final api = FakeApi();
    await pump(tester, SubScreen(title: 'Postać', body: StatsScreen(state: appState(api))));
    await tester.tap(find.byTooltip('Dodaj punkt: Technika'));
    await tester.tap(find.byTooltip('Dodaj punkt: Technika'));
    await tester.pump();
    expect(find.text('+2'), findsOneWidget);
    expect(find.text('Przydziel punkty (2)'), findsOneWidget);
    await tester.tap(find.text('Przydziel punkty (2)'));
    await tester.pump();
    expect(api.posts, ['/players/stats']);
  });

  testWidgets('Najazdy: siła przeciwnika znakiem i słowem, nie tylko kolorem', (tester) async {
    await pump(tester, SubScreen(title: 'Najazdy', body: RaidsScreen(state: appState(FakeApi()))));
    expect(find.textContaining(RegExp(r'^[▼≈▲] ')), findsWidgets);
  });

  testWidgets('Sezon: wyniki zamkniętego sezonu, moje miejsce spoza czołówki pod kreską', (tester) async {
    await pump(tester, SubScreen(title: 'Sezon', body: SeasonScreen(state: appState(FakeApi()))));
    await tester.scrollUntilVisible(find.textContaining('Ja (Ty)'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.textContaining('Mistrz Głębi'), findsOneWidget);
    expect(find.text('Premia startowa: 500 rudy'), findsOneWidget);
  });

  test('radarBlips: kierunek z sektora, odległość względem zasięgu, rozsunięcie w tym samym sektorze', () {
    final b = radarBlips([
      {'sector': 'N', 'distanceKm': 5000, 'contacted': false},
      {'sector': 'E', 'distanceKm': 20000, 'contacted': true},
      {'sector': 'E', 'distanceKm': 10, 'contacted': false},
    ], 10000);
    expect(b[0].angle, closeTo(0, 1e-9));
    expect(b[0].radius, closeTo(0.5, 1e-9));
    expect(b[1].angle, closeTo(math.pi / 2, 1e-9));
    expect(b[1].radius, 1.0); // poza zasięgiem: na krawędzi
    expect(b[1].known, isTrue);
    expect(b[2].angle, isNot(closeTo(b[1].angle, 1e-3))); // drugi w sektorze odsunięty
    expect(b[2].radius, 0.12); // bardzo blisko: nie w samym środku (tam jest Twój silos)
  });
}
