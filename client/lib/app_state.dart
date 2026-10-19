import 'package:flutter/foundation.dart';
import 'api.dart';

/// Stan całej aplikacji: odpowiedzi serwera + akcje. Serwer jest autorytatywny,
/// więc po każdej akcji pobieramy świeży stan zamiast liczyć go u siebie.
class AppState extends ChangeNotifier {
  final Api api;
  AppState(this.api);

  Map<String, dynamic>? me;
  Map<String, dynamic>? silo;
  List<Map<String, dynamic>> routes = const [];
  List<Map<String, dynamic>> history = const [];

  bool loading = true;
  bool busy = false;

  /// Kod ostatniego błędu (do pokazania w UI); [consumeError] go czyści.
  String? error;

  bool get hasPlayer => (me?['player'] as Map?)?['nickname'] != null;

  Future<void> bootstrap() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      await api.signInAsGuest();
      me = _map(await api.get('/me'));
      if (hasPlayer) await _loadGame();
    } on ApiException catch (e) {
      error = e.code;
    }
    loading = false;
    notifyListeners();
  }

  Future<void> _loadGame() async {
    final r = await Future.wait([api.get('/silo'), api.get('/dives/routes'), api.get('/dives/history')]);
    silo = _map(r[0]);
    routes = _list(r[1]);
    history = _list(r[2]);
  }

  /// Odświeża stan gry (np. pociągnięcie w dół albo koniec odliczania).
  Future<void> refresh() async {
    if (!hasPlayer) return;
    try {
      await _loadGame();
      error = null;
    } on ApiException catch (e) {
      error = e.code;
    }
    notifyListeners();
  }

  Future<bool> createPlayer(String nickname, String archetype) => _act(() async {
        await api.post('/players', body: {'nickname': nickname, 'archetype': archetype});
        me = _map(await api.get('/me'));
        await _loadGame();
      });

  Future<bool> upgrade(String type) => _act(() async {
        await api.post('/buildings/$type/upgrade', idempotent: true);
        await _loadGame();
      });

  Future<bool> startDive(String routeId) => _act(() async {
        await api.post('/dives', body: {'routeId': routeId}, idempotent: true);
        await _loadGame();
      });

  /// Wykonuje akcję użytkownika z blokadą `busy` i obsługą błędów; po sukcesie odświeża stan gry (zasoby).
  Future<bool> run(Future<void> Function() f, {bool reloadGame = true}) => _act(f, reloadGame: reloadGame);

  Future<bool> _act(Future<void> Function() f, {bool reloadGame = false}) async {
    if (busy) return false;
    busy = true;
    error = null;
    notifyListeners();
    var ok = true;
    try {
      await f();
      if (reloadGame && hasPlayer) await _loadGame();
    } on ApiException catch (e) {
      error = e.code;
      ok = false;
      // po błędzie stan mógł się zmienić (np. ktoś inny zabrał ofertę); odświeżamy po cichu
      if (hasPlayer && e.status != 0) {
        try {
          await _loadGame();
        } on ApiException catch (_) {}
      }
    }
    busy = false;
    notifyListeners();
    return ok;
  }

  String? consumeError() {
    final e = error;
    error = null;
    return e;
  }

  static Map<String, dynamic> _map(dynamic v) => Map<String, dynamic>.from(v as Map);
  static List<Map<String, dynamic>> _list(dynamic v) =>
      (v as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
}
