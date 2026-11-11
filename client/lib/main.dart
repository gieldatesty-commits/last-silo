import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'api.dart';
import 'app_state.dart';
import 'screens/onboarding.dart';
import 'screens/shell.dart';
import 'strings.dart';

void main() {
  // licencje czcionek z paczki (SIL OFL 1.1) w ekranie licencji
  LicenseRegistry.addLicense(() async* {
    for (final (pkg, file) in [('Space Grotesk', 'OFL-SpaceGrotesk.txt'), ('Inter', 'OFL-Inter.txt')]) {
      yield LicenseEntryWithLineBreaks([pkg], await rootBundle.loadString('assets/fonts/$file'));
    }
  });
  runApp(const LastSiloApp());
}

class LastSiloApp extends StatefulWidget {
  const LastSiloApp({super.key});
  @override
  State<LastSiloApp> createState() => _LastSiloAppState();
}

class _LastSiloAppState extends State<LastSiloApp> {
  late final AppState state = AppState(Api())..bootstrap();

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Last Silo',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorSchemeSeed: Colors.amber, brightness: Brightness.dark, useMaterial3: true),
        locale: const Locale('pl'),
        supportedLocales: const [Locale('pl')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: ListenableBuilder(
          listenable: state,
          builder: (context, _) {
            if (state.loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
            if (state.me == null) return _Retry(state: state);
            if (!state.hasPlayer) return OnboardingScreen(state: state);
            return Shell(state: state);
          },
        ),
      );
}

class _Retry extends StatelessWidget {
  final AppState state;
  const _Retry({required this.state});
  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(errorText(state.error ?? 'network'), textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(onPressed: state.bootstrap, child: const Text('Spróbuj ponownie')),
            ]),
          ),
        ),
      );
}
