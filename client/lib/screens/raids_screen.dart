import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';
import '../widgets.dart';

/// Najazdy: cele (namierzone silosy w zasięgu) i historia. Wynik najazdu przychodzi po dojeździe.
class RaidsScreen extends StatelessWidget {
  final AppState state;
  const RaidsScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () async {
        final r = await Future.wait([state.api.get('/raids/targets'), state.api.get('/raids')]);
        return {'targets': r[0], 'raids': r[1]};
      },
      builder: (context, data, reload) {
        final d = asMap(data);
        final targets = asList(d['targets']);
        final raids = asList(d['raids']);
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const SectionTitle('Cele'),
              const Text('Cele pojawiają się po namierzeniu sygnału w Radiu. Najazd kosztuje parę i trwa tyle, ile droga do celu.'),
              if (targets.isEmpty) const EmptyNote('Brak celów w zasięgu. Namierz sygnały w zakładce Radio.'),
              for (final t in targets) _TargetCard(t: t, state: state, reload: reload),
              const SectionTitle('Historia'),
              if (raids.isEmpty) const EmptyNote('Brak najazdów.'),
              for (final r in raids) _RaidTile(r: r, reload: reload),
            ],
          ),
        );
      },
    );
  }
}

class _TargetCard extends StatelessWidget {
  final Map<String, dynamic> t;
  final AppState state;
  final Future<void> Function() reload;
  const _TargetCard({required this.t, required this.state, required this.reload});

  @override
  Widget build(BuildContext context) {
    final can = t['canRaid'] == true;
    final blocked = t['blockedBy'] as String?;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${t['nickname']}  ·  poz. ${t['level']}', style: Theme.of(context).textTheme.titleSmall),
          Text('${strengthNames[t['strength']] ?? t['strength']}  ·  kierunek ${t['sector']}  ·  ok. ${fmtInt(asNum(t['distanceKm']))} km  ·  dojazd ${t['travelMinutes']} min'),
          if (!can && blocked != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(errorText(blocked), style: Theme.of(context).textTheme.bodySmall)),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: (!can || state.busy)
                  ? null
                  : () async {
                      final ok = await confirm(context, 'Najazd na ${t['nickname']}?', 'Koszt w parze zobaczysz po wysłaniu. Silniejszy cel to ryzyko porażki.', ok: 'Atakuj');
                      if (ok && context.mounted) {
                        await act(state, () => state.api.post('/raids', body: {'targetId': t['id']}, idempotent: true), reload, ctx: context, okText: 'Najazd wyruszył');
                      }
                    },
              child: const Text('Najazd'),
            ),
          ),
        ]),
      ),
    );
  }
}

class _RaidTile extends StatelessWidget {
  final Map<String, dynamic> r;
  final Future<void> Function() reload;
  const _RaidTile({required this.r, required this.reload});

  @override
  Widget build(BuildContext context) {
    final attacker = r['role'] == 'attacker';
    final res = r['result'] == null ? null : asMap(r['result']);
    final title = attacker ? 'Najazd na ${r['opponent']}' : 'Najazd od ${r['opponent']}';
    if (res == null) {
      return ListTile(
        dense: true,
        leading: const Icon(Icons.directions_run),
        title: Text(title),
        subtitle: Row(children: [const Text('W drodze, jeszcze '), Countdown(endsAt: parseTime(r['endsAt']), onDone: reload)]),
      );
    }
    final won = res['won'] == true;
    final ore = asNum(res['ore']).toInt();
    final tokens = asNum(res['tokens']).toInt();
    return ListTile(
      dense: true,
      leading: Icon(won ? Icons.emoji_events_outlined : Icons.shield_outlined, color: won ? Colors.greenAccent : Colors.redAccent),
      title: Text('$title: ${won ? 'wygrana' : 'porażka'}'),
      subtitle: Text('${ore >= 0 ? '+' : ''}${fmtInt(ore)} rudy${tokens != 0 ? '  ·  ${tokens > 0 ? '+' : ''}$tokens żet.' : ''}'),
    );
  }
}
