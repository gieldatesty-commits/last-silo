import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Adres serwera; nadpisz: flutter run --dart-define=API_URL=https://twoja.domena
/// 10.0.2.2 = localhost hosta widziany z emulatora Androida.
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000');

class Api {
  final _store = const FlutterSecureStorage();
  String? _token;

  /// Loguje zapisane konto gościa albo tworzy nowe. Zwraca odpowiedź /me.
  Future<Map<String, dynamic>> signInAsGuest() async {
    final userId = await _store.read(key: 'userId');
    final secret = await _store.read(key: 'guestSecret');
    final body = (userId != null && secret != null)
        ? jsonEncode({'userId': userId, 'guestSecret': secret})
        : '{}';
    final res = await http.post(
      Uri.parse('$apiUrl/auth/guest'),
      headers: {'content-type': 'application/json'},
      body: body,
    );
    if (res.statusCode != 200 && res.statusCode != 201) {
      throw Exception('auth ${res.statusCode}');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    _token = data['token'] as String;
    if (data['guestSecret'] != null) {
      await _store.write(key: 'userId', value: data['userId'] as String);
      await _store.write(key: 'guestSecret', value: data['guestSecret'] as String);
    }
    return me();
  }

  Future<Map<String, dynamic>> me() async {
    final res = await http.get(
      Uri.parse('$apiUrl/me'),
      headers: {'authorization': 'Bearer $_token'},
    );
    if (res.statusCode != 200) throw Exception('me ${res.statusCode}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }
}
