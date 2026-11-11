import 'package:flutter/material.dart';
import '../building_art.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';

/// Ekran startowy: łączenie z serwerem (logowanie gościa) albo błąd z ponowieniem.
/// Logika bez zmian: `error == null` = trwa ładowanie, inaczej kod błędu i przycisk `onRetry` (AppState.bootstrap).
class StartScreen extends StatelessWidget {
  const StartScreen({super.key, this.error, this.onRetry});
  final String? error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final loading = error == null;
    final still = MediaQuery.disableAnimationsOf(context);
    return LsTheme(
      child: Scaffold(
        backgroundColor: Ls.bg,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 360),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  BuildingArt.fromApi('szyb_glowny', buildingArtTier3From, width: 200),
                  const SizedBox(height: 18),
                  Semantics(header: true, child: Text('LAST SILO', textAlign: TextAlign.center, style: lsDisplay.copyWith(fontSize: 32, letterSpacing: 4))),
                  const SizedBox(height: 6),
                  const Text('Ostatni silos w Głębi', textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: Ls.textMuted)),
                  const SizedBox(height: 32),
                  if (loading) ...[
                    // bez animacji w systemie: tylko tekst (pasek nieokreślony byłby ciągłym ruchem)
                    if (!still) const SizedBox(width: 160, child: LsMeter(null, height: 4)),
                    const SizedBox(height: 12),
                    Semantics(liveRegion: true, child: const Text('Łączę z serwerem…', style: TextStyle(fontSize: 13, color: Ls.textMuted))),
                  ] else ...[
                    LsCard(
                      border: Ls.warn.withValues(alpha: 0.6),
                      child: Row(children: [
                        const Icon(Icons.portable_wifi_off, color: Ls.warnText),
                        const SizedBox(width: 12),
                        Expanded(child: Semantics(liveRegion: true, child: Text(errorText(error!), style: lsBody))),
                      ]),
                    ),
                    const SizedBox(height: 8),
                    LsButton('Spróbuj ponownie', color: Ls.amber, onPressed: onRetry),
                  ],
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
