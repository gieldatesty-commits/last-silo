import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';
import '../widgets.dart';

/// Zlecenia karawanowe NPC: wspólna dzienna tablica. Każde zlecenie bierze jeden gracz; nagroda po dotarciu.
class ContractsScreen extends StatelessWidget {
  final AppState state;
  const ContractsScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/contracts'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final offers = asList(d['offers']);
        final contracts = asList(d['contracts']);
        final day = asNum(d['day']).toInt();
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Zlecenia w drodze: ${d['active']}/${d['maxActive']}', style: Theme.of(context).textTheme.titleMedium),
              const Text('Tablica jest wspólna dla wszystkich i odnawia się o północy UTC. Kto pierwszy, ten lepszy.'),
              const SectionTitle('Dzisiejsze oferty'),
              for (final o in offers) _OfferCard(o: o, day: day, state: state, reload: reload),
              const SectionTitle('Twoje zlecenia'),
              if (contracts.isEmpty) const EmptyNote('Nie przyjąłeś jeszcze żadnego zlecenia.'),
              for (final c in contracts) _ContractTile(c: c, reload: reload),
            ],
          ),
        );
      },
    );
  }
}

class _OfferCard extends StatelessWidget {
  final Map<String, dynamic> o;
  final int day;
  final AppState state;
  final Future<void> Function() reload;
  const _OfferCard({required this.o, required this.day, required this.state, required this.reload});

  @override
  Widget build(BuildContext context) {
    final status = o['status'] as String;
    final qty = asNum(o['qty']).toInt();
    final unit = asNum(o['unitReward']).toDouble();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${o['name']}  ·  kierunek ${o['sector']}', style: Theme.of(context).textTheme.titleSmall),
          Text('Dostarcz $qty × ${resName(o['material'] as String)}  ·  ${fmtInt(asNum(o['km']))} km, ${fmtDuration(asNum(o['minutes']).toInt() * 60)}'),
          Text('Nagroda ${fmtInt(asNum(o['totalReward']))} rudy (${unit.toStringAsFixed(1)}/szt.)  ·  zasadzka ${o['ambushChance']}%'),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: switch (status) {
              'open' => FilledButton(
                  onPressed: state.busy
                      ? null
                      : () async {
                          final insure = await askInsure(
                            context,
                            title: 'Przyjąć zlecenie?',
                            hint: 'Ładunek ($qty × ${resName(o['material'] as String)}) zejdzie z magazynu od razu. W zasadzce nagroda spada proporcjonalnie do strat.',
                          );
                          if (insure == null || !context.mounted) return;
                          await act(
                            state,
                            () => state.api.post('/contracts/$day/${o['slot']}/accept', body: {'insure': insure}, idempotent: true),
                            reload,
                            ctx: context,
                            okText: 'Zlecenie przyjęte',
                          );
                        },
                  child: const Text('Przyjmij'),
                ),
              'mine' => const Text('Twoje'),
              _ => const Text('Zajęte'),
            },
          ),
        ]),
      ),
    );
  }
}

class _ContractTile extends StatelessWidget {
  final Map<String, dynamic> c;
  final Future<void> Function() reload;
  const _ContractTile({required this.c, required this.reload});

  @override
  Widget build(BuildContext context) {
    final st = c['state'] as String;
    final qty = asNum(c['qty']).toInt();
    final title = '${resName(c['material'] as String)} × $qty  ·  ${fmtInt(asNum(c['distanceKm']))} km ${c['sector']}${c['insured'] == true ? '  ·  ubezpieczone' : ''}';
    if (st == 'transit') {
      return ListTile(
        leading: const Icon(Icons.local_shipping_outlined),
        title: Text(title),
        subtitle: Row(children: [const Text('Dotrze za '), Countdown(endsAt: parseTime(c['arrivesAt']), onDone: reload)]),
      );
    }
    final lost = st == 'ambushed';
    return ListTile(
      leading: Icon(lost ? Icons.warning_amber : Icons.check_circle_outline, color: lost ? Colors.orangeAccent : Colors.greenAccent),
      title: Text(title),
      subtitle: Text('${lost ? 'Zasadzka: dostarczono ${c['deliveredQty']} z $qty szt.' : 'Dostarczono'}  ·  nagroda ${fmtInt(asNum(c['reward'] ?? 0))} rudy'),
    );
  }
}
