import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';
import '../widgets.dart';

/// Warsztat: wyposażenie (zakładanie, naprawa, wzmocnienie) i receptury.
class WorkshopScreen extends StatelessWidget {
  final AppState state;
  const WorkshopScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/items'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final items = asList(d['items']);
        final recipes = asList(d['recipes']);
        final q = asMap(d['quality']);
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Warsztat poz. ${d['workshopLevel']}  ·  ekwipunek ${items.length}/${d['inventoryMax']}', style: Theme.of(context).textTheme.titleMedium),
              Text('Jakość nowych przedmiotów: ${q['min']}–${q['max']}', style: Theme.of(context).textTheme.bodySmall),
              const SectionTitle('Ekwipunek'),
              if (items.isEmpty) const EmptyNote('Nic jeszcze nie wytworzyłeś.'),
              for (final it in items) _ItemCard(it: it, state: state, reload: reload),
              const SectionTitle('Receptury'),
              for (final r in recipes) _RecipeTile(r: r, state: state, reload: reload),
            ],
          ),
        );
      },
    );
  }
}

class _ItemCard extends StatelessWidget {
  final Map<String, dynamic> it;
  final AppState state;
  final Future<void> Function() reload;
  const _ItemCard({required this.it, required this.state, required this.reload});

  @override
  Widget build(BuildContext context) {
    final id = it['id'] as String;
    final equipped = it['equipped'] == true;
    final broken = it['broken'] == true;
    final dur = asNum(it['durability']).toDouble();
    final maxDur = asNum(it['maxDurability']).toDouble();
    final next = it['nextUpgrade'] == null ? null : asMap(it['nextUpgrade']);
    final repair = asNum(it['repairCost']).toInt();
    final busy = state.busy;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${it['name']}${equipped ? '  ·  założony' : ''}', style: Theme.of(context).textTheme.titleSmall)),
            Text(slotNames[it['slot']] ?? '${it['slot']}', style: Theme.of(context).textTheme.labelSmall),
          ]),
          const SizedBox(height: 4),
          Text('Bonus +${it['bonus']}  ·  jakość ${it['quality']}  ·  wzmocnienie ${it['tier']}/${it['maxTier']}'),
          const SizedBox(height: 6),
          LinearProgressIndicator(value: maxDur > 0 ? (dur / maxDur).clamp(0.0, 1.0) : 0, color: broken ? Colors.redAccent : null),
          Text(broken ? 'Zepsuty' : 'Wytrzymałość ${dur.toInt()}/${maxDur.toInt()}', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 4, children: [
            FilledButton.tonal(
              onPressed: busy || (broken && !equipped)
                  ? null
                  : () => act(state, () => state.api.post('/items/$id/${equipped ? 'unequip' : 'equip'}', idempotent: true), reload),
              child: Text(equipped ? 'Zdejmij' : 'Załóż'),
            ),
            if (repair > 0)
              OutlinedButton(
                onPressed: busy ? null : () => act(state, () => state.api.post('/items/$id/repair', idempotent: true), reload, ctx: context, okText: 'Naprawiono'),
                child: Text('Napraw (${fmtInt(repair)} rudy)'),
              ),
            if (next != null)
              OutlinedButton(
                onPressed: busy
                    ? null
                    : () async {
                        final ok = await confirm(context, 'Wzmocnić przedmiot?', 'Koszt: ${costText(next)}.\nWymaga Warsztatu poz. ${next['workshop']} i Radiostacji poz. ${next['radio']}.', ok: 'Wzmocnij');
                        if (ok && context.mounted) {
                          await act(state, () => state.api.post('/items/$id/upgrade', idempotent: true), reload, ctx: context, okText: 'Wzmocniono');
                        }
                      },
                child: const Text('Wzmocnij'),
              ),
          ]),
        ]),
      ),
    );
  }
}

class _RecipeTile extends StatelessWidget {
  final Map<String, dynamic> r;
  final AppState state;
  final Future<void> Function() reload;
  const _RecipeTile({required this.r, required this.state, required this.reload});

  @override
  Widget build(BuildContext context) {
    final locked = r['locked'] == true;
    final why = <String>[
      if (r['needsTech'] != null) 'wymaga badania',
      'Warsztat poz. ${r['workshop']}',
      if (r['radio'] != null) 'Radiostacja poz. ${r['radio']}',
    ];
    return Card(
      child: ListTile(
        enabled: !locked,
        title: Text('${r['name']}  ·  ${slotNames[r['slot']] ?? r['slot']}'),
        subtitle: Text('Bonus +${r['bonus']}  ·  wytrzymałość ${r['durability']}\n${costText(r)}${locked ? '\n🔒 ${why.join(', ')}' : ''}'),
        isThreeLine: true,
        trailing: FilledButton.tonal(
          onPressed: (locked || state.busy)
              ? null
              : () => act(state, () => state.api.post('/items/craft', body: {'recipeId': r['id']}, idempotent: true), reload, ctx: context, okText: 'Wytworzono: ${r['name']}'),
          child: const Text('Wytwórz'),
        ),
      ),
    );
  }
}
