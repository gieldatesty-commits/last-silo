import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'api.dart';

void main() => runApp(const LastSiloApp());

class LastSiloApp extends StatelessWidget {
  const LastSiloApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        onGenerateTitle: (c) => AppLocalizations.of(c).appTitle,
        theme: ThemeData(colorSchemeSeed: Colors.amber, brightness: Brightness.dark, useMaterial3: true),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const HomeScreen(),
      );
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _api = Api();
  Future<Map<String, dynamic>>? _me;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.appTitle)),
      body: Center(
        child: _me == null
            ? FilledButton(onPressed: () => setState(() => _me = _api.signInAsGuest()), child: Text(t.connect))
            : FutureBuilder<Map<String, dynamic>>(
                future: _me,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) return Text(t.connecting);
                  if (snap.hasError) return Text(t.error);
                  return Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(t.welcome, style: Theme.of(context).textTheme.headlineMedium),
                    const SizedBox(height: 8),
                    Text(t.playerId(snap.data!['id'] as String)),
                  ]);
                },
              ),
      ),
    );
  }
}
