import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../strings.dart';
import '../widgets.dart';

/// Rynek materiałów: oferty graczy, własne oferty, Handlarz NPC i karawany w drodze.
/// Zakup z rynku to fizyczna dostawa: czas, opłata przewozowa i ryzyko zasadzki rosną z dystansem.
class MarketScreen extends StatelessWidget {
  final AppState state;
  const MarketScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Column(children: [
        const TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [Tab(text: 'Oferty'), Tab(text: 'Moje'), Tab(text: 'Handlarz'), Tab(text: 'Karawany')]),
        Expanded(
          child: TabBarView(children: [
            _Listings(state: state),
            _Mine(state: state),
            _Npc(state: state),
            _Caravans(state: state),
          ]),
        ),
      ]),
    );
  }
}

class _Listings extends StatefulWidget {
  final AppState state;
  const _Listings({required this.state});
  @override
  State<_Listings> createState() => _ListingsState();
}

class _ListingsState extends State<_Listings> {
  String? _material;

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    return Loader(
      key: ValueKey(_material),
      load: () async {
        final r = await Future.wait([
          state.api.get('/market'),
          state.api.get(_material == null ? '/market/listings' : '/market/listings?material=$_material'),
        ]);
        return {'overview': r[0], 'listings': r[1]};
      },
      builder: (context, data, reload) {
        final d = asMap(data);
        final ov = asMap(d['overview']);
        final mats = asList(ov['materials']);
        final listings = asList(asMap(d['listings'])['listings']);
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _PriceTable(mats: mats),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                ChoiceChip(label: const Text('Wszystko'), selected: _material == null, onSelected: (_) => setState(() => _material = null)),
                for (final m in materialIds) ChoiceChip(label: Text(resName(m)), selected: _material == m, onSelected: (_) => setState(() => _material = m)),
              ]),
              const SectionTitle('Oferty graczy'),
              Text('Cena na liście plus przewóz. Ostateczny koszt widać w oknie zakupu.', style: Theme.of(context).textTheme.bodySmall),
              if (listings.isEmpty) const EmptyNote('Brak ofert.'),
              for (final l in listings) _ListingCard(l: l, state: state, reload: reload),
            ],
          ),
        );
      },
    );
  }
}

class _PriceTable extends StatelessWidget {
  final List<Map<String, dynamic>> mats;
  const _PriceTable({required this.mats});
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Ceny (ruda za sztukę)', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            for (final m in mats)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  '${m['name']}: Handlarz ${m['npcPrice']}  ·  skup botów ${m['botBid']}  ·  '
                  '${m['avg7d'] != null ? 'śr. 7 dni ${m['avg7d']}' : 'brak transakcji'}  ·  '
                  '${m['bestAsk'] != null ? 'najtaniej ${m['bestAsk']}' : 'brak ofert'}',
                ),
              ),
          ]),
        ),
      );
}

class _ListingCard extends StatelessWidget {
  final Map<String, dynamic> l;
  final AppState state;
  final Future<void> Function() reload;
  const _ListingCard({required this.l, required this.state, required this.reload});

  @override
  Widget build(BuildContext context) {
    final mine = l['mine'] == true;
    final qty = asNum(l['qty']).toInt();
    final unit = asNum(l['unitPrice']).toInt();
    final ship = asNum(l['shipPerUnit']).toDouble();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${resName(l['material'] as String)} × $qty  ·  $unit rudy/szt.', style: Theme.of(context).textTheme.titleSmall),
          Text('${mine ? 'Twoja oferta' : 'Sprzedaje ${l['seller']}'}  ·  wygasa za ${fmtDuration(parseTime(l['expiresAt']).difference(DateTime.now()).inSeconds)}'),
          if (!mine)
            Text('Przewóz ${ship.toStringAsFixed(1)}/szt.  ·  razem ${asNum(l['totalPerUnit']).toStringAsFixed(1)}/szt.  ·  ${fmtInt(asNum(l['distanceKm']))} km, '
                '${fmtDuration(asNum(l['etaMinutes']).toInt() * 60)}  ·  zasadzka ${l['ambushChance']}%'),
          if (!mine)
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.tonal(
                onPressed: state.busy
                    ? null
                    : () async {
                        final r = await askQty(
                          context,
                          title: 'Kup ${resName(l['material'] as String)}',
                          max: qty,
                          initial: qty,
                          insurable: true,
                          hint: 'Towar dojedzie karawaną. W zasadzce możesz stracić część ładunku.',
                          summary: (n) => 'Do zapłaty ok. ${fmtInt((n * (unit + ship)).ceil())} rudy (bez ubezpieczenia).',
                        );
                        if (r == null || !context.mounted) return;
                        await act(
                          state,
                          () => state.api.post('/market/listings/${l['id']}/buy', body: {'qty': r.qty, 'insure': r.insure}, idempotent: true),
                          reload,
                          ctx: context,
                          okText: 'Karawana wyruszyła',
                        );
                      },
                child: const Text('Kup'),
              ),
            ),
        ]),
      ),
    );
  }
}

class _Mine extends StatelessWidget {
  final AppState state;
  const _Mine({required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () async {
        final r = await Future.wait([state.api.get('/market/mine'), state.api.get('/market')]);
        return {'mine': r[0], 'overview': r[1]};
      },
      builder: (context, data, reload) {
        final d = asMap(data);
        final mine = asMap(d['mine']);
        final ov = asMap(d['overview']);
        final listings = asList(mine['listings']);
        final trades = asList(mine['trades']);
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              FilledButton.icon(
                icon: const Icon(Icons.add),
                label: Text('Wystaw ofertę (${listings.length}/${ov['maxActive']})'),
                onPressed: state.busy ? null : () => _create(context, ov, reload),
              ),
              Text('Prowizja ${(asNum(ov['fee']) * 100).round()}% od sprzedaży, oferta wygasa po ${ov['listingHours']} h.', style: Theme.of(context).textTheme.bodySmall),
              const SectionTitle('Aktywne oferty'),
              if (listings.isEmpty) const EmptyNote('Nic nie wystawiasz.'),
              for (final l in listings)
                Card(
                  child: ListTile(
                    title: Text('${resName(l['material'] as String)} × ${l['qty']}  ·  ${l['unitPrice']} rudy/szt.'),
                    subtitle: Text('wygasa za ${fmtDuration(parseTime(l['expiresAt']).difference(DateTime.now()).inSeconds)}'),
                    trailing: TextButton(
                      onPressed: state.busy ? null : () => act(state, () => state.api.delete('/market/listings/${l['id']}'), reload, ctx: context, okText: 'Wycofano ofertę'),
                      child: const Text('Wycofaj'),
                    ),
                  ),
                ),
              const SectionTitle('Ostatnie transakcje'),
              if (trades.isEmpty) const EmptyNote('Brak transakcji.'),
              for (final t in trades)
                ListTile(
                  dense: true,
                  leading: Icon(t['side'] == 'sold' ? Icons.arrow_upward : Icons.arrow_downward),
                  title: Text('${t['side'] == 'sold' ? 'Sprzedano' : 'Kupiono'} ${t['qty']} × ${resName(t['material'] as String)} po ${t['unitPrice']}'),
                  subtitle: Text('${t['counterparty'] == 'bot' ? 'bot' : 'gracz'}  ·  ${fmtInt(asNum(t['gross']))} rudy${asNum(t['fee']) > 0 ? ' (prowizja ${fmtInt(asNum(t['fee']))})' : ''}'),
                ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _create(BuildContext context, Map<String, dynamic> ov, Future<void> Function() reload) async {
    final mats = asList(ov['materials']);
    final res = await showDialog<({String material, int qty, int price})>(
      context: context,
      builder: (ctx) => _CreateListingDialog(mats: mats, maxQty: asNum(ov['maxQty']).toInt()),
    );
    if (res == null || !context.mounted) return;
    await act(
      state,
      () => state.api.post('/market/listings', body: {'material': res.material, 'qty': res.qty, 'unitPrice': res.price}, idempotent: true),
      reload,
      ctx: context,
      okText: 'Oferta wystawiona',
    );
  }
}

class _CreateListingDialog extends StatefulWidget {
  final List<Map<String, dynamic>> mats;
  final int maxQty;
  const _CreateListingDialog({required this.mats, required this.maxQty});
  @override
  State<_CreateListingDialog> createState() => _CreateListingDialogState();
}

class _CreateListingDialogState extends State<_CreateListingDialog> {
  late String _material = widget.mats.first['id'] as String;
  final _qty = TextEditingController(text: '10');
  final _price = TextEditingController();

  Map<String, dynamic> get _m => widget.mats.firstWhere((m) => m['id'] == _material);

  @override
  void initState() {
    super.initState();
    _price.text = '${asNum(_m['npcPrice']).toInt()}';
  }

  @override
  void dispose() {
    _qty.dispose();
    _price.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = asMap(_m['corridor']);
    final q = int.tryParse(_qty.text.trim()) ?? 0;
    final p = int.tryParse(_price.text.trim()) ?? 0;
    final valid = q >= 1 && q <= widget.maxQty && p >= asNum(c['min']) && p <= asNum(c['max']);
    return AlertDialog(
      title: const Text('Nowa oferta'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(
          initialValue: _material,
          items: [for (final m in widget.mats) DropdownMenuItem(value: m['id'] as String, child: Text(m['name'] as String))],
          onChanged: (v) => setState(() {
            _material = v!;
            _price.text = '${asNum(_m['npcPrice']).toInt()}';
          }),
        ),
        const SizedBox(height: 8),
        TextField(controller: _qty, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: 'Ilość (1–${widget.maxQty})', border: const OutlineInputBorder()), onChanged: (_) => setState(() {})),
        const SizedBox(height: 8),
        TextField(controller: _price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: 'Cena za sztukę (${c['min']}–${c['max']})', border: const OutlineInputBorder()), onChanged: (_) => setState(() {})),
        const SizedBox(height: 8),
        const Text('Materiał zostaje zablokowany w ofercie do sprzedaży lub wycofania.'),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Anuluj')),
        FilledButton(onPressed: valid ? () => Navigator.pop(context, (material: _material, qty: q, price: p)) : null, child: const Text('Wystaw')),
      ],
    );
  }
}

class _Npc extends StatelessWidget {
  final AppState state;
  const _Npc({required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () async {
        final r = await Future.wait([state.api.get('/market'), state.api.get('/geology')]);
        return {'overview': r[0], 'geology': r[1]};
      },
      builder: (context, data, reload) {
        final d = asMap(data);
        final ov = asMap(d['overview']);
        final mats = asList(ov['materials']);
        final geo = asList(asMap(d['geology'])['materials']);
        final left = asNum(ov['botDailyLeft']).toInt();
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Handlarz Przekaźnikowy sprzedaje po stałej cenie i dowozi od ręki. Skup botów jest tani i ma dzienny limit (zostało: $left szt.).'),
              for (final m in mats)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(m['name'] as String, style: Theme.of(context).textTheme.titleSmall),
                      Text(geo.where((g) => g['id'] == m['id']).map((g) => 'W okolicy: ${localNames[g['local']] ?? g['local']}').join()),
                      const SizedBox(height: 8),
                      Wrap(spacing: 8, children: [
                        FilledButton.tonal(
                          onPressed: state.busy
                              ? null
                              : () async {
                                  final price = asNum(m['npcPrice']).toInt();
                                  final r = await askQty(context, title: 'Kup od Handlarza: ${m['name']}', max: 500, initial: 10, summary: (n) => 'Koszt: ${fmtInt(n * price)} rudy ($price/szt.).');
                                  if (r == null || !context.mounted) return;
                                  await act(state, () => state.api.post('/exchange/buy', body: {'material': m['id'], 'qty': r.qty}, idempotent: true), reload, ctx: context, okText: 'Kupiono');
                                },
                          child: Text('Kup (${m['npcPrice']})'),
                        ),
                        OutlinedButton(
                          onPressed: (state.busy || left <= 0)
                              ? null
                              : () async {
                                  final bid = asNum(m['botBid']).toInt();
                                  final r = await askQty(context, title: 'Sprzedaj botom: ${m['name']}', max: left, initial: 1, summary: (n) => 'Dostaniesz ${fmtInt(n * bid)} rudy ($bid/szt.).');
                                  if (r == null || !context.mounted) return;
                                  await act(state, () => state.api.post('/market/sell-npc', body: {'material': m['id'], 'qty': r.qty}, idempotent: true), reload, ctx: context, okText: 'Sprzedano');
                                },
                          child: Text('Sprzedaj botom (${m['botBid']})'),
                        ),
                      ]),
                    ]),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Caravans extends StatelessWidget {
  final AppState state;
  const _Caravans({required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/market/shipments'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final list = asList(d['shipments']);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Karawany w drodze: ${list.where((s) => s['state'] == 'transit').length}/${d['maxActive']}', style: Theme.of(context).textTheme.titleMedium),
            if (list.isEmpty) const EmptyNote('Nic nie jedzie. Kup coś w zakładce Oferty.'),
            for (final s in list) _ShipmentTile(s: s, reload: reload),
          ],
        );
      },
    );
  }
}

class _ShipmentTile extends StatelessWidget {
  final Map<String, dynamic> s;
  final Future<void> Function() reload;
  const _ShipmentTile({required this.s, required this.reload});

  @override
  Widget build(BuildContext context) {
    final st = s['state'] as String;
    final qty = asNum(s['qty']).toInt();
    final got = asNum(s['deliveredQty']).toInt();
    final title = '${resName(s['material'] as String)} × $qty  ·  ${fmtInt(asNum(s['distanceKm']))} km${s['insured'] == true ? '  ·  ubezpieczone' : ''}';
    if (st == 'transit') {
      return ListTile(
        leading: const Icon(Icons.local_shipping_outlined),
        title: Text(title),
        subtitle: Row(children: [const Text('Dojedzie za '), Countdown(endsAt: parseTime(s['arrivesAt']), onDone: reload)]),
      );
    }
    final lost = st == 'ambushed';
    return ListTile(
      leading: Icon(lost ? Icons.warning_amber : Icons.check_circle_outline, color: lost ? Colors.orangeAccent : Colors.greenAccent),
      title: Text(title),
      subtitle: Text(lost ? 'Zasadzka: dotarło $got z $qty szt.' : 'Dostarczono $got szt.'),
    );
  }
}
