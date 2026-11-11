import 'package:flutter/material.dart';
import '../building_art.dart';
import '../palette.dart';

/// Ekran próbny (tylko debug): siatka 7 budynków x 3 warianty do porównania z arkuszem „Budynki” z makiety.
class ArtPreviewScreen extends StatelessWidget {
  const ArtPreviewScreen({super.key});

  static const _names = {
    BuildingKind.szybGlowny: 'Szyb główny',
    BuildingKind.generatorPary: 'Generator pary',
    BuildingKind.magazyn: 'Magazyn',
    BuildingKind.warsztat: 'Warsztat',
    BuildingKind.wartownia: 'Wartownia',
    BuildingKind.laboratorium: 'Laboratorium',
    BuildingKind.radiostacja: 'Radiostacja',
  };

  @override
  Widget build(BuildContext context) {
    // poziomy reprezentujące progi wyglądu (1–3, 4–7, 8+)
    const levels = [1, buildingArtTier2From, buildingArtTier3From];
    return Container(
      color: Ls.bg,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Row(children: [
            const SizedBox(width: 92),
            for (final l in levels)
              Expanded(child: Text('od poz. $l', textAlign: TextAlign.center, style: const TextStyle(color: Ls.copper, fontSize: 11, fontWeight: FontWeight.w700))),
          ]),
          for (final k in BuildingKind.values)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(children: [
                SizedBox(width: 92, child: Text(_names[k]!, style: const TextStyle(color: Ls.text, fontSize: 12))),
                for (final l in levels)
                  Expanded(
                    child: Container(
                      margin: const EdgeInsets.all(3),
                      decoration: BoxDecoration(color: Ls.card, border: Border.all(color: Ls.border), borderRadius: BorderRadius.circular(10)),
                      child: LayoutBuilder(builder: (context, c) => BuildingArt(kind: k, level: l, width: c.maxWidth)),
                    ),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}
