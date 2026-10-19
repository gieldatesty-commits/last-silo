import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';

/// Silos: postać, zasoby, trwająca budowa i lista budynków z ulepszeniami.
class SiloScreen extends StatelessWidget {
  final AppState state;
  const SiloScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final s = state.silo;
        if (s == null) return const Center(child: CircularProgressIndicator());
        final player = s['player'] as Map;
        final wallet = s['wallet'] as Map;
        final caps = s['caps'] as Map;
        final rates = s['rates'] as Map;
        final job = s['job'] as Map?;
        final buildings = (s['buildings'] as List).cast<Map>();
        final ore = (wallet['ore'] as num).toInt();

        return RefreshIndicator(
          onRefresh: state.refresh,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _PlayerCard(player: player),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                _Stat('Ruda', '${fmtInt(ore)} / ${fmtInt(caps['ore'] as num)}', '+${rates['orePerHour']}/h'),
                _Stat('Para', '${fmtInt(wallet['steam'] as num)} / ${fmtInt(caps['steam'] as num)}', '+${rates['steamPerMin']}/min'),
                _Stat('Żetony', fmtInt(wallet['tokens'] as num)),
                _Stat('Próbki', fmtInt(wallet['samples'] as num)),
                for (final m in ['miedz', 'krysztal', 'siarka'])
                  if (wallet[m] != null && (wallet[m] as num) > 0) _Stat(resourceNames[m]!, fmtInt(wallet[m] as num)),
              ]),
              if (s['windedUntil'] != null) ...[
                const SizedBox(height: 12),
                _Banner(icon: Icons.air, child: Row(children: [
                  const Text('Wyczerpany, odpoczywasz jeszcze '),
                  Countdown(endsAt: parseTime(s['windedUntil']), onDone: state.refresh),
                ])),
              ],
              if (s['protectedUntil'] != null) ...[
                const SizedBox(height: 12),
                _Banner(icon: Icons.shield_outlined, child: Row(children: [
                  const Text('Ochrona przed najazdami: '),
                  Countdown(endsAt: parseTime(s['protectedUntil']), onDone: state.refresh),
                ])),
              ],
              if (job != null) ...[
                const SizedBox(height: 12),
                _Banner(icon: Icons.construction, child: Row(children: [
                  Flexible(child: Text('Budowa: ${_buildingName(buildings, job['type'] as String)} → poz. ${job['toLevel']}  ')),
                  Countdown(endsAt: parseTime(job['endsAt']), onDone: state.refresh),
                ])),
              ],
              const SizedBox(height: 16),
              Text('Budynki', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              for (final b in buildings) _BuildingTile(b: b, ore: ore, state: state, building: job != null),
            ],
          ),
        );
      },
    );
  }

  static String _buildingName(List<Map> bs, String type) =>
      (bs.firstWhere((b) => b['type'] == type, orElse: () => {'name': type})['name'] as String);
}

class _PlayerCard extends StatelessWidget {
  final Map player;
  const _PlayerCard({required this.player});
  @override
  Widget build(BuildContext context) {
    final xp = (player['xp'] as num).toDouble();
    final next = player['xpToNext'] as num?;
    final arch = archetypeInfo[player['archetype']]?.$1 ?? '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${player['nickname']}  ·  $arch', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text('Poziom ${player['level']}'),
          if (next != null) ...[
            const SizedBox(height: 8),
            LinearProgressIndicator(value: next > 0 ? (xp / next).clamp(0.0, 1.0) : 0),
            const SizedBox(height: 4),
            Text('XP ${fmtInt(xp)} / ${fmtInt(next)}', style: Theme.of(context).textTheme.bodySmall),
          ],
          if ((player['freePoints'] as num) > 0) ...[
            const SizedBox(height: 8),
            Text('Wolne punkty cech: ${player['freePoints']}', style: TextStyle(color: Theme.of(context).colorScheme.primary)),
          ],
        ]),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  const _Stat(this.label, this.value, [this.sub]);
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          Text(value, style: Theme.of(context).textTheme.titleSmall),
          if (sub != null) Text(sub!, style: Theme.of(context).textTheme.labelSmall),
        ]),
      );
}

class _Banner extends StatelessWidget {
  final IconData icon;
  final Widget child;
  const _Banner({required this.icon, required this.child});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(children: [Icon(icon), const SizedBox(width: 12), Expanded(child: child)]),
      );
}

class _BuildingTile extends StatelessWidget {
  final Map b;
  final int ore;
  final AppState state;
  final bool building;
  const _BuildingTile({required this.b, required this.ore, required this.state, required this.building});

  @override
  Widget build(BuildContext context) {
    final next = b['next'] as Map?;
    final cost = (next?['cost'] as num?)?.toInt();
    final canAfford = cost != null && ore >= cost;
    return Card(
      child: ListTile(
        title: Text('${b['name']}  ·  poz. ${b['level']}/${b['maxLevel']}'),
        subtitle: next == null
            ? const Text('Maksymalny poziom')
            : Text('Poz. ${next['level']}: ${fmtInt(cost!)} rudy, ${fmtDuration((next['seconds'] as num).toInt())}'),
        trailing: next == null
            ? null
            : FilledButton.tonal(
                onPressed: (state.busy || building || !canAfford) ? null : () => state.upgrade(b['type'] as String),
                child: const Text('Ulepsz'),
              ),
      ),
    );
  }
}
