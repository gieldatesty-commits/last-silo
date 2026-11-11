import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';
import '../widgets.dart';
import 'contracts_screen.dart';
import 'market_screen.dart';
import 'radio_screen.dart';
import 'raids_screen.dart';
import 'ranking_screen.dart';
import 'season_screen.dart';
import 'stats_screen.dart';

/// Menu „Więcej”: reszta ekranów gry.
class MoreScreen extends StatelessWidget {
  final AppState state;
  const MoreScreen({super.key, required this.state});

  void _open(BuildContext context, String title, Widget body) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SubScreen(title: title, body: body)));
  }

  @override
  Widget build(BuildContext context) {
    final items = <(IconData, String, String, Widget Function())>[
      (Icons.person_outline, 'Postać', 'Cechy i wolne punkty', () => StatsScreen(state: state)),
      (Icons.settings_input_antenna, 'Radio', 'Nasłuch, namierzanie, nadawanie', () => RadioScreen(state: state)),
      (Icons.flag_outlined, 'Najazdy', 'Cele i historia', () => RaidsScreen(state: state)),
      (Icons.leaderboard_outlined, 'Ranking', 'Najsilniejsze silosy', () => RankingScreen(state: state)),
      (Icons.storefront_outlined, 'Rynek', 'Handel materiałami i karawany', () => MarketScreen(state: state)),
      (Icons.assignment_outlined, 'Zlecenia', 'Dzienna tablica zleceń NPC', () => ContractsScreen(state: state)),
      (Icons.event_outlined, 'Sezon', 'Postęp, tytuły, wyniki', () => SeasonScreen(state: state)),
      (Icons.terrain_outlined, 'Geologia', 'Czym obfituje Twoja okolica', () => _Geology(state: state)),
    ];
    return ListView(
      children: [
        for (final it in items)
          ListTile(
            leading: Icon(it.$1),
            title: Text(it.$2),
            subtitle: Text(it.$3),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _open(context, it.$2, it.$4()),
          ),
      ],
    );
  }
}

class _Geology extends StatelessWidget {
  final AppState state;
  const _Geology({required this.state});
  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/geology'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final mats = asList(d['materials']);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('Materiały występują w złożach nierówno. To, czego brakuje w Twojej okolicy, kupisz na Rynku albo u Handlarza.'),
            const SizedBox(height: 8),
            for (final m in mats) Card(child: ListTile(title: Text(m['name'] as String), subtitle: Text(localNames[m['local']] ?? '${m['local']}'))),
            Text('Materiały odblokowuje Radiostacja poz. ${d['exchangeRadio']}.', style: Theme.of(context).textTheme.bodySmall),
          ],
        );
      },
    );
  }
}
