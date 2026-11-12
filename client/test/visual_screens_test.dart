import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/screens/lab_screen.dart';
import 'package:lastsilo/screens/silo_screen.dart';

Map<String, dynamic> fixture(String name) => Map<String, dynamic>.from(jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map);

/// Atrapa API: odpowiedzi z fikstur, bez sieci. Zapisuje wywołane POST-y.
class FakeApi extends Api {
  FakeApi(this.research);
  final Map<String, dynamic> research;
  final posts = <String>[];

  @override
  Future<dynamic> get(String path) async => switch (path) {
        '/research' => research,
        '/items' => fixture('items'),
        '/codex' => {'unlocked': 0, 'total': 0, 'entries': []},
        _ => throw ApiException(404, 'not_found'),
      };

  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    posts.add(path);
    return {};
  }
}

/// /research z ustawionymi stanami: geologia_1 ukończona, sejsmika w toku (opcjonalnie), reszta jak w fiksturze.
Map<String, dynamic> research({bool withActive = true}) {
  final r = fixture('research');
  final techs = (r['techs'] as List).cast<Map>();
  void set(String id, String s) => techs.firstWhere((t) => t['id'] == id)['state'] = s;
  set('geologia_1', 'done');
  if (withActive) {
    set('sejsmika', 'active');
    r['active'] = {'techId': 'sejsmika', 'endsAt': DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String()};
  } else {
    set('sejsmika', 'available');
  }
  return r;
}

Future<FakeApi> pumpLab(WidgetTester tester, {bool withActive = true, bool disableAnimations = false, Size size = const Size(411, 860), double textScale = 1, bool emptyWallet = false}) async {
  final api = FakeApi(research(withActive: withActive));
  final silo = fixture('silo');
  if (emptyWallet) silo['wallet'] = <String, dynamic>{};
  final state = AppState(api)..silo = silo;
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: disableAnimations, textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: LabScreen(state: state)),
      ),
    ),
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  return api;
}

String buttonText(WidgetTester tester) {
  final b = find.byKey(const ValueKey('lab-action'));
  return find.descendant(of: b, matching: find.byType(Text)).evaluate().map((e) => (e.widget as Text).data ?? '').join();
}

Future<void> selectNode(WidgetTester tester, String label) async {
  final f = find.bySemanticsLabel(RegExp('^$label, '));
  expect(f, findsOneWidget, reason: label);
  await tester.tap(f, warnIfMissed: false);
  await tester.pump();
}

void main() {
  testWidgets('węzeł: Semantics „{nazwa}, {stan}”, przycisk, zaznaczenie', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpLab(tester);
    expect(find.bySemanticsLabel('Geologia I, ukończone'), findsOneWidget);
    expect(find.bySemanticsLabel('Sejsmika, w toku'), findsOneWidget);
    expect(find.bySemanticsLabel('Hydraulika I, dostępne'), findsOneWidget);
    expect(find.bySemanticsLabel('Geologia III, zablokowane'), findsOneWidget);
    final node = tester.getSemantics(find.bySemanticsLabel('Sejsmika, w toku'));
    expect(node, isSemantics(isButton: true, isSelected: true)); // aktywne badanie jest zaznaczone na starcie
    handle.dispose();
  });

  testWidgets('przycisk panelu w każdym stanie (Lab zajęte)', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpLab(tester);
    expect(buttonText(tester), startsWith('W toku, jeszcze '));
    await selectNode(tester, 'Geologia I');
    expect(buttonText(tester), 'Ukończone');
    await selectNode(tester, 'Geologia III');
    expect(buttonText(tester), 'Najpierw spełnij wymagania');
    await selectNode(tester, 'Hydraulika I');
    expect(buttonText(tester), 'Laboratorium zajęte');
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey('lab-action'))).onPressed, isNull);
    handle.dispose();
  });

  testWidgets('dostępne przy wolnym Lab: „Rozpocznij badanie” wysyła start przez API', (tester) async {
    final handle = tester.ensureSemantics();
    final api = await pumpLab(tester, withActive: false);
    await selectNode(tester, 'Hydraulika I');
    expect(buttonText(tester), 'Rozpocznij badanie');
    await tester.tap(find.byKey(const ValueKey('lab-action')));
    await tester.pump();
    expect(api.posts, ['/research/hydraulika_1/start']);
    handle.dispose();
    await tester.pump(const Duration(seconds: 5)); // zamknij snackbar
  });

  testWidgets('brak zasobów przy wolnym Lab: „Brak zasobów”, przycisk wyłączony', (tester) async {
    final handle = tester.ensureSemantics();
    final api = await pumpLab(tester, withActive: false, emptyWallet: true);
    await selectNode(tester, 'Hydraulika I');
    expect(buttonText(tester), 'Brak zasobów');
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey('lab-action'))).onPressed, isNull);
    expect(api.posts, isEmpty);
    handle.dispose();
  });

  testWidgets('puls aktywnego węzła: animuje, a przy disableAnimations stoi', (tester) async {
    await pumpLab(tester);
    expect(tester.binding.hasScheduledFrame, isTrue, reason: 'puls powinien planować klatki');
    await pumpLab(tester, disableAnimations: true);
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.binding.hasScheduledFrame, isFalse, reason: 'bez animacji nie ma kolejnych klatek');
    // stan nadal czytelny bez ruchu: „…” w węźle i licznik w pasku
    expect(find.text('…'), findsOneWidget);
    expect(find.textContaining('W toku: Sejsmika'), findsOneWidget);
  });

  for (final (size, scale) in [(const Size(390, 844), 1.0), (const Size(320, 640), 1.0), (const Size(320, 640), 1.5)]) {
    testWidgets('Lab bez przepełnień: ${size.width.toInt()}x${size.height.toInt()}, tekst x$scale', (tester) async {
      await pumpLab(tester, size: size, textScale: scale);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Silos bez przepełnień: ${size.width.toInt()}x${size.height.toInt()}, tekst x$scale', (tester) async {
      final state = AppState(FakeApi(research()))..silo = fixture('silo');
      tester.view.physicalSize = size * tester.view.devicePixelRatio;
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
            child: Scaffold(body: SiloScreen(state: state)),
          ),
        ),
      ));
      await tester.pump();
      expect(tester.takeException(), isNull);
      // przyciski ulepszeń nie ucinają tekstu: akapit ma tyle wysokości, ile tekst potrzebuje przy swojej szerokości
      for (final b in find.byType(OutlinedButton).evaluate()) {
        final rp = tester.renderObject<RenderParagraph>(find.descendant(of: find.byWidget(b.widget), matching: find.byType(RichText)));
        expect(rp.size.height, greaterThanOrEqualTo(rp.getMinIntrinsicHeight(rp.size.width) - 0.5), reason: 'ucięty tekst przycisku');
      }
      // przewija się zamiast ucinać: ostatnie pomieszczenie dostępne po przewinięciu
      await tester.scrollUntilVisible(find.text('Laboratorium'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Laboratorium'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
