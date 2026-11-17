import 'package:google_sign_in/google_sign_in.dart';

/// Identyfikator klienta OAuth typu „Web” z Google Cloud (ten sam co GOOGLE_WEB_CLIENT_ID serwera).
/// Bez niego (`--dart-define=GOOGLE_WEB_CLIENT_ID=...`) logowanie Google jest wyłączone i przyciski ukryte.
const googleWebClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');

/// Logowanie Google po stronie klienta: zwraca tylko ID token dla serwera (docs/konto-google-v1.0.md §4).
/// Za interfejsem, żeby testy widżetów nie dotykały wtyczki.
abstract class GoogleAuth {
  factory GoogleAuth.fromEnvironment() => googleWebClientId.isEmpty ? const NoGoogleAuth() : PluginGoogleAuth(googleWebClientId);

  /// czy pokazywać przyciski Google
  bool get available;

  /// Wybór konta przez użytkownika. `null` = użytkownik anulował.
  Future<String?> signIn();

  /// Ciche logowanie (bez okna), np. po utracie sekretu gościa. `null` = się nie udało.
  Future<String?> silentSignIn();

  Future<void> signOut();
}

/// Błąd logowania Google inny niż anulowanie (np. zła konfiguracja klienta OAuth, brak usług Google).
class GoogleAuthFailure implements Exception {
  const GoogleAuthFailure(this.reason);
  final String reason;
  @override
  String toString() => 'GoogleAuthFailure($reason)';
}

class NoGoogleAuth implements GoogleAuth {
  const NoGoogleAuth();
  @override
  bool get available => false;
  @override
  Future<String?> signIn() async => null;
  @override
  Future<String?> silentSignIn() async => null;
  @override
  Future<void> signOut() async {}
}

/// Wtyczka google_sign_in 7.x. Bez nonce (decyzja v1, docs/konto-google-v1.0.md §3.3).
class PluginGoogleAuth implements GoogleAuth {
  PluginGoogleAuth(this.serverClientId);
  final String serverClientId;
  Future<void>? _init;

  Future<void> _ready() => _init ??= GoogleSignIn.instance.initialize(serverClientId: serverClientId);

  @override
  bool get available => true;

  @override
  Future<String?> signIn() async {
    try {
      await _ready();
      final account = await GoogleSignIn.instance.authenticate();
      return account.authentication.idToken;
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled || e.code == GoogleSignInExceptionCode.interrupted) return null;
      throw GoogleAuthFailure(e.code.name);
    }
  }

  @override
  Future<String?> silentSignIn() async {
    try {
      await _ready();
      final account = await GoogleSignIn.instance.attemptLightweightAuthentication();
      return account?.authentication.idToken;
    } on GoogleSignInException {
      return null;
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await _ready();
      await GoogleSignIn.instance.signOut();
    } on GoogleSignInException {
      // wylogowanie z Google jest tylko porządkiem; konto gry i tak jest już usunięte
    }
  }
}
