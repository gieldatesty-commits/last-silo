import 'package:flutter/material.dart';
import '../app_state.dart';
import '../building_art.dart';
import '../format.dart';
import '../palette.dart';
import '../slot_icon.dart';
import '../strings.dart';
import '../widgets.dart';

/// Warsztat jako „stół warsztatowy” (makieta Warsztat.dc.html): założone sloty, karta wybranego przedmiotu,
/// ekwipunek i receptury z filtrem slotów. Logika bez zmian: `/items`, akcje przez `act()` z Idempotency-Key.
class WorkshopScreen extends StatelessWidget {
  final AppState state;
  const WorkshopScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return LsTheme(
      child: ColoredBox(
        color: Ls.bg,
        child: Loader(
          load: () => state.api.get('/items'),
          builder: (context, data, reload) => ListenableBuilder(
            listenable: state,
            builder: (context, _) => _Bench(state: state, d: asMap(data), reload: reload),
          ),
        ),
      ),
    );
  }
}

const _display = TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, color: Ls.text);
const _section = TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.6, color: Ls.copper);

/// Wytrzymałość: kolor i słowo (nie tylko kolor).
(Color, String) _durability(double frac, bool broken) {
  if (broken) return (Ls.warn, 'zepsuty');
  if (frac < 0.25) return (Ls.warn, 'niska');
  if (frac < 0.5) return (Ls.amber, 'średnia');
  return (Ls.teal, 'dobra');
}

class _Bench extends StatefulWidget {
  const _Bench({required this.state, required this.d, required this.reload});
  final AppState state;
  final Map<String, dynamic> d;
  final Future<void> Function() reload;
  @override
  State<_Bench> createState() => _BenchState();
}

class _BenchState extends State<_Bench> {
  String? _selected;
  String? _filter; // null = wszystkie sloty

  @override
  Widget build(BuildContext context) {
    final d = widget.d;
    final items = asList(d['items']);
    final recipes = asList(d['recipes']);
    final q = asMap(d['quality']);
    final buildings = ((widget.state.silo?['buildings'] as List?) ?? const []).cast<Map>();
    final wsLevel = (buildings.where((b) => b['type'] == 'warsztat').firstOrNull?['level'] as num?)?.toInt() ?? asNum(d['workshopLevel']).toInt();
    final equipped = {for (final it in items.where((i) => i['equipped'] == true)) it['slot'] as String: it};
    if (_selected == null || !items.any((i) => i['id'] == _selected)) {
      _selected = (equipped.values.firstOrNull ?? items.firstOrNull)?['id'] as String?;
    }
    final sel = items.where((i) => i['id'] == _selected).firstOrNull;
    final shown = recipes.where((r) => _filter == null || r['slot'] == _filter).toList();

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
          child: Row(children: [
            BuildingArt.fromApi('warsztat', wsLevel, width: 120),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Warsztat', style: _display.copyWith(fontSize: 24)),
                const SizedBox(height: 4),
                Text('poz. ${d['workshopLevel']} · ekwipunek ${items.length} / ${d['inventoryMax']}', style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
                Text('jakość nowych: ${q['min']}–${q['max']}', style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
              ]),
            ),
          ]),
        ),
        const Padding(padding: EdgeInsets.fromLTRB(16, 6, 16, 8), child: Text('ZAŁOŻONE', style: _section)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: IntrinsicHeight(
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final (i, slot) in slotOrder.indexed) ...[
                if (i > 0) const SizedBox(width: 6),
                Expanded(
                  child: _SlotTile(
                    slot: slot,
                    item: equipped[slot],
                    selected: equipped[slot] != null && equipped[slot]!['id'] == _selected,
                    onTap: () => setState(() {
                      // pusty slot: pokaż receptury tego slotu
                      if (equipped[slot] != null) {
                        _selected = equipped[slot]!['id'] as String;
                      } else {
                        _filter = slot;
                      }
                    }),
                  ),
                ),
              ],
            ]),
          ),
        ),
        if (sel != null) _ItemCard(it: sel, state: widget.state, reload: widget.reload),
        const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 8), child: Text('EKWIPUNEK', style: _section)),
        if (items.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('Nic jeszcze nie wytworzyłeś. Zacznij od receptury poniżej.', style: TextStyle(color: Ls.textMuted))),
        for (final it in items) _InventoryRow(it: it, selected: it['id'] == _selected, onTap: () => setState(() => _selected = it['id'] as String)),
        Container(
          margin: const EdgeInsets.only(top: 16),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
          decoration: const BoxDecoration(color: Ls.panel, border: Border(top: BorderSide(color: Ls.border)), borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Receptury', style: _display.copyWith(fontSize: 16)),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final (slot, label) in <(String?, String)>[(null, 'Wszystko'), for (final s in slotOrder) (s, slotNames[s] ?? s)])
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(label),
                      selected: _filter == slot,
                      showCheckmark: false,
                      onSelected: (_) => setState(() => _filter = slot),
                      selectedColor: Ls.copper,
                      backgroundColor: Colors.transparent,
                      side: BorderSide(color: _filter == slot ? Ls.copper : const Color(0xFF2B3546)),
                      labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _filter == slot ? Ls.bg : const Color(0xFFC9D0DC)),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 4),
            for (final r in shown) _RecipeRow(r: r, state: widget.state, reload: widget.reload),
            if (shown.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Brak receptur dla tego slotu.', style: TextStyle(color: Ls.textMuted))),
          ]),
        ),
      ],
    );
  }
}

class _SlotTile extends StatelessWidget {
  const _SlotTile({required this.slot, required this.item, required this.selected, required this.onTap});
  final String slot;
  final Map<String, dynamic>? item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final it = item;
    final frac = it == null ? 0.0 : (asNum(it['maxDurability']) > 0 ? asNum(it['durability']) / asNum(it['maxDurability']) : 0.0).toDouble();
    final (dc, dw) = _durability(frac, it?['broken'] == true);
    final name = slotNames[slot] ?? slot;
    return Semantics(
      button: true,
      selected: selected,
      label: it == null ? '$name: pusto' : '$name: ${it['name']}, wytrzymałość $dw',
      excludeSemantics: true,
      child: Material(
        color: it == null ? Colors.transparent : Ls.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: selected ? Ls.copper : (it == null ? Ls.locked : Ls.border)),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
            child: Column(children: [
              SlotIcon(slot, color: it == null ? Ls.locked : Ls.copper),
              const SizedBox(height: 4),
              Text(name.toUpperCase(), style: const TextStyle(fontSize: 9, letterSpacing: 0.6, color: Ls.textFaint), textAlign: TextAlign.center),
              const SizedBox(height: 2),
              Expanded(
                  child: Text(it == null ? 'pusto' : '${it['name']}',
                      textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: it == null ? Ls.textMuted : Ls.text))),
              const SizedBox(height: 4),
              ClipRRect(borderRadius: BorderRadius.circular(2), child: LinearProgressIndicator(value: frac, minHeight: 4, color: dc, backgroundColor: Ls.border)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Karta wybranego przedmiotu: jakość, bonus, wzmocnienie, wytrzymałość i akcje (jak dotąd: założenie, naprawa, wzmocnienie).
class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.it, required this.state, required this.reload});
  final Map<String, dynamic> it;
  final AppState state;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final id = it['id'] as String;
    final equipped = it['equipped'] == true;
    final broken = it['broken'] == true;
    final dur = asNum(it['durability']).toInt();
    final maxDur = asNum(it['maxDurability']).toInt();
    final frac = maxDur > 0 ? dur / maxDur : 0.0;
    final (dc, dw) = _durability(frac, broken);
    final tier = asNum(it['tier']).toInt();
    final maxTier = asNum(it['maxTier']).toInt();
    final next = it['nextUpgrade'] == null ? null : asMap(it['nextUpgrade']);
    final repair = asNum(it['repairCost']).toInt();
    final busy = state.busy;

    ButtonStyle outlined(Color side) => OutlinedButton.styleFrom(
          foregroundColor: Ls.text,
          side: BorderSide(color: side),
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        );

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Ls.card, border: Border.all(color: Ls.copper.withValues(alpha: 0.4)), borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${(slotNames[it['slot']] ?? '${it['slot']}').toUpperCase()}${equipped ? ' · ZAŁOŻONY' : ''}', style: _section)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(border: Border.all(color: Ls.teal), borderRadius: BorderRadius.circular(10)),
            child: Text('jakość ${it['quality']}', style: const TextStyle(fontSize: 12, color: Ls.teal)),
          ),
        ]),
        const SizedBox(height: 6),
        Text('${it['name']}', style: _display.copyWith(fontSize: 19)),
        const SizedBox(height: 4),
        Text('Siła zjazdu +${it['bonus']}', style: const TextStyle(fontSize: 13, color: Ls.text)),
        const SizedBox(height: 8),
        Semantics(
          label: 'wzmocnienie $tier z $maxTier',
          excludeSemantics: true,
          // Wrap: przy dużej czcionce kropki schodzą do nowej linii zamiast wystawać poza kartę
          child: Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            const Text('wzmocnienie', style: TextStyle(fontSize: 12, color: Ls.textMuted)),
            Row(mainAxisSize: MainAxisSize.min, children: [
              for (var k = 0; k < maxTier; k++)
                Container(
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.only(right: 4),
                  decoration: k < tier ? const BoxDecoration(color: Ls.copper, shape: BoxShape.circle) : BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Ls.locked, width: 1.5)),
                ),
            ]),
            Text('$tier / $maxTier', style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
          ]),
        ),
        const SizedBox(height: 8),
        Wrap(alignment: WrapAlignment.spaceBetween, spacing: 8, children: [
          Text('wytrzymałość ($dw)', style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
          Text(broken ? 'zepsuty' : '$dur / $maxDur', style: TextStyle(fontSize: 12, color: broken ? Ls.warnText : Ls.textMuted, fontFeatures: const [FontFeature.tabularFigures()])),
        ]),
        const SizedBox(height: 4),
        ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(value: frac.clamp(0.0, 1.0).toDouble(), minHeight: 6, color: dc, backgroundColor: Ls.border)),
        const SizedBox(height: 10),
        Wrap(spacing: 6, runSpacing: 6, children: [
          OutlinedButton(
            onPressed: busy || (broken && !equipped) ? null : () => act(state, () => state.api.post('/items/$id/${equipped ? 'unequip' : 'equip'}', idempotent: true), reload),
            style: outlined(Ls.locked),
            child: Text(equipped ? 'Zdejmij' : 'Załóż'),
          ),
          if (repair > 0)
            OutlinedButton(
              onPressed: busy ? null : () => act(state, () => state.api.post('/items/$id/repair', idempotent: true), reload, ctx: context, okText: 'Naprawiono'),
              style: outlined(Ls.copper),
              child: Text('Napraw · ${fmtInt(repair)} rudy'),
            ),
          if (next != null)
            FilledButton(
              onPressed: busy
                  ? null
                  : () async {
                      final ok =
                          await confirm(context, 'Wzmocnić przedmiot?', 'Koszt: ${costText(next)}.\nWymaga Warsztatu poz. ${next['workshop']} i Radiostacji poz. ${next['radio']}.', ok: 'Wzmocnij');
                      if (ok && context.mounted) {
                        await act(state, () => state.api.post('/items/$id/upgrade', idempotent: true), reload, ctx: context, okText: 'Wzmocniono');
                      }
                    },
              style: FilledButton.styleFrom(
                backgroundColor: Ls.copper,
                foregroundColor: Ls.bg,
                minimumSize: const Size(0, 44),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
              child: const Text('Wzmocnij'),
            ),
        ]),
      ]),
    );
  }
}

class _InventoryRow extends StatelessWidget {
  const _InventoryRow({required this.it, required this.selected, required this.onTap});
  final Map<String, dynamic> it;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final maxDur = asNum(it['maxDurability']);
    final frac = (maxDur > 0 ? asNum(it['durability']) / maxDur : 0.0).toDouble();
    final (dc, dw) = _durability(frac, it['broken'] == true);
    final equipped = it['equipped'] == true;
    return Semantics(
      button: true,
      selected: selected,
      label: '${it['name']}, ${slotNames[it['slot']] ?? it['slot']}${equipped ? ', założony' : ''}, wytrzymałość $dw',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
        child: Material(
          color: Ls.card,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: selected ? Ls.copper : Ls.border)),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 52),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                child: Row(children: [
                  SlotIcon(it['slot'] as String, color: Ls.copper),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${it['name']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
                      Text('+${it['bonus']} · wzmocnienie ${it['tier']}/${it['maxTier']}', style: const TextStyle(fontSize: 11, color: Ls.textMuted)),
                    ]),
                  ),
                  if (equipped)
                    Container(
                      margin: const EdgeInsets.only(right: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(color: Ls.copper.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                      child: const Text('założony', style: TextStyle(fontSize: 11, color: Ls.copper)),
                    ),
                  SizedBox(width: 44, child: ClipRRect(borderRadius: BorderRadius.circular(2), child: LinearProgressIndicator(value: frac, minHeight: 4, color: dc, backgroundColor: Ls.border))),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Receptura: koszt (brakujące na czerwono), wymagania przy blokadzie, „Wytwórz” tylko gdy wolno i stać.
class _RecipeRow extends StatelessWidget {
  const _RecipeRow({required this.r, required this.state, required this.reload});
  final Map<String, dynamic> r;
  final AppState state;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final locked = r['locked'] == true;
    final wallet = (state.silo?['wallet'] as Map?) ?? const {};
    bool have(String res, num need) => need <= 0 || asNum(wallet[res]) >= need;
    final chips = <(String, bool)>[
      if (locked) ...[
        if (r['needsTech'] != null) ('Wymaga badania', false),
        ('Warsztat poz. ${r['workshop']}', true),
        if (r['radio'] != null) ('Radiostacja poz. ${r['radio']}', true),
      ] else ...[
        if (asNum(r['ore']) > 0) ('${fmtInt(asNum(r['ore']))} rudy', have('ore', asNum(r['ore']))),
        if (asNum(r['tokens']) > 0) ('${fmtInt(asNum(r['tokens']))} żet.', have('tokens', asNum(r['tokens']))),
        for (final e in ((r['materials'] as Map?) ?? const {}).entries) ('${e.value} ${resName(e.key as String)}', have(e.key as String, e.value as num)),
      ],
    ];
    final affordable = chips.every((c) => c.$2);
    final canCraft = !locked && affordable && !state.busy;
    final label = locked ? 'Zablokowane' : (affordable ? 'Wytwórz' : 'Brak');
    return Opacity(
      opacity: locked ? 0.6 : 1,
      child: Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Ls.card, border: Border.all(color: Ls.border), borderRadius: BorderRadius.circular(12)),
        // na wąskim ekranie albo przy dużej czcionce przycisk schodzi pod opis (pełna szerokość), inaczej stoi z prawej
        child: LayoutBuilder(builder: (context, box) {
          final stacked = box.maxWidth < 300 || MediaQuery.textScalerOf(context).scale(1) > 1.3;
          final info = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['name']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
            Text('+${r['bonus']} · ${r['durability']} wytrz. · ${slotNames[r['slot']] ?? r['slot']}', style: const TextStyle(fontSize: 11, color: Ls.textMuted)),
            const SizedBox(height: 4),
            Wrap(spacing: 4, runSpacing: 4, children: [
              for (final (t, ok) in chips)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(color: ok ? Ls.chip : null, borderRadius: BorderRadius.circular(9), border: ok ? null : Border.all(color: Ls.warn)),
                  child: Text(t, style: TextStyle(fontSize: 11, color: ok ? const Color(0xFFC9D0DC) : Ls.warnText)),
                ),
            ]),
          ]);
          final button = canCraft
              ? FilledButton(
                  onPressed: () => act(state, () => state.api.post('/items/craft', body: {'recipeId': r['id']}, idempotent: true), reload, ctx: context, okText: 'Wytworzono: ${r['name']}'),
                  style: FilledButton.styleFrom(
                    backgroundColor: Ls.copper,
                    foregroundColor: Ls.bg,
                    minimumSize: const Size(78, 44),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  child: Text(label),
                )
              : OutlinedButton(
                  onPressed: null,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(78, 44),
                    disabledForegroundColor: Ls.textMuted,
                    side: const BorderSide(color: Ls.locked),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  child: Text(label),
                );
          final icon = SlotIcon(r['slot'] as String, color: locked ? Ls.locked : Ls.copper, size: 26);
          if (stacked) {
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [icon, const SizedBox(width: 10), Expanded(child: info)]),
              const SizedBox(height: 8),
              button,
            ]);
          }
          return Row(children: [icon, const SizedBox(width: 10), Expanded(child: info), const SizedBox(width: 8), button]);
        }),
      ),
    );
  }
}
