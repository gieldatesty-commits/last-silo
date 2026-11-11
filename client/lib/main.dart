import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'api.dart';
import 'app_state.dart';
import 'palette.dart';
import 'screens/onboarding.dart';
import 'screens/start_screen.dart';
import 'screens/shell.dart';

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
        theme: _theme(),
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
            if (state.loading) return const StartScreen();
            if (state.me == null) return StartScreen(error: state.error ?? 'network', onRetry: state.bootstrap);
            if (!state.hasPlayer) return OnboardingScreen(state: state);
            return Shell(state: state);
          },
        ),
      );
}

/// Motyw całej aplikacji w palecie warstwy wizualnej: tło, czcionka Inter, dolna nawigacja, dialogi i komunikaty,
/// żeby elementy spoza ekranów z LsTheme (nawigacja, snackbar, okna dialogowe) nie odstawały.
ThemeData _theme() {
  final scheme = ColorScheme.fromSeed(seedColor: Ls.amber, brightness: Brightness.dark).copyWith(
    primary: Ls.amber,
    onPrimary: Ls.bg,
    secondary: Ls.copper,
    surface: Ls.panel,
    onSurface: Ls.text,
    error: Ls.warn,
    outline: Ls.locked,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: Ls.body,
    scaffoldBackgroundColor: Ls.bg,
    canvasColor: Ls.bg,
    dividerColor: Ls.border,
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Ls.panel,
      indicatorColor: Ls.amber.withValues(alpha: 0.18),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(color: s.contains(WidgetState.selected) ? Ls.amber : Ls.textMuted)),
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500, color: s.contains(WidgetState.selected) ? Ls.text : Ls.textMuted)),
    ),
    dialogTheme: const DialogThemeData(backgroundColor: Ls.panel, surfaceTintColor: Colors.transparent),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: Ls.panel, surfaceTintColor: Colors.transparent),
    snackBarTheme: const SnackBarThemeData(backgroundColor: Ls.chip, contentTextStyle: TextStyle(color: Ls.text, fontFamily: Ls.body), behavior: SnackBarBehavior.floating),
    appBarTheme: const AppBarTheme(backgroundColor: Ls.bg, foregroundColor: Ls.text, surfaceTintColor: Colors.transparent),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: Ls.amber),
  );
}
