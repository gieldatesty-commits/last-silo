import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../widgets.dart';

/// Sezon: postęp, tytuły z poprzednich sezonów i wyniki ostatnio zamkniętego sezonu.
class SeasonScreen extends StatelessWidget {
  final AppState state;
  const SeasonScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () async {
        final r = await Future.wait([state.api.get('/season'), state.api.get('/season/results')]);
        return {'season': r[0], 'results': r[1]};
      },
      builder: (context, data, reload) {
        final d = asMap(data);
        final s = asMap(d['season']);
        final res = asMap(d['results']);
        final titles = asList(s['titles']);
        final inter = s['phase'] == 'intermission';
        final top = asList(res['top']);
        final me = res['me'] == null ? null : asMap(res['me']);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Sezon ${s['season']}', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            if (inter)
              InfoBanner(
                icon: Icons.hourglass_bottom,
                child: s['nextSeasonAt'] == null
                    ? const Text('Przerwa między sezonami. Akcje są zablokowane do startu następnego.')
                    : Row(children: [
                        const Flexible(child: Text('Przerwa. Następny sezon za ')),
                        Countdown(endsAt: parseTime(s['nextSeasonAt']), onDone: reload),
                      ]),
              )
            else ...[
              Text('Dzień ${s['day']} z ${s['lengthDays']}  ·  zostało ${s['daysLeft']} dni'),
              const SizedBox(height: 6),
              LinearProgressIndicator(value: (asNum(s['day']) / asNum(s['lengthDays'])).clamp(0.0, 1.0).toDouble()),
              const SizedBox(height: 6),
              Row(children: [const Text('Koniec za '), Countdown(endsAt: parseTime(s['endsAt']), onDone: reload)]),
            ],
            if (asNum(s['carryBonusOre']) > 0) ...[
              const SizedBox(height: 8),
              Text('Premia startowa za poprzedni sezon: ${fmtInt(asNum(s['carryBonusOre']))} rudy'),
            ],
            const SectionTitle('Twoje tytuły'),
            if (titles.isEmpty) const EmptyNote('Jeszcze żadnego. Tytuły dostają najlepsi z zamkniętych sezonów.'),
            for (final t in titles)
              ListTile(dense: true, leading: const Icon(Icons.military_tech_outlined), title: Text('${t['name']}'), subtitle: Text('sezon ${t['season']}, miejsce ${t['rank']} z ${t['of']}')),
            const SectionTitle('Ostatni zamknięty sezon'),
            if (res['season'] == null) const EmptyNote('Pierwszy sezon jeszcze trwa.'),
            if (res['season'] != null) ...[
              Text('Sezon ${res['season']}  ·  graczy: ${res['total']}', style: Theme.of(context).textTheme.bodySmall),
              for (final r in top) _ResultRow(r: r, mine: me != null && me['rank'] == r['rank']),
              if (me != null && !top.any((r) => r['rank'] == me['rank'])) ...[const Divider(), _ResultRow(r: me, mine: true)],
              if (me != null && me['startBonusOre'] != null) Text('Premia startowa: ${fmtInt(asNum(me['startBonusOre']))} rudy', style: Theme.of(context).textTheme.bodySmall),
            ],
          ],
        );
      },
    );
  }
}

class _ResultRow extends StatelessWidget {
  final Map<String, dynamic> r;
  final bool mine;
  const _ResultRow({required this.r, required this.mine});
  @override
  Widget build(BuildContext context) => ListTile(
        dense: true,
        tileColor: mine ? Theme.of(context).colorScheme.secondaryContainer : null,
        leading: Text('#${r['rank']}', style: Theme.of(context).textTheme.titleSmall),
        title: Text('${r['nickname']}${mine ? ' (Ty)' : ''}${r['title'] != null ? '  ·  ${r['title']}' : ''}'),
        subtitle: Text('poz. ${r['level']}  ·  siła ${fmtInt(asNum(r['power']))}  ·  łup ${fmtInt(asNum(r['loot']))}'),
      );
}
