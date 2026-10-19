# Klient (Flutter, Android)

Stan: **wszystkie ekrany obecnego API** (logowanie gościa, tworzenie postaci, Silos, Zjazdy, Warsztat, Laboratorium z Kodeksem, a w menu „Więcej”: Postać, Radio, Najazdy, Ranking, Rynek z karawanami, Zlecenia, Sezon, Geologia).
**Nie był kompilowany ani uruchamiany** (w środowisku autora nie ma Fluttera), więc przy pierwszym `flutter run` możliwe są drobne poprawki.

Ekrany: `screens/` (shell z dolną nawigacją, `more_screen` to menu reszty). Wspólne: `widgets.dart` (`Loader` z odświeżaniem, okna ilości i ubezpieczenia, `act` = akcja + odświeżenie), `strings.dart` (teksty i komunikaty błędów).

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

Kolejne kroki: testy na urządzeniu i poprawki po pierwszym uruchomieniu, push (FCM), rozliczanie subskrypcji, grafika i dźwięk, wersja angielska (przeniesienie `strings.dart` do l10n).

Znane braki: brak ekranu logowania kontem Google (jest tylko gość), brak powiadomień push, brak widoku subskrypcji, teksty tylko po polsku.
