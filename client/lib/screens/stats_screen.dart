import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';

/// Postać: cechy i rozdawanie wolnych punktów. Logika bez zmian: POST /players/stats przez `state.run`.
class StatsScreen extends StatefulWidget {
  final AppState state;
  const StatsScreen({super.key, required this.state});
  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  final Map<String, int> _add = {for (final k in statNames.keys) k: 0};

  int get _spent => _add.values.fold(0, (a, b) => a + b);

  static const _accent = {'sila': Ls.warn, 'technika': Ls.amber, 'percepcja': Ls.teal, 'wytrwalosc': Ls.violet};
  static const _icon = {'sila': Icons.fitness_center, 'technika': Icons.handyman_outlined, 'percepcja': Icons.visibility_outlined, 'wytrwalosc': Icons.shield_outlined};

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.state,
      builder: (context, _) {
        final s = widget.state.silo;
        if (s == null) return const Center(child: CircularProgressIndicator());
        final p = asMap(s['player']);
        final stats = asMap(p['stats']);
        final free = asNum(p['freePoints']).toInt();
        final left = free - _spent;
        final xp = asNum(p['xp']).toDouble();
        final next = p['xpToNext'] as num?;
        final arch = archetypeInfo[p['archetype']];
        var maxStat = 1;
        for (final k in statNames.keys) {
          final v = asNum(stats[k]).toInt() + _add[k]!;
          if (v > maxStat) maxStat = v;
        }
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
          children: [
            LsHeader('${p['nickname']}', subtitle: '${arch?.$1 ?? ''} · poziom ${p['level']}${arch == null ? '' : '\n${arch.$2}'}', trailing: LsStat('WOLNE PKT', '$left', alignEnd: true)),
            if (next != null) ...[
              LsMeter(next > 0 ? xp / next : 0),
              const SizedBox(height: 4),
              Text('XP ${fmtInt(xp)} / ${fmtInt(next)} do poziomu ${asNum(p['level']).toInt() + 1}', style: lsMuted),
              const SizedBox(height: 12),
            ],
            if (free == 0) const Padding(padding: EdgeInsets.only(bottom: 8), child: Text('Wolne punkty dostajesz za każdy nowy poziom.', style: lsMuted)),
            for (final e in statNames.entries)
              LsCard(
                child: Row(children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: _accent[e.key]!.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(12)),
                    child: Icon(_icon[e.key], color: _accent[e.key], size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(e.value, style: lsDisplay.copyWith(fontSize: 16)),
                      Text(_hint(e.key), style: lsMuted),
                      const SizedBox(height: 6),
                      ExcludeSemantics(child: LsMeter((asNum(stats[e.key]) + _add[e.key]!) / maxStat, color: _accent[e.key]!, height: 5)),
                    ]),
                  ),
                  const SizedBox(width: 6),
                  _Stepper(
                    name: e.value,
                    value: asNum(stats[e.key]).toInt(),
                    added: _add[e.key]!,
                    canAdd: left > 0,
                    onMinus: () => setState(() => _add[e.key] = _add[e.key]! - 1),
                    onPlus: () => setState(() => _add[e.key] = _add[e.key]! + 1),
                  ),
                ]),
              ),
            const SizedBox(height: 8),
            LsButton(
              _spent == 0 ? 'Przydziel punkty' : 'Przydziel punkty ($_spent)',
              color: Ls.amber,
              onPressed: (_spent == 0 || widget.state.busy)
                  ? null
                  : () async {
                      final body = Map<String, int>.from(_add);
                      final ok = await widget.state.run(() async {
                        await widget.state.api.post('/players/stats', body: body);
                      });
                      if (ok) setState(() => _add.updateAll((k, v) => 0));
                    },
            ),
          ],
        );
      },
    );
  }

  static String _hint(String k) => switch (k) {
        'sila' => 'Atak w najazdach.',
        'technika' => 'Najsilniej zwiększa szansę zjazdów.',
        'percepcja' => 'Szansa zjazdów i atak w najazdach.',
        'wytrwalosc' => 'Szansa zjazdów i obrona przed najazdami.',
        _ => '',
      };
}

/// − wartość + ; przyciski 48 dp z podpowiedzią dla czytnika ekranu.
class _Stepper extends StatelessWidget {
  const _Stepper({required this.name, required this.value, required this.added, required this.canAdd, required this.onMinus, required this.onPlus});
  final String name;
  final int value;
  final int added;
  final bool canAdd;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      IconButton(tooltip: 'Odejmij punkt: $name', onPressed: added > 0 ? onMinus : null, icon: const Icon(Icons.remove), color: Ls.text, disabledColor: Ls.locked),
      Column(mainAxisSize: MainAxisSize.min, children: [
        Text('${value + added}', style: lsDisplay.copyWith(fontSize: 18)),
        if (added > 0) Text('+$added', style: const TextStyle(fontSize: 11, color: Ls.amber, fontWeight: FontWeight.w600)),
      ]),
      IconButton(tooltip: 'Dodaj punkt: $name', onPressed: canAdd ? onPlus : null, icon: const Icon(Icons.add), color: Ls.amber, disabledColor: Ls.locked),
    ]);
  }
}
