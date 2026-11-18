import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/api.dart';
import 'package:lastsilo/app_state.dart';
import 'package:lastsilo/google_auth.dart';
import 'package:lastsilo/screens/account_screen.dart';
import 'package:lastsilo/screens/onboarding.dart';
import 'package:lastsilo/strings.dart';

/// Konto Google po stronie klienta (docs/konto-google-v1.0.md §4, makiety Konto i KontoStart).
dynamic fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync());

class FakeGoogle implements GoogleAuth {
  FakeGoogle({this.available = true, this.token = 'id-token'});
  @override
  final bool available;
  String? token;
  var signedOut = false;
  @override
  Future<String?> signIn() async => token;
  @override
  Future<String?> silentSignIn() async => token;
  @override
  Future<void> signOut() async => signedOut = true;
}

class FakeApi extends Api {
  FakeApi({GoogleAuth? google, this.linked = false}) : super(google: google ?? FakeGoogle());
  bool linked;
  bool hasPlayer = true;
  String? failWith;
  final calls = <(String, String, Object?)>[];
  var forgotten = false;
  var markedLinked = false;
  String? googleLoginToken;

  String? code = '1A2B-3C4D';
  Map<String, dynamic> get accountJson =>
      {'userId': 'u1', if (code != null) 'code': code, 'createdAt': '2026-11-01T10:00:00Z', 'google': linked, 'googleLinkedAt': null, 'devices': 1};

  @override
  Future<void> signInAsGuest() async {}

  @override
  Future<dynamic> get(String path) async => switch (path) {
        '/account' => accountJson,
        '/me' => {
            'id': 'u1',
            'player': hasPlayer ? {'nickname': 'Emulator1g', 'archetype': 'gornik'} : null
          },
        '/silo' => fixture('silo'),
        '/dives/routes' => fixture('routes'),
        '/dives/history' => fixture('history'),
        _ => throw ApiException(404, 'not_found'),
      };

  @override
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) async {
    calls.add(('POST', path, body));
    if (failWith != null) throw ApiException(409, failWith!);
    if (path == '/account/google/link') {
      expect(idempotent, isTrue, reason: 'łączenie wymaga Idempotency-Key');
      linked = true;
      return accountJson;
    }
    return {};
  }

  @override
  Future<dynamic> delete(String path, {Object? body}) async {
    calls.add(('DELETE', path, body));
    hasPlayer = false;
    return {'deleted': true, 'hadActiveSubscription': false};
  }

  @override
  Future<void> signInWithGoogle(String idToken) async {
    if (failWith != null) throw ApiException(404, failWith!);
    googleLoginToken = idToken;
    hasPlayer = true;
  }

  @override
  Future<void> markGoogleLinked() async => markedLinked = true;

  @override
  Future<void> forgetDevice() async => forgotten = true;
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

AppState playerState(FakeApi api) => AppState(api)
  ..me = {
    'id': 'u1',
    'player': {'nickname': 'Emulator1g', 'archetype': 'gornik'}
  }
  ..silo = Map<String, dynamic>.from(fixture('silo') as Map);

void expectNoClippedText(WidgetTester tester) {
  for (final rt in find.byType(RichText).evaluate()) {
    final rp = rt.renderObject! as RenderParagraph;
    if (!rp.hasSize) continue;
    expect(rp.size.height, greaterThanOrEqualTo(rp.getMinIntrinsicHeight(rp.size.width) - 0.5), reason: 'ucięty tekst: ${rp.text.toPlainText()}');
  }
}

void main() {
  group('Ekran Konto', () {
    testWidgets('gość: status słowem i znakiem, opis ryzyka, „Połącz z Google” łączy przez API', (tester) async {
      final api = FakeApi();
      await pump(tester, AccountScreen(state: playerState(api)));
      expect(find.text('Emulator1g'), findsOneWidget);
      expect(find.text('○ Gość'), findsOneWidget);
      expect(find.textContaining('przepadnie'), findsOneWidget);
      expect(find.textContaining('bez adresu e'), findsOneWidget);
      await tester.tap(find.text('Połącz z Google'));
      await tester.pump();
      await tester.pump();
      expect(api.calls.single.$2, '/account/google/link');
      expect(api.calls.single.$3, {'idToken': 'id-token'});
      expect(api.markedLinked, isTrue);
      expect(find.text('✓ Google'), findsOneWidget);
      expect(find.text('Połącz z Google'), findsNothing);
      expect(find.textContaining('Mam już konto'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('anulowany wybór konta Google: bez żądania i bez komunikatu błędu', (tester) async {
      final api = FakeApi(google: FakeGoogle(token: null));
      final state = playerState(api);
      await pump(tester, AccountScreen(state: state));
      await tester.tap(find.text('Połącz z Google'));
      await tester.pump();
      expect(api.calls, isEmpty);
      expect(state.error, isNull);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('konto Google zajęte: polski komunikat', (tester) async {
      final api = FakeApi()..failWith = 'google_in_use';
      await pump(tester, AccountScreen(state: playerState(api)));
      await tester.tap(find.text('Połącz z Google'));
      await tester.pump();
      await tester.pump();
      expect(find.text(errorText('google_in_use')), findsOneWidget);
      expect(find.text('○ Gość'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('bez GOOGLE_WEB_CLIENT_ID: brak przycisku Google, jest wyjaśnienie', (tester) async {
      await pump(tester, AccountScreen(state: playerState(FakeApi(google: const NoGoogleAuth()))));
      expect(find.text('Połącz z Google'), findsNothing);
      expect(find.textContaining('niedostępne'), findsOneWidget);
    });

    testWidgets('połączone: „✓ Google”, bez przycisku łączenia', (tester) async {
      await pump(tester, AccountScreen(state: playerState(FakeApi(linked: true))));
      expect(find.text('✓ Google'), findsOneWidget);
      expect(find.text('Połącz z Google'), findsNothing);
    });

    testWidgets('usuwanie: ostrzeżenie o subskrypcji, potwierdzenie słowem USUŃ, DELETE z confirm', (tester) async {
      final api = FakeApi();
      final state = playerState(api);
      await pump(tester, AccountScreen(state: state));
      await tester.scrollUntilVisible(find.text('Usuń konto…'), 200, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Usuń konto…'));
      await tester.pumpAndSettle();
      expect(find.text('Usunąć konto?'), findsOneWidget);
      expect(find.textContaining('Usunięty gracz'), findsOneWidget);
      expect(find.textContaining('nie zostanie anulowana'), findsOneWidget);
      expect(find.text('Zarządzaj subskrypcjami w Google Play'), findsOneWidget);
      FilledButton del() => tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Usuń na zawsze'));
      expect(del().onPressed, isNull);
      await tester.enterText(find.byType(TextField), 'usun');
      await tester.pump();
      expect(del().onPressed, isNull, reason: 'trzeba wpisać USUŃ');
      await tester.enterText(find.byType(TextField), 'USUŃ');
      await tester.pump();
      expect(del().onPressed, isNotNull);
      await tester.tap(find.text('Usuń na zawsze'));
      await tester.pumpAndSettle();
      expect(api.calls.single.$1, 'DELETE');
      expect(api.calls.single.$2, '/account');
      expect(api.calls.single.$3, {'confirm': 'USUN'});
      expect(api.forgotten, isTrue);
      expect((api.google as FakeGoogle).signedOut, isTrue);
      expect(state.hasPlayer, isFalse, reason: 'po usunięciu nowy gość bez postaci');
    });

    testWidgets('kod konta do strony usuwania konta; bez pola code linijki nie ma', (tester) async {
      await pump(tester, AccountScreen(state: playerState(FakeApi())));
      await tester.scrollUntilVisible(find.text('1A2B-3C4D'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Kod konta'), findsOneWidget);
      expect(find.textContaining('stronie usuwania konta'), findsOneWidget);
      await pump(tester, AccountScreen(state: playerState(FakeApi()..code = null)));
      expect(find.text('Kod konta', skipOffstage: false), findsNothing);
    });

    testWidgets('usuwanie: „Anuluj” nic nie wysyła', (tester) async {
      final api = FakeApi();
      await pump(tester, AccountScreen(state: playerState(api)));
      await tester.scrollUntilVisible(find.text('Usuń konto…'), 200, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Usuń konto…'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Anuluj'));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty);
    });

    for (final scale in [1.0, 1.5]) {
      testWidgets('bez przepełnień i ucinania: 320x640, tekst x$scale (ekran i dialog)', (tester) async {
        await pump(tester, AccountScreen(state: playerState(FakeApi())), size: const Size(320, 640), textScale: scale);
        expect(tester.takeException(), isNull);
        expectNoClippedText(tester);
        await tester.scrollUntilVisible(find.text('1A2B-3C4D'), 200, scrollable: find.byType(Scrollable).first);
        expect(tester.takeException(), isNull);
        expectNoClippedText(tester);
        await tester.scrollUntilVisible(find.text('Usuń konto…'), 200, scrollable: find.byType(Scrollable).first);
        await tester.tap(find.text('Usuń konto…'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expectNoClippedText(tester);
      });
    }
  });

  group('Tworzenie postaci: „Mam już konto (Google)”', () {
    AppState guest(FakeApi api) => AppState(api)..me = {'id': 'u1', 'player': null};

    testWidgets('przycisk, ostrzeżenie przed przełączeniem, „Przełącz” loguje przez Google', (tester) async {
      final api = FakeApi()..hasPlayer = false;
      final state = guest(api);
      await pump(tester, OnboardingScreen(state: state));
      await tester.scrollUntilVisible(find.textContaining('połączyli postać z Google'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Mam już konto (Google)'), findsOneWidget);
      await tester.tap(find.text('Mam już konto (Google)'));
      await tester.pumpAndSettle();
      expect(find.text('Przełączyć na konto z Google?'), findsOneWidget);
      expect(find.textContaining('Konta nie łączą się'), findsOneWidget);
      await tester.tap(find.text('Zostań'));
      await tester.pumpAndSettle();
      expect(api.googleLoginToken, isNull);
      await tester.tap(find.text('Mam już konto (Google)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Przełącz'));
      await tester.pumpAndSettle();
      expect(api.googleLoginToken, 'id-token');
      expect(state.hasPlayer, isTrue);
    });

    testWidgets('konto Google bez postaci: komunikat z makiety', (tester) async {
      final api = FakeApi()
        ..hasPlayer = false
        ..failWith = 'no_linked_account';
      await pump(tester, OnboardingScreen(state: guest(api)));
      await tester.scrollUntilVisible(find.text('Mam już konto (Google)'), 200, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Mam już konto (Google)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Przełącz'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.textContaining('nie jest połączone z żadną postacią'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text(errorText('no_linked_account')), findsOneWidget);
    });

    testWidgets('bez GOOGLE_WEB_CLIENT_ID przycisku nie ma', (tester) async {
      await pump(tester, OnboardingScreen(state: guest(FakeApi(google: const NoGoogleAuth())..hasPlayer = false)));
      expect(find.text('Mam już konto (Google)', skipOffstage: false), findsNothing);
    });

    testWidgets('utracone konto gościa: ostrzeżenie na ekranie tworzenia postaci', (tester) async {
      final api = FakeApi()
        ..hasPlayer = false
        ..accountReset = true;
      await pump(tester, OnboardingScreen(state: guest(api)));
      expect(find.textContaining('Nie udało się odzyskać'), findsOneWidget);
    });
  });

  test('komunikaty błędów konta po polsku', () {
    for (final c in ['account_already_linked', 'google_in_use', 'no_linked_account', 'bad_nonce', 'google_disabled', 'google_failed', 'bad_google_token']) {
      expect(errorText(c), isNot(startsWith('Coś poszło nie tak')), reason: c);
    }
  });
}
