import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';

/// Postać: cechy i rozdawanie wolnych punktów.
class StatsScreen extends StatefulWidget {
  final AppState state;
  const StatsScreen({super.key, required this.state});
  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  final Map<String, int> _add = {for (final k in statNames.keys) k: 0};

  int get _spent => _add.values.fold(0, (a, b) => a + b);

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
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('${p['nickname']}  ·  poziom ${p['level']}', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text('Wolne punkty: $left'),
            const SizedBox(height: 8),
            for (final e in statNames.entries)
              Card(
                child: ListTile(
                  title: Text(e.value),
                  subtitle: Text(_hint(e.key)),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    IconButton(icon: const Icon(Icons.remove), onPressed: (_add[e.key]! > 0) ? () => setState(() => _add[e.key] = _add[e.key]! - 1) : null),
                    Text('${asNum(stats[e.key]).toInt()}${_add[e.key]! > 0 ? ' +${_add[e.key]}' : ''}', style: Theme.of(context).textTheme.titleMedium),
                    IconButton(icon: const Icon(Icons.add), onPressed: left > 0 ? () => setState(() => _add[e.key] = _add[e.key]! + 1) : null),
                  ]),
                ),
              ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: (_spent == 0 || widget.state.busy)
                  ? null
                  : () async {
                      final body = Map<String, int>.from(_add);
                      final ok = await widget.state.run(() async {
                        await widget.state.api.post('/players/stats', body: body);
                      });
                      if (ok) setState(() => _add.updateAll((_, __) => 0));
                    },
              child: const Text('Przydziel punkty'),
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
