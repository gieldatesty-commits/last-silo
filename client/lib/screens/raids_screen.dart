import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';
import '../widgets.dart';

/// Najazdy: cele (namierzone silosy w zasięgu) i historia. Wynik najazdu przychodzi po dojeździe.
/// Logika bez zmian: GET /raids/targets, GET /raids, POST /raids przez `act()` z Idempotency-Key i potwierdzeniem.
class RaidsScreen extends StatelessWidget {
  final AppState state;
  const RaidsScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () async {
        // /items tylko dla paska zestawu; błąd = pasek bez liczb
        final r = await Future.wait([state.api.get('/raids/targets'), state.api.get('/raids'), state.api.get('/items').catchError((_) => null)]);
        return {'targets': r[0], 'raids': r[1], 'items': r[2]};
      },
      builder: (context, data, reload) {
        final d = asMap(data);
        final targets = asList(d['targets']);
        final raids = asList(d['raids']);
        final active = raids.where((r) => r['result'] == null).toList();
        final done = raids.where((r) => r['result'] != null).toList();
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            children: [
              LsHeader(null, subtitle: 'Cele pojawiają się po namierzeniu sygnału w Radiu. Najazd kosztuje parę i trwa tyle, ile droga do celu.', trailing: LsStat('CELE', '${targets.length}', alignEnd: true)),
              if (d['items'] is Map) _LoadoutPanel(items: asMap(d['items']), state: state, reload: reload),
              if (active.isNotEmpty) ...[
                const SectionTitle('W drodze'),
                for (final r in active) _ActiveRaid(r: r, reload: reload),
              ],
              const SectionTitle('Cele'),
              if (targets.isEmpty) const EmptyNote('Brak celów w zasięgu. Namierz sygnały w Radiu.'),
              for (final t in targets) _TargetCard(t: t, state: state, reload: reload),
              const SectionTitle('Historia'),
              if (done.isEmpty) const EmptyNote('Brak najazdów.'),
              for (final r in done) _RaidResult(r: r),
            ],
          ),
        );
      },
    );
  }
}

/// Aktywny zestaw w najazdach: atak i obrona sprzętu, przełączenie przed wysłaniem (atak zapisuje się przy wysłaniu).
class _LoadoutPanel extends StatelessWidget {
  const _LoadoutPanel({required this.items, required this.state, required this.reload});
  final Map<String, dynamic> items;
  final AppState state;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final active = asNum(items['activeLoadout'] ?? 1).toInt() == 2 ? 2 : 1;
    final other = active == 1 ? 2 : 1;
    Map<String, dynamic> m(Object? v) => v is Map ? asMap(v) : <String, dynamic>{};
    final stats = m(items['loadoutStats']);
    final mine = m(stats['$active']);
    final theirs = m(stats['$other']);
    final silo = m(items['siloDefense']);
    return LsCard(
      border: Ls.warn.withValues(alpha: 0.4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Aktywny: zestaw ${loadoutName(active)}', style: lsDisplay.copyWith(fontSize: 16)),
        const SizedBox(height: 6),
        Text('atak sprzętu +${mine['attack'] ?? 0} · obrona silosu +${silo['$active'] ?? mine['defense'] ?? 0}', style: lsBody),
        Text('z zestawem ${loadoutName(other)}: atak +${theirs['attack'] ?? 0}, obrona silosu +${silo['$other'] ?? theirs['defense'] ?? 0}', style: lsMuted),
        const SizedBox(height: 6),
        const Text('Atakujesz zestawem z chwili wysłania. Obrona silosu liczy też część pancerza z drugiego zestawu.', style: TextStyle(fontSize: 11, height: 1.4, color: Ls.textMuted)),
        const SizedBox(height: 8),
        LsButton(
          'Przełącz na zestaw ${loadoutName(other)}',
          color: Ls.amber,
          onPressed: state.busy ? null : () => act(state, () => state.api.post('/loadouts/$other/activate', idempotent: true), reload, ctx: context, okText: 'Aktywny zestaw ${loadoutName(other)}'),
        ),
      ]),
    );
  }
}

/// Siła przeciwnika: znak i słowo (nie tylko kolor).
(String, Color) _strength(String? s) => switch (s) {
      'slabszy' => ('▼', Ls.teal),
      'silniejszy' => ('▲', Ls.warn),
      _ => ('≈', Ls.amber),
    };

class _TargetCard extends StatelessWidget {
  const _TargetCard({required this.t, required this.state, required this.reload});
  final Map<String, dynamic> t;
  final AppState state;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final can = t['canRaid'] == true;
    final blocked = t['blockedBy'] as String?;
    final (mark, color) = _strength(t['strength'] as String?);
    return LsCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${t['nickname']}', style: lsDisplay.copyWith(fontSize: 16))),
          Text('poz. ${t['level']}', style: lsMuted),
        ]),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          LsChip('$mark ${strengthNames[t['strength']] ?? t['strength']}', color: color),
          LsChip('kierunek ${t['sector']}'),
          LsChip('ok. ${fmtInt(asNum(t['distanceKm']))} km'),
          LsChip('dojazd ${t['travelMinutes']} min'),
        ]),
        if (!can && blocked != null) ...[
          const SizedBox(height: 8),
          Text(errorText(blocked), style: const TextStyle(fontSize: 12, color: Ls.warnText)),
        ],
        const SizedBox(height: 10),
        LsButton(
          can ? 'Najazd' : 'Najazd niedostępny',
          color: Ls.warn,
          onPressed: (!can || state.busy)
              ? null
              : () async {
                  final ok = await confirm(context, 'Najazd na ${t['nickname']}?', 'Koszt w parze zobaczysz po wysłaniu. Silniejszy cel to ryzyko porażki.', ok: 'Atakuj');
                  if (ok && context.mounted) {
                    await act(state, () => state.api.post('/raids', body: {'targetId': t['id']}, idempotent: true), reload, ctx: context, okText: 'Najazd wyruszył');
                  }
                },
        ),
      ]),
    );
  }
}

class _ActiveRaid extends StatelessWidget {
  const _ActiveRaid({required this.r, required this.reload});
  final Map<String, dynamic> r;
  final Future<void> Function() reload;
  @override
  Widget build(BuildContext context) {
    final attacker = r['role'] == 'attacker';
    return LsCard(
      border: (attacker ? Ls.amber : Ls.warn).withValues(alpha: 0.5),
      child: Row(children: [
        Icon(attacker ? Icons.directions_run : Icons.shield_outlined, color: attacker ? Ls.amber : Ls.warn),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(attacker ? 'Najazd na ${r['opponent']}' : 'Nadchodzi najazd: ${r['opponent']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
            Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
              const Text('dotrze za ', style: lsMuted),
              Countdown(endsAt: parseTime(r['endsAt']), onDone: reload, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: attacker ? Ls.amber : Ls.warn)),
            ]),
          ]),
        ),
      ]),
    );
  }
}

class _RaidResult extends StatelessWidget {
  const _RaidResult({required this.r});
  final Map<String, dynamic> r;
  @override
  Widget build(BuildContext context) {
    final attacker = r['role'] == 'attacker';
    final res = asMap(r['result']);
    final won = res['won'] == true;
    final ore = asNum(res['ore']).toInt();
    final tokens = asNum(res['tokens']).toInt();
    final c = won ? const Color(0xFF9CE0B5) : Ls.warnText;
    return LsCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(children: [
        Text(won ? '✓' : '✗', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: c)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${attacker ? 'Najazd na' : 'Obrona przed'} ${r['opponent']}: ${won ? 'wygrana' : 'porażka'}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
            Text('${ore >= 0 ? '+' : ''}${fmtInt(ore)} rudy${tokens != 0 ? ' · ${tokens > 0 ? '+' : ''}$tokens żet.' : ''}', style: TextStyle(fontSize: 12, color: ore > 0 ? const Color(0xFF9CE0B5) : (ore < 0 ? Ls.warnText : Ls.textMuted))),
          ]),
        ),
      ]),
    );
  }
}
