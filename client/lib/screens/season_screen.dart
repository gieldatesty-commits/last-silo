import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../ui.dart';
import '../widgets.dart';

/// Sezon: postęp, tytuły z poprzednich sezonów i wyniki ostatnio zamkniętego sezonu. Dane: /season, /season/results.
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
        final day = asNum(s['day']), len = asNum(s['lengthDays']);
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
          children: [
            LsHeader('Sezon ${s['season']}', subtitle: inter ? 'Przerwa między sezonami' : 'Trwa · ${s['daysLeft']} dni do końca', trailing: LsChip(inter ? 'przerwa' : 'aktywny', color: inter ? Ls.amber : Ls.teal)),
            LsCard(
              padding: const EdgeInsets.all(14),
              child: inter
                  ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('Akcje gry są zablokowane do startu następnego sezonu. Świat zostanie zresetowany, konta i tytuły zostają.', style: lsBody),
                      if (s['nextSeasonAt'] != null) ...[
                        const SizedBox(height: 10),
                        Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
                          const Text('Następny sezon za ', style: lsMuted),
                          Countdown(endsAt: parseTime(s['nextSeasonAt']), onDone: reload, style: lsDisplay.copyWith(fontSize: 16, color: Ls.amber)),
                        ]),
                      ],
                    ])
                  : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      // jeden akapit: zawija się przy dużej czcionce, a cyfra stoi na wspólnej linii pisma
                      Text.rich(TextSpan(children: [
                        TextSpan(text: 'dzień ', style: lsMuted.copyWith(fontSize: 14)),
                        TextSpan(text: '${s['day']}', style: lsDisplay.copyWith(fontSize: 34, color: Ls.teal)),
                        TextSpan(text: ' z ${s['lengthDays']}', style: lsMuted.copyWith(fontSize: 14)),
                      ])),
                      const SizedBox(height: 8),
                      LsMeter(len > 0 ? day / len : 0, color: Ls.teal, height: 8),
                      const SizedBox(height: 10),
                      Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
                        const Text('Koniec za ', style: lsMuted),
                        Countdown(endsAt: parseTime(s['endsAt']), onDone: reload, style: const TextStyle(fontSize: 13, color: Ls.text, fontWeight: FontWeight.w600)),
                      ]),
                      const SizedBox(height: 4),
                      const Text('Po końcu: ranking siły, tytuły i premia startowa na kolejny sezon.', style: lsMuted),
                    ]),
            ),
            if (asNum(s['carryBonusOre']) > 0)
              LsCard(
                border: Ls.amber.withValues(alpha: 0.5),
                child: Row(children: [
                  const Icon(Icons.redeem_outlined, color: Ls.amber),
                  const SizedBox(width: 12),
                  Expanded(child: Text('Premia startowa za poprzedni sezon: ${fmtInt(asNum(s['carryBonusOre']))} rudy', style: lsBody)),
                ]),
              ),
            const SectionTitle('Twoje tytuły'),
            if (titles.isEmpty) const EmptyNote('Jeszcze żadnego. Tytuły dostają najlepsi z zamkniętych sezonów.'),
            if (titles.isNotEmpty)
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final t in titles)
                  Container(
                    padding: const EdgeInsets.fromLTRB(10, 8, 12, 8),
                    decoration: BoxDecoration(color: Ls.card, border: Border.all(color: Ls.amber.withValues(alpha: 0.5)), borderRadius: BorderRadius.circular(12)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.military_tech_outlined, color: Ls.amber, size: 22),
                      const SizedBox(width: 8),
                      Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                        Text('${t['name']}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Ls.text)),
                        Text('sezon ${t['season']} · miejsce ${t['rank']} z ${t['of']}', style: const TextStyle(fontSize: 11, color: Ls.textMuted)),
                      ]),
                    ]),
                  ),
              ]),
            const SectionTitle('Ostatni zamknięty sezon'),
            if (res['season'] == null) const EmptyNote('Pierwszy sezon jeszcze trwa.'),
            if (res['season'] != null) ...[
              Text('Sezon ${res['season']} · graczy: ${res['total']}', style: lsMuted),
              const SizedBox(height: 8),
              for (final r in top) _ResultRow(r: r, mine: me != null && me['rank'] == r['rank']),
              if (me != null && !top.any((r) => r['rank'] == me['rank'])) ...[const Divider(color: Ls.border), _ResultRow(r: me, mine: true)],
              if (me != null && me['startBonusOre'] != null && asNum(me['startBonusOre']) > 0) Text('Premia startowa: ${fmtInt(asNum(me['startBonusOre']))} rudy', style: lsMuted),
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
  Widget build(BuildContext context) {
    final rank = asNum(r['rank']).toInt();
    final medal = switch (rank) { 1 => Ls.amber, 2 => const Color(0xFFC9D0DC), 3 => Ls.copper, _ => Ls.locked };
    return LsCard(
      color: mine ? const Color(0xFF1A2230) : Ls.card,
      border: mine ? Ls.teal.withValues(alpha: 0.6) : null,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(children: [
        Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: medal, width: 2)),
          child: Text('$rank', style: lsDisplay.copyWith(fontSize: 13, color: rank <= 3 ? medal : Ls.textMuted)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['nickname']}${mine ? ' (Ty)' : ''}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
            Text(['poz. ${r['level']}', 'siła ${fmtInt(asNum(r['power']))}', 'łup ${fmtInt(asNum(r['loot']))}', if (r['title'] != null) '${r['title']}'].join(' · '), style: lsMuted),
          ]),
        ),
      ]),
    );
  }
}
