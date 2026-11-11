import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';
import '../widgets.dart';

/// Zlecenia karawanowe NPC: wspólna dzienna tablica. Każde zlecenie bierze jeden gracz; nagroda po dotarciu.
/// Logika bez zmian: GET /contracts, POST /contracts/{day}/{slot}/accept z ubezpieczeniem przez `act()`.
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
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            children: [
              LsHeader(null, subtitle: 'Tablica jest wspólna dla wszystkich i odnawia się o północy UTC. Kto pierwszy, ten lepszy.', trailing: LsStat('W DRODZE', '${d['active']} / ${d['maxActive']}', alignEnd: true)),
              const SectionTitle('Dzisiejsze oferty'),
              if (offers.isEmpty) const EmptyNote('Brak ofert na dziś.'),
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
  const _OfferCard({required this.o, required this.day, required this.state, required this.reload});
  final Map<String, dynamic> o;
  final int day;
  final AppState state;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final status = o['status'] as String;
    final qty = asNum(o['qty']).toInt();
    final unit = asNum(o['unitReward']).toDouble();
    final mat = o['material'] as String;
    final have = asNum(((state.silo?['wallet'] as Map?) ?? const {})[mat]).toInt();
    final enough = have >= qty;
    final mine = status == 'mine';
    return Opacity(
      opacity: status == 'taken' ? 0.55 : 1,
      child: LsCard(
        border: mine ? Ls.amber.withValues(alpha: 0.6) : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${o['name']}', style: lsDisplay.copyWith(fontSize: 16))),
            Text('kierunek ${o['sector']}', style: lsMuted),
          ]),
          const SizedBox(height: 6),
          Text('Dostarcz $qty × ${resName(mat)}', style: lsBody),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            LsChip('w magazynie: ${fmtInt(have)}', ok: enough || status != 'open'),
            LsChip('${fmtInt(asNum(o['km']))} km'),
            LsChip(fmtDuration(asNum(o['minutes']).toInt() * 60)),
            LsChip('zasadzka ${o['ambushChance']}%', color: asNum(o['ambushChance']) >= 7 ? Ls.warn : null),
          ]),
          const SizedBox(height: 10),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('NAGRODA', style: TextStyle(fontSize: 10, letterSpacing: 1.2, color: Ls.textFaint)),
                Text('${fmtInt(asNum(o['totalReward']))} rudy', style: lsDisplay.copyWith(fontSize: 18, color: Ls.amber)),
                Text('${unit.toStringAsFixed(0)} rudy za sztukę', style: const TextStyle(fontSize: 11, color: Ls.textFaint)),
              ]),
            ),
          ]),
          const SizedBox(height: 10),
          switch (status) {
            'open' => LsButton(
                enough ? 'Przyjmij zlecenie' : 'Brak ładunku (${fmtInt(have)} z $qty)',
                color: Ls.amber,
                onPressed: (state.busy || !enough)
                    ? null
                    : () async {
                        final insure = await askInsure(
                          context,
                          title: 'Przyjąć zlecenie?',
                          hint: 'Ładunek ($qty × ${resName(mat)}) zejdzie z magazynu od razu. W zasadzce nagroda spada proporcjonalnie do strat.',
                        );
                        if (insure == null || !context.mounted) return;
                        await act(state, () => state.api.post('/contracts/$day/${o['slot']}/accept', body: {'insure': insure}, idempotent: true), reload, ctx: context, okText: 'Zlecenie przyjęte');
                      },
              ),
            'mine' => const LsChip('✓ Twoje zlecenie', color: Ls.amber),
            _ => const LsChip('zajęte przez innego gracza'),
          },
        ]),
      ),
    );
  }
}

class _ContractTile extends StatelessWidget {
  const _ContractTile({required this.c, required this.reload});
  final Map<String, dynamic> c;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final st = c['state'] as String;
    final qty = asNum(c['qty']).toInt();
    final title = '${resName(c['material'] as String)} × $qty · ${fmtInt(asNum(c['distanceKm']))} km ${c['sector']}';
    final insured = c['insured'] == true;
    if (st == 'transit') {
      return LsCard(
        border: Ls.amber.withValues(alpha: 0.4),
        child: Row(children: [
          const Icon(Icons.local_shipping_outlined, color: Ls.amber),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
              Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
                Text('w drodze${insured ? ' · ubezpieczone' : ''} · dotrze za ', style: lsMuted),
                Countdown(endsAt: parseTime(c['arrivesAt']), onDone: reload, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Ls.amber)),
              ]),
            ]),
          ),
        ]),
      );
    }
    final lost = st == 'ambushed';
    return LsCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(children: [
        Text(lost ? '!' : '✓', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: lost ? Ls.warnText : const Color(0xFF9CE0B5))),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
            Text('${lost ? 'Zasadzka: dostarczono ${c['deliveredQty']} z $qty szt.' : 'Dostarczono'} · nagroda ${fmtInt(asNum(c['reward'] ?? 0))} rudy', style: lsMuted),
          ]),
        ),
      ]),
    );
  }
}
