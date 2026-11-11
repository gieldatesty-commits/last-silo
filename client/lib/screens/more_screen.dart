import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../resource_art.dart';
import '../strings.dart';
import '../ui.dart';
import '../widgets.dart';
import 'art_preview_screen.dart';
import 'contracts_screen.dart';
import 'market_screen.dart';
import 'radio_screen.dart';
import 'raids_screen.dart';
import 'ranking_screen.dart';
import 'season_screen.dart';
import 'stats_screen.dart';

/// Menu „Więcej” jako kafelki (2 kolumny): ikona, nazwa i jeden żywy szczegół z bieżącego stanu gry.
class MoreScreen extends StatefulWidget {
  final AppState state;
  const MoreScreen({super.key, required this.state});

  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  /// /season tylko dla podpisu kafelka (dzień sezonu); błąd = podpis ogólny
  late final Future<dynamic> _season = widget.state.api.get('/season').catchError((_) => null);

  void _open(BuildContext context, String title, Widget body) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SubScreen(title: title, body: body)));
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    return LsTheme(
      child: ColoredBox(
        color: Ls.bg,
        child: ListenableBuilder(
          listenable: state,
          builder: (context, _) {
            final s = state.silo;
            final player = (s?['player'] as Map?) ?? const {};
            final radio = (s?['radio'] as Map?) ?? const {};
            final wallet = (s?['wallet'] as Map?) ?? const {};
            final deposit = (s?['silo'] as Map?)?['deposit'];
            final free = asNum(player['freePoints']).toInt();
            final mats = materialIds.where((m) => asNum(wallet[m]) > 0).length;
            final radioDetail = radio['receiver'] != true
                ? 'bez odbiornika · poz. ${radio['level'] ?? 1}'
                : radio['on'] == true && radio['transmitter'] == true
                    ? 'poz. ${radio['level']} · nadajesz'
                    : 'poz. ${radio['level']} · tylko nasłuch';
            final tiles = <_Tile>[
              _Tile(Icons.person_outline, 'Postać', free > 0 ? 'poziom ${player['level']} · $free wolne pkt' : 'poziom ${player['level'] ?? 1}', Ls.amber, () => StatsScreen(state: state), highlight: free > 0),
              _Tile(Icons.settings_input_antenna, 'Radio', radioDetail, Ls.teal, () => RadioScreen(state: state)),
              _Tile(Icons.flag_outlined, 'Najazdy', s?['protectedUntil'] != null ? 'ochrona przed najazdami' : 'cele z namierzonych sygnałów', Ls.warn, () => RaidsScreen(state: state)),
              _Tile(Icons.leaderboard_outlined, 'Ranking', 'siła i łup nadających', Ls.violet, () => RankingScreen(state: state)),
              _Tile(Icons.storefront_outlined, 'Rynek', mats > 0 ? 'masz $mats z 3 materiałów' : 'materiały i karawany', Ls.copper, () => MarketScreen(state: state)),
              _Tile(Icons.assignment_outlined, 'Zlecenia', 'dzienna tablica NPC', Ls.amber, () => ContractsScreen(state: state)),
              _Tile(Icons.event_outlined, 'Sezon', null, Ls.teal, () => SeasonScreen(state: state), future: _season),
              _Tile(Icons.terrain_outlined, 'Geologia', deposit != null ? 'Twoje złoże: ${richnessNames[deposit] ?? deposit}' : 'czym obfituje okolica', Ls.copper, () => _Geology(state: state)),
              if (kDebugMode) _Tile(Icons.grid_view, 'Grafiki budynków', 'podgląd 7 x 3 (debug)', Ls.textMuted, () => const ArtPreviewScreen()),
            ];
            return ListView(
              padding: const EdgeInsets.only(bottom: 16),
              children: [
                const LsHeader('Więcej', subtitle: 'Postać, kontakt z innymi silosami, handel i sezon.'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Column(children: [
                    for (var i = 0; i < tiles.length; i += 2)
                      IntrinsicHeight(
                        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Expanded(child: _TileView(tile: tiles[i], onTap: () => _open(context, tiles[i].title, tiles[i].build()))),
                          const SizedBox(width: 8),
                          Expanded(child: i + 1 < tiles.length ? _TileView(tile: tiles[i + 1], onTap: () => _open(context, tiles[i + 1].title, tiles[i + 1].build())) : const SizedBox()),
                        ]),
                      ),
                  ]),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Tile {
  _Tile(this.icon, this.title, this.detail, this.color, this.build, {this.highlight = false, this.future});
  final IconData icon;
  final String title;
  final String? detail;
  final Color color;
  final Widget Function() build;
  final bool highlight;
  final Future<dynamic>? future;
}

class _TileView extends StatelessWidget {
  const _TileView({required this.tile, required this.onTap});
  final _Tile tile;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    Widget detail(String text) => Text(text, style: TextStyle(fontSize: 12, color: tile.highlight ? Ls.amber : Ls.textMuted));
    return Semantics(
      button: true,
      label: tile.title,
      child: LsCard(
        onTap: onTap,
        border: tile.highlight ? Ls.amber.withValues(alpha: 0.6) : null,
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: tile.color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(12)),
            child: Icon(tile.icon, color: tile.color, size: 22),
          ),
          const SizedBox(height: 10),
          Text(tile.title, style: lsDisplay.copyWith(fontSize: 16)),
          const SizedBox(height: 2),
          if (tile.future != null)
            FutureBuilder<dynamic>(
              future: tile.future,
              builder: (context, snap) {
                final d = snap.data;
                if (d is Map && d['phase'] == 'active') return detail('dzień ${d['day']} z ${d['lengthDays']}');
                if (d is Map && d['phase'] == 'intermission') return detail('przerwa między sezonami');
                return detail('postęp, tytuły, wyniki');
              },
            )
          else
            detail(tile.detail ?? ''),
        ]),
      ),
    );
  }
}

/// Geologia: występowanie materiałów w okolicy silosu (miernik 3/2/1 + słowo, nie tylko kolor) i zapas.
class _Geology extends StatelessWidget {
  final AppState state;
  const _Geology({required this.state});

  static const _level = {'obfity': 3, 'sredni': 2, 'slady': 1};
  static const _hint = {
    'obfity': 'Główny materiał regionu: najwięcej ze zjazdów.',
    'sredni': 'Drugi w kolejności: przychodzi wolniej.',
    'slady': 'Prawie go tu nie ma: kup na Rynku albo u Handlarza.',
  };

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/geology'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final mats = asList(d['materials']);
        final wallet = (state.silo?['wallet'] as Map?) ?? const {};
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Materiały występują w złożach nierówno. To, czego brakuje w Twojej okolicy, kupisz na Rynku albo u Handlarza.', style: lsBody),
            ),
            for (final m in mats)
              LsCard(
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        ResourceIcon('${m['id']}', size: 28),
                        const SizedBox(width: 8),
                        Flexible(child: Text('${m['name']}', style: lsDisplay.copyWith(fontSize: 17))),
                      ]),
                      const SizedBox(height: 4),
                      Text(_hint[m['local']] ?? '', style: lsMuted),
                      const SizedBox(height: 6),
                      Text('w magazynie: ${fmtInt(asNum(wallet[m['id']]))}', style: const TextStyle(fontSize: 12, color: Ls.textFaint)),
                    ]),
                  ),
                  const SizedBox(width: 12),
                  Semantics(
                    label: 'występowanie: ${localNames[m['local']] ?? m['local']}',
                    excludeSemantics: true,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        for (var k = 1; k <= 3; k++)
                          Container(
                            width: 8,
                            height: 8.0 + k * 6,
                            margin: const EdgeInsets.only(left: 3),
                            decoration: BoxDecoration(
                              color: k <= (_level[m['local']] ?? 0) ? Ls.copper : null,
                              border: k <= (_level[m['local']] ?? 0) ? null : Border.all(color: Ls.locked),
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                      ]),
                      const SizedBox(height: 4),
                      Text(localNames[m['local']] ?? '${m['local']}', style: const TextStyle(fontSize: 12, color: Ls.text, fontWeight: FontWeight.w600)),
                    ]),
                  ),
                ]),
              ),
            const SizedBox(height: 4),
            Text('Materiały odblokowuje Radiostacja poz. ${d['exchangeRadio']}.', style: lsMuted),
          ],
        );
      },
    );
  }
}
