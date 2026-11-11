import 'dart:convert';
import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Adres serwera; nadpisz: flutter run --dart-define=API_URL=https://twoja.domena
/// 10.0.2.2 = localhost hosta widziany z emulatora Androida.
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000');

/// Błąd z serwera: [code] to kod z pola `error` (np. insufficient_ore), [status] to kod HTTP.
/// status 0 = brak połączenia.
class ApiException implements Exception {
  final int status;
  final String code;
  const ApiException(this.status, this.code);
  @override
  String toString() => 'ApiException($status, $code)';
}

class Api {
  final _store = const FlutterSecureStorage();
  final _rnd = Random.secure();
  String? _token;

  /// Klucz idempotencji: ten sam przy ponowieniu żądania, więc akcja nie wykona się dwa razy.
  String newKey() => List.generate(16, (_) => _rnd.nextInt(256).toRadixString(16).padLeft(2, '0')).join();

  /// Loguje zapisane konto gościa albo tworzy nowe.
  Future<void> signInAsGuest() async {
    String? userId;
    String? secret;
    try {
      userId = await _store.read(key: 'userId');
      secret = await _store.read(key: 'guestSecret');
    } catch (_) {
      // uszkodzony magazyn: zaczynamy od nowego konta
    }
    final body = (userId != null && secret != null) ? {'userId': userId, 'guestSecret': secret} : <String, dynamic>{};
    dynamic res;
    try {
      res = await _raw('POST', '/auth/guest', body: body, auth: false);
    } on ApiException catch (e) {
      // Serwer nie zna zapisanego gościa (np. wyczyszczona baza). Konta gościa nie da się odzyskać,
      // więc zakładamy nowe zamiast blokować aplikację na ekranie błędu.
      if (e.code != 'invalid_credentials' || body.isEmpty) rethrow;
      await _store.delete(key: 'userId');
      await _store.delete(key: 'guestSecret');
      res = await _raw('POST', '/auth/guest', body: <String, dynamic>{}, auth: false);
    }
    final data = res as Map<String, dynamic>;
    _token = data['token'] as String;
    if (data['guestSecret'] != null) {
      await _store.write(key: 'userId', value: data['userId'] as String);
      await _store.write(key: 'guestSecret', value: data['guestSecret'] as String);
    }
  }

  Future<dynamic> get(String path) => _call('GET', path);
  Future<dynamic> post(String path, {Object? body, bool idempotent = false}) =>
      _call('POST', path, body: body, key: idempotent ? newKey() : null);
  Future<dynamic> delete(String path) => _call('DELETE', path);

  Future<dynamic> _call(String method, String path, {Object? body, String? key}) async {
    if (_token == null) await signInAsGuest();
    try {
      return await _raw(method, path, body: body, key: key);
    } on ApiException catch (e) {
      if (e.status != 401) rethrow;
      // token wygasł: logujemy się ponownie i powtarzamy z tym samym kluczem idempotencji
      await signInAsGuest();
      return _raw(method, path, body: body, key: key);
    }
  }

  Future<dynamic> _raw(String method, String path, {Object? body, String? key, bool auth = true}) async {
    final headers = <String, String>{
      'content-type': 'application/json',
      if (auth && _token != null) 'authorization': 'Bearer $_token',
      if (key != null) 'idempotency-key': key,
    };
    final uri = Uri.parse('$apiUrl$path');
    http.Response res;
    try {
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 15));
        case 'DELETE':
          res = await http.delete(uri, headers: headers).timeout(const Duration(seconds: 15));
        default:
          res = await http.post(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 15));
      }
    } catch (_) {
      throw const ApiException(0, 'network');
    }
    dynamic json;
    try {
      json = res.body.isEmpty ? null : jsonDecode(res.body);
    } catch (_) {
      json = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return json;
    final code = (json is Map && json['error'] is String) ? json['error'] as String : 'http_${res.statusCode}';
    throw ApiException(res.statusCode, code);
  }
}
