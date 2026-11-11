import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/screens/onboarding.dart';
import 'package:lastsilo/screens/start_screen.dart';

dynamic fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync());

/// Atrapa API: zapisuje POST-y, GET z fikstur (to, co AppState pobiera po utworzeniu postaci).
class FakeApi extends Api {
  final posts = <(String, Object?)>[];
  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    posts.add((path, body));
    return {};
  }

  @override
  Future<dynamic> get(String path) async => switch (path) {
        '/me' => {'id': 'u1', 'player': {'nickname': 'Sztygar', 'archetype': 'zwiadowca'}},
        '/silo' => fixture('silo'),
        '/dives/routes' => fixture('routes'),
        '/dives/history' => fixture('history'),
        _ => throw ApiException(404, 'not_found'),
      };
}

Future<void> pump(WidgetTester tester, Widget child, {Size size = const Size(411, 860), double textScale = 1, bool still = false}) async {
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale), disableAnimations: still), child: child),
    ),
  ));
  await tester.pump();
}

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
  group('Ekran startowy', () {
    testWidgets('ładowanie: logo, pasek i komunikat; bez animacji w systemie tylko komunikat', (tester) async {
      await pump(tester, const StartScreen());
      expect(find.text('LAST SILO'), findsOneWidget);
      expect(find.text('Łączę z serwerem…'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      await pump(tester, const StartScreen(), still: true);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.text('Łączę z serwerem…'), findsOneWidget);
    });

    testWidgets('błąd: polski komunikat i „Spróbuj ponownie” woła onRetry', (tester) async {
      var retried = 0;
      await pump(tester, StartScreen(error: 'network', onRetry: () => retried++));
      expect(find.text('Brak połączenia z serwerem. Spróbuj ponownie.'), findsOneWidget);
      await tester.tap(find.text('Spróbuj ponownie'));
      expect(retried, 1);
    });

    for (final (size, scale) in [(const Size(320, 640), 1.5), (const Size(320, 480), 2.0)]) {
      testWidgets('bez przepełnień: ${size.width.toInt()}x${size.height.toInt()}, tekst x$scale', (tester) async {
        await pump(tester, StartScreen(error: 'network', onRetry: () {}), size: size, textScale: scale);
        expect(tester.takeException(), isNull);
        expectNoClippedButtons(tester);
      });
    }
  });

  group('Onboarding', () {
    testWidgets('wybór archetypu kartą; zły pseudonim = komunikat bez wysyłki; dobry = POST /players z wybraną specjalizacją', (tester) async {
      final handle = tester.ensureSemantics();
      final api = FakeApi();
      await pump(tester, OnboardingScreen(state: AppState(api)));
      // domyślnie Górnik; wybór Zwiadowcy przez dotknięcie karty
      expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Górnik'))), isSemantics(isChecked: true));
      await tester.ensureVisible(find.text('Zwiadowca'));
      await tester.tap(find.text('Zwiadowca'));
      await tester.pump();
      expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Zwiadowca'))), isSemantics(isChecked: true));
      expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Górnik'))), isSemantics(isChecked: false));

      await tester.enterText(find.byType(TextField), 'x');
      await tester.ensureVisible(find.text('Zacznij'));
      await tester.tap(find.text('Zacznij'));
      await tester.pump();
      expect(find.textContaining('Pseudonim: 3–20 znaków'), findsOneWidget);
      expect(api.posts, isEmpty);

      await tester.enterText(find.byType(TextField), 'Sztygar');
      await tester.tap(find.text('Zacznij'));
      await tester.pump();
      expect(api.posts.map((p) => p.$1), ['/players']);
      expect(api.posts.single.$2, {'nickname': 'Sztygar', 'archetype': 'zwiadowca'});
      handle.dispose();
    });

    for (final (size, scale) in [(const Size(411, 860), 1.0), (const Size(320, 640), 1.5)]) {
      testWidgets('bez przepełnień i uciętych przycisków: ${size.width.toInt()}x${size.height.toInt()}, tekst x$scale', (tester) async {
        await pump(tester, OnboardingScreen(state: AppState(FakeApi())), size: size, textScale: scale);
        expect(tester.takeException(), isNull);
        expectNoClippedButtons(tester);
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -2000));
        await tester.pump();
        expect(tester.takeException(), isNull);
        expectNoClippedButtons(tester);
      });
    }
  });
}
