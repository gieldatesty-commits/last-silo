# Klient (Flutter, Android)

Stan: **krok 1**: logowanie gościa, tworzenie postaci, ekran Silos (zasoby, budynki, ulepszenia) i Zjazdy (kolejka, trasy, historia).
**Nie był kompilowany ani uruchamiany** (w środowisku autora nie ma Fluttera), więc przy pierwszym `flutter run` możliwe są drobne poprawki.

Architektura: `api.dart` (HTTP, JWT, klucze idempotencji, ponowne logowanie po 401) → `app_state.dart` (jeden `ChangeNotifier`, serwer jest autorytatywny: po każdej akcji pobieramy świeży stan) → `screens/*`. Bez generowania kodu; teksty w `strings.dart`.

Pierwsze uruchomienie:
```bash
cd client
flutter create . --platforms=android --org pl.lastsilo --project-name lastsilo   # generuje android/
flutter pub get
flutter test
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```
Dla `http://` (nie https) na emulatorze dodaj `android:usesCleartextTraffic="true"` w AndroidManifest (tylko do dev).

Kolejne kroki: Warsztat i Laboratorium, kodeks, radio i najazdy, ranking, rynek i karawany, zlecenia, sezon, push (FCM).
