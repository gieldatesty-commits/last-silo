import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';
import '../widgets.dart';

/// Laboratorium: drzewo badań i Kodeks Rdzeniowców.
class LabScreen extends StatelessWidget {
  final AppState state;
  const LabScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(children: [
        const TabBar(tabs: [Tab(text: 'Badania'), Tab(text: 'Kodeks')]),
        Expanded(child: TabBarView(children: [_Research(state: state), _Codex(state: state)])),
      ]),
    );
  }
}

class _Research extends StatelessWidget {
  final AppState state;
  const _Research({required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/research'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final techs = asList(d['techs']);
        final active = d['active'] == null ? null : asMap(d['active']);
        String nameOf(String id) => techs.firstWhere((t) => t['id'] == id, orElse: () => {'name': id})['name'] as String;
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Laboratorium poz. ${d['labLevel']}', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (active != null)
                InfoBanner(
                  icon: Icons.science,
                  child: Row(children: [
                    Flexible(child: Text('Badanie: ${nameOf(active['techId'] as String)}  ')),
                    Countdown(endsAt: parseTime(active['endsAt']), onDone: reload),
                  ]),
                ),
              for (final branch in ['gornictwo', 'inzynieria', 'rdzeniowcy']) ...[
                SectionTitle(branchNames[branch]!),
                for (final t in techs.where((t) => t['branch'] == branch))
                  _TechTile(t: t, nameOf: nameOf, anyActive: active != null, state: state, reload: reload),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _TechTile extends StatelessWidget {
  final Map<String, dynamic> t;
  final String Function(String) nameOf;
  final bool anyActive;
  final AppState state;
  final Future<void> Function() reload;
  const _TechTile({required this.t, required this.nameOf, required this.anyActive, required this.state, required this.reload});

  @override
  Widget build(BuildContext context) {
    final st = t['state'] as String;
    final missing = (t['missing'] as List).cast<String>();
    final effect = t['effect'] == null ? '' : effectText(t['effect'] as Map);
    final lines = <String>[
      if (effect.isNotEmpty) effect,
      if (st == 'done') 'Ukończone',
      if (st != 'done') '${costText(t)}  ·  ${fmtDuration(asNum(t['seconds']).toInt())}',
      if (st == 'locked')
        [
          'Laboratorium poz. ${t['labRequired']}',
          if (t['radioRequired'] != null) 'Radiostacja poz. ${t['radioRequired']}',
          if (missing.isNotEmpty) 'wymaga: ${missing.map(nameOf).join(', ')}',
        ].join(' · '),
    ];
    final icon = switch (st) {
      'done' => const Icon(Icons.check_circle, color: Colors.greenAccent),
      'active' => const Icon(Icons.science),
      'available' => const Icon(Icons.lock_open),
      _ => const Icon(Icons.lock_outline),
    };
    return Card(
      child: ListTile(
        leading: icon,
        title: Text(t['name'] as String),
        subtitle: Text(lines.join('\n')),
        isThreeLine: lines.length > 2,
        trailing: st == 'available'
            ? FilledButton.tonal(
                onPressed: (anyActive || state.busy)
                    ? null
                    : () => act(state, () => state.api.post('/research/${t['id']}/start', idempotent: true), reload, ctx: context, okText: 'Badanie rozpoczęte'),
                child: const Text('Badaj'),
              )
            : null,
      ),
    );
  }
}

class _Codex extends StatelessWidget {
  final AppState state;
  const _Codex({required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/codex'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final entries = asList(d['entries']);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Kodeks Rdzeniowców: ${d['unlocked']}/${d['total']}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final e in entries)
              Card(
                child: e['unlocked'] == true
                    ? ExpansionTile(
                        title: Text('${e['order']}. ${e['title']}'),
                        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        expandedCrossAxisAlignment: CrossAxisAlignment.start,
                        children: [Text(e['text'] as String)],
                      )
                    : ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text('${e['order']}. ???'),
                        subtitle: Text(e['hint'] as String),
                      ),
              ),
          ],
        );
      },
    );
  }
}
