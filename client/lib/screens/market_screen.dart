import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';
import '../widgets.dart';

/// Rynek materiałów: oferty graczy, własne oferty, Handlarz NPC i karawany w drodze.
/// Zakup z rynku to fizyczna dostawa: czas, opłata przewozowa i ryzyko zasadzki rosną z dystansem.
/// Logika bez zmian (te same zapytania, askQty/askInsure, act() z Idempotency-Key); zmieniony tylko widok.
class MarketScreen extends StatelessWidget {
  final AppState state;
  const MarketScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Column(children: [
        const TabBar(
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          indicatorColor: Ls.copper,
          labelColor: Ls.text,
          unselectedLabelColor: Ls.textMuted,
          dividerColor: Ls.border,
          tabs: [Tab(text: 'Oferty'), Tab(text: 'Moje'), Tab(text: 'Handlarz'), Tab(text: 'Karawany')],
        ),
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

/// Mała liczba z podpisem w karcie ceny.
class _Price extends StatelessWidget {
  const _Price(this.label, this.value, {this.color = Ls.text});
  final String label;
  final String value;
  final Color color;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: const TextStyle(fontSize: 10, letterSpacing: 0.8, color: Ls.textFaint)),
        Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: color, fontFeatures: const [FontFeature.tabularFigures()])),
      ]);
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
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            children: [
              const SectionTitle('Ceny (ruda za sztukę)'),
              for (final m in mats)
                LsCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${m['name']}', style: lsDisplay.copyWith(fontSize: 15)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 18, runSpacing: 8, children: [
                      _Price('HANDLARZ', '${m['npcPrice']}'),
                      _Price('SKUP BOTÓW', '${m['botBid']}'),
                      _Price('ŚR. 7 DNI', m['avg7d'] != null ? '${m['avg7d']}' : 'brak', color: m['avg7d'] != null ? Ls.text : Ls.textMuted),
                      _Price('NAJTANIEJ', m['bestAsk'] != null ? '${m['bestAsk']}' : 'brak ofert', color: m['bestAsk'] != null ? Ls.amber : Ls.textMuted),
                    ]),
                  ]),
                ),
              const SizedBox(height: 4),
              Wrap(spacing: 6, runSpacing: 6, children: [
                _Filter('Wszystko', _material == null, () => setState(() => _material = null)),
                for (final m in materialIds) _Filter(resName(m), _material == m, () => setState(() => _material = m)),
              ]),
              const SectionTitle('Oferty graczy'),
              const Text('Cena na liście plus przewóz. Ostateczny koszt widać w oknie zakupu.', style: lsMuted),
              const SizedBox(height: 8),
              if (listings.isEmpty) const EmptyNote('Brak ofert.'),
              for (final l in listings) _ListingCard(l: l, state: state, reload: reload),
            ],
          ),
        );
      },
    );
  }
}

class _Filter extends StatelessWidget {
  const _Filter(this.label, this.selected, this.onTap);
  final String label;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => ChoiceChip(
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        onSelected: (_) => onTap(),
        selectedColor: Ls.copper,
        backgroundColor: Colors.transparent,
        side: BorderSide(color: selected ? Ls.copper : const Color(0xFF2B3546)),
        labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: selected ? Ls.bg : const Color(0xFFC9D0DC)),
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
    final left = fmtDuration(parseTime(l['expiresAt']).difference(DateTime.now()).inSeconds);
    return LsCard(
      border: mine ? Ls.copper.withValues(alpha: 0.5) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${resName(l['material'] as String)} × $qty', style: lsDisplay.copyWith(fontSize: 16)),
              Text('${mine ? 'Twoja oferta' : 'Sprzedaje ${l['seller']}'} · wygasa za $left', style: lsMuted),
            ]),
          ),
          const SizedBox(width: 8),
          _Price('ZA SZTUKĘ', '$unit rudy', color: Ls.amber),
        ]),
        if (!mine) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            LsChip('przewóz ${ship.toStringAsFixed(1)}/szt.'),
            LsChip('razem ${asNum(l['totalPerUnit']).toStringAsFixed(1)}/szt.'),
            LsChip('${fmtInt(asNum(l['distanceKm']))} km · ${fmtDuration(asNum(l['etaMinutes']).toInt() * 60)}'),
            LsChip('zasadzka ${l['ambushChance']}%', color: asNum(l['ambushChance']) >= 10 ? Ls.warn : null),
          ]),
          const SizedBox(height: 10),
          LsButton(
            'Kup',
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
                    await act(state, () => state.api.post('/market/listings/${l['id']}/buy', body: {'qty': r.qty, 'insure': r.insure}, idempotent: true), reload, ctx: context, okText: 'Karawana wyruszyła');
                  },
          ),
        ],
      ]),
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
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            children: [
              LsButton('Wystaw ofertę (${listings.length} / ${ov['maxActive']})', onPressed: state.busy ? null : () => _create(context, ov, reload)),
              const SizedBox(height: 6),
              Text('Prowizja ${(asNum(ov['fee']) * 100).round()}% od sprzedaży, oferta wygasa po ${ov['listingHours']} h.', style: lsMuted),
              const SectionTitle('Aktywne oferty'),
              if (listings.isEmpty) const EmptyNote('Nic nie wystawiasz.'),
              for (final l in listings)
                LsCard(
                  child: LsActionRow(
                    body: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${resName(l['material'] as String)} × ${l['qty']} · ${l['unitPrice']} rudy/szt.', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
                      Text('wygasa za ${fmtDuration(parseTime(l['expiresAt']).difference(DateTime.now()).inSeconds)}', style: lsMuted),
                    ]),
                    action: LsButton('Wycofaj', secondary: true, expand: false, color: Ls.locked, onPressed: state.busy ? null : () => act(state, () => state.api.delete('/market/listings/${l['id']}'), reload, ctx: context, okText: 'Wycofano ofertę')),
                  ),
                ),
              const SectionTitle('Ostatnie transakcje'),
              if (trades.isEmpty) const EmptyNote('Brak transakcji.'),
              for (final t in trades)
                LsCard(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  child: Row(children: [
                    Icon(t['side'] == 'sold' ? Icons.north_east : Icons.south_west, color: t['side'] == 'sold' ? const Color(0xFF9CE0B5) : Ls.amber, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${t['side'] == 'sold' ? 'Sprzedano' : 'Kupiono'} ${t['qty']} × ${resName(t['material'] as String)} po ${t['unitPrice']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
                        Text('${t['counterparty'] == 'bot' ? 'bot' : 'gracz'} · ${fmtInt(asNum(t['gross']))} rudy${asNum(t['fee']) > 0 ? ' (prowizja ${fmtInt(asNum(t['fee']))})' : ''}', style: lsMuted),
                      ]),
                    ),
                  ]),
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
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            children: [
              const Text('Handlarz Przekaźnikowy sprzedaje po stałej cenie i dowozi od ręki. Skup botów jest tani i ma dzienny limit.', style: lsBody),
              const SizedBox(height: 8),
              LsChip('skup botów dziś: zostało $left szt.', ok: left > 0),
              const SizedBox(height: 12),
              for (final m in mats)
                LsCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    // Wrap: przy dużej czcionce chip schodzi pod nazwę zamiast wystawać poza kartę
                    Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 6, children: [
                      Text(m['name'] as String, style: lsDisplay.copyWith(fontSize: 16)),
                      for (final g in geo.where((g) => g['id'] == m['id'])) LsChip('w okolicy: ${localNames[g['local']] ?? g['local']}'),
                    ]),
                    const SizedBox(height: 10),
                    Row(children: [
                      Expanded(
                        child: LsButton(
                          'Kup · ${m['npcPrice']}',
                          onPressed: state.busy
                              ? null
                              : () async {
                                  final price = asNum(m['npcPrice']).toInt();
                                  final r = await askQty(context, title: 'Kup od Handlarza: ${m['name']}', max: 500, initial: 10, summary: (n) => 'Koszt: ${fmtInt(n * price)} rudy ($price/szt.).');
                                  if (r == null || !context.mounted) return;
                                  await act(state, () => state.api.post('/exchange/buy', body: {'material': m['id'], 'qty': r.qty}, idempotent: true), reload, ctx: context, okText: 'Kupiono');
                                },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: LsButton(
                          'Sprzedaj · ${m['botBid']}',
                          secondary: true,
                          onPressed: (state.busy || left <= 0)
                              ? null
                              : () async {
                                  final bid = asNum(m['botBid']).toInt();
                                  final r = await askQty(context, title: 'Sprzedaj botom: ${m['name']}', max: left, initial: 1, summary: (n) => 'Dostaniesz ${fmtInt(n * bid)} rudy ($bid/szt.).');
                                  if (r == null || !context.mounted) return;
                                  await act(state, () => state.api.post('/market/sell-npc', body: {'material': m['id'], 'qty': r.qty}, idempotent: true), reload, ctx: context, okText: 'Sprzedano');
                                },
                        ),
                      ),
                    ]),
                  ]),
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
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          children: [
            LsHeader('Karawany', subtitle: 'Towar kupiony od graczy jedzie do Twojego silosu.', trailing: LsStat('W DRODZE', '${list.where((s) => s['state'] == 'transit').length} / ${d['maxActive']}', alignEnd: true)),
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
    final title = '${resName(s['material'] as String)} × $qty · ${fmtInt(asNum(s['distanceKm']))} km';
    if (st == 'transit') {
      final dep = s['departedAt'] == null ? null : parseTime(s['departedAt']);
      final arr = parseTime(s['arrivesAt']);
      final total = dep == null ? 0 : arr.difference(dep).inSeconds;
      final pct = total > 0 ? DateTime.now().difference(dep!).inSeconds / total : null;
      return LsCard(
        border: Ls.amber.withValues(alpha: 0.4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.local_shipping_outlined, color: Ls.amber),
            const SizedBox(width: 12),
            Expanded(child: Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text))),
          ]),
          if (s['insured'] == true) ...[const SizedBox(height: 6), const LsChip('ubezpieczone', color: Ls.teal)],
          const SizedBox(height: 8),
          LsMeter(pct),
          const SizedBox(height: 4),
          Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
            const Text('dojedzie za ', style: lsMuted),
            Countdown(endsAt: arr, onDone: reload, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Ls.amber)),
          ]),
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
            Text(lost ? 'Zasadzka: dotarło $got z $qty szt.' : 'Dostarczono $got szt.', style: lsMuted),
          ]),
        ),
      ]),
    );
  }
}
