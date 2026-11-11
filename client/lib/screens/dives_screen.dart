import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';

/// Zjazdy: kolejka w toku, lista tras do wyboru i ostatnie wyniki.
class DivesScreen extends StatelessWidget {
  final AppState state;
  const DivesScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final s = state.silo;
        if (s == null) return const Center(child: CircularProgressIndicator());
        final wallet = s['wallet'] as Map;
        final steam = (wallet['steam'] as num).toInt();
        final queue = (s['queue'] as List).cast<Map>();
        final slots = (s['queueSlots'] as num).toInt();
        final winded = s['windedUntil'] != null;
        final full = queue.length >= slots;
        String routeName(String id) => state.routes.firstWhere((r) => r['id'] == id, orElse: () => {'name': id})['name'] as String;

        return RefreshIndicator(
          onRefresh: state.refresh,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Para: ${fmtInt(steam)}   ·   kolejka: ${queue.length}/$slots', style: Theme.of(context).textTheme.titleMedium),
              if (winded) ...[
                const SizedBox(height: 8),
                Row(children: [
                  const Icon(Icons.air, size: 18),
                  const SizedBox(width: 8),
                  const Text('Wyczerpany jeszcze '),
                  Countdown(endsAt: parseTime(s['windedUntil']), onDone: state.refresh),
                ]),
              ],
              if (queue.isNotEmpty) ...[
                const SizedBox(height: 12),
                for (final q in queue)
                  Card(
                    child: ListTile(
                      leading: Icon(q['running'] == true ? Icons.arrow_downward : Icons.hourglass_empty),
                      title: Text(routeName(q['routeId'] as String)),
                      subtitle: q['running'] == true ? const Text('W drodze') : const Text('Czeka w kolejce'),
                      trailing: Countdown(endsAt: parseTime(q['endsAt']), onDone: state.refresh),
                    ),
                  ),
              ],
              const SizedBox(height: 16),
              Text('Trasy', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              for (final r in state.routes)
                _RouteCard(r: r, steam: steam, blocked: full || winded, state: state),
              if (state.history.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('Ostatnie zjazdy', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                for (final h in state.history) _HistoryTile(h: h, name: routeName(h['routeId'] as String)),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _RouteCard extends StatelessWidget {
  final Map r;
  final int steam;
  final bool blocked;
  final AppState state;
  const _RouteCard({required this.r, required this.steam, required this.blocked, required this.state});

  @override
  Widget build(BuildContext context) {
    final locked = r['locked'] == true;
    final cost = (r['steam'] as num).toInt();
    final ore = (r['ore'] as List).cast<num>();
    final enough = steam >= cost;
    final extras = <String>[
      if ((r['tokens'] as num) > 0) 'żetony',
      if ((r['samples'] as num) > 0) 'próbki',
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(r['name'] as String, style: Theme.of(context).textTheme.titleSmall)),
            Text(zoneNames[r['zone']] ?? '${r['zone']}', style: Theme.of(context).textTheme.labelSmall),
          ]),
          const SizedBox(height: 4),
          Text('Szansa ${r['chancePct']}%  ·  ${fmtInt(ore[0])}–${fmtInt(ore[1])} rudy  ·  ${r['xp']} XP'
              '${extras.isEmpty ? '' : '  ·  ${extras.join(', ')}'}'),
          Text('Czas ${fmtDuration((r['seconds'] as num).toInt())}  ·  $cost pary  ·  ${richnessNames[r['zoneRichness']] ?? ''}',
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: locked
                ? Text('Od poziomu ${r['minLevel']}', style: Theme.of(context).textTheme.labelMedium)
                : FilledButton(
                    onPressed: (state.busy || blocked || !enough) ? null : () => state.startDive(r['id'] as String),
                    child: Text(enough ? 'Zjedź' : 'Brak pary'),
                  ),
          ),
        ]),
      ),
    );
  }
}

class _HistoryTile extends StatelessWidget {
  final Map h;
  final String name;
  const _HistoryTile({required this.h, required this.name});

  @override
  Widget build(BuildContext context) {
    final res = h['result'] as Map?;
    if (res == null) return const SizedBox.shrink();
    final ok = res['success'] == true;
    final mats = (res['materials'] as Map?) ?? const {};
    final parts = <String>[
      '${ok ? '+' : ''}${fmtInt(res['ore'] as num)} rudy',
      if ((res['tokens'] as num) > 0) '${res['tokens']} żet.',
      if ((res['samples'] as num) > 0) '${res['samples']} prób.',
      for (final e in mats.entries) '${e.value} ${resourceNames[e.key] ?? e.key}',
      '${res['xp']} XP',
    ];
    return ListTile(
      dense: true,
      leading: Icon(ok ? Icons.check_circle_outline : Icons.cancel_outlined, color: ok ? Colors.greenAccent : Colors.redAccent),
      title: Text('$name${res['levelUp'] == true ? '  ·  awans! poz. ${res['level']}' : ''}'),
      subtitle: Text(parts.join('  ·  ')),
    );
  }
}
