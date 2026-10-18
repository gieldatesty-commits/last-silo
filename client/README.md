# Klient (Flutter, Android)

Szkielet M0: ekran z przyciskiem „Zejdź na dół” → logowanie gościa → `GET /me`.
**Nie był kompilowany** (autor nie miał Fluttera w środowisku).

Pierwsze uruchomienie:
```bash
cd client
flutter create . --platforms=android --org pl.lastsilo --project-name lastsilo   # generuje android/
flutter pub get
flutter gen-l10n
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```
Uwaga: dla `http://` (nie https) na emulatorze dodaj `android:usesCleartextTraffic="true"` w AndroidManifest (tylko do dev).
`flutter_secure_storage` 9.x wymaga `minSdkVersion 18+` (domyślnie OK).
