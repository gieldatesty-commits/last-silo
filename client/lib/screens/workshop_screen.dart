import 'package:flutter/material.dart';
import '../app_state.dart';
import '../building_art.dart';
import '../format.dart';
import '../palette.dart';
import '../slot_icon.dart';
import '../strings.dart';
import '../ui.dart';
import '../widgets.dart';

/// Warsztat jako „stół warsztatowy” (makiety Warsztat.dc.html i WarsztatZestawy.dc.html): dwa zestawy ekwipunku,
/// sloty podglądanego zestawu, karta wybranego przedmiotu, ekwipunek i receptury z filtrem.
/// Akcje: `/items/*` i `/loadouts/{n}/activate` przez `act()` z Idempotency-Key (docs/ekwipunek-v1.0.md §3).
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

/// Profil przedmiotu lub receptury słowami: tylko niezerowe pola (zjazd, atak, obrona).
String profileText(Map m, {bool long = false}) {
  final parts = <String>[
    if (asNum(m['bonus']) > 0) '${long ? 'Siła zjazdu' : 'zjazd'} +${m['bonus']}',
    if (asNum(m['attack']) > 0) '${long ? 'Atak' : 'atak'} +${m['attack']}',
    if (asNum(m['defense']) > 0) '${long ? 'Obrona' : 'obrona'} +${m['defense']}',
  ];
  return parts.isEmpty ? 'bez bonusu' : parts.join(long ? '   ' : ' · ');
}

/// Zestawy, w których jest przedmiot (z API `inLoadouts`; starsze odpowiedzi: `equipped` = aktywny).
List<int> inLoadoutsOf(Map it, int active) {
  final l = it['inLoadouts'];
  if (l is List) return [for (final n in l) (n as num).toInt()];
  return it['equipped'] == true ? [active] : const [];
}

String membershipText(List<int> lo) => lo.length == 2 ? 'I + II' : loadoutName(lo.first);

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
  String? _filter; // null = wszystko; 'dive' / 'combat' albo id slotu
  int? _editing; // podglądany zestaw (null = aktywny)

  bool _matches(Map r) => switch (_filter) {
        null => true,
        'dive' => asNum(r['bonus']) > 0,
        'combat' => asNum(r['attack']) > 0 || asNum(r['defense']) > 0,
        final slot => r['slot'] == slot,
      };

  @override
  Widget build(BuildContext context) {
    final d = widget.d;
    final items = asList(d['items']);
    final recipes = asList(d['recipes']);
    final q = asMap(d['quality']);
    final buildings = ((widget.state.silo?['buildings'] as List?) ?? const []).cast<Map>();
    final wsLevel = (buildings.where((b) => b['type'] == 'warsztat').firstOrNull?['level'] as num?)?.toInt() ?? asNum(d['workshopLevel']).toInt();
    final active = asNum(d['activeLoadout'] ?? (widget.state.silo?['player'] as Map?)?['activeLoadout'] ?? 1).toInt() == 2 ? 2 : 1;
    final editing = _editing ?? active;
    final stats = d['loadoutStats'] is Map ? asMap(d['loadoutStats']) : <String, dynamic>{};
    final equipped = {
      for (final it in items.where((i) => inLoadoutsOf(i, active).contains(editing))) it['slot'] as String: it,
    };
    if (_selected == null || !items.any((i) => i['id'] == _selected)) {
      _selected = (equipped.values.firstOrNull ?? items.firstOrNull)?['id'] as String?;
    }
    final sel = items.where((i) => i['id'] == _selected).firstOrNull;
    final shown = recipes.where(_matches).toList();

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
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
          child: _LoadoutTiles(
            active: active,
            editing: editing,
            stats: stats,
            onTap: (n) => setState(() {
              _editing = n;
              _selected = null;
            }),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Text(
            'Zjazd i najazd zapamiętują zestaw z chwili wysłania. Obrona silosu liczy pancerz z aktywnego zestawu i część z drugiego.',
            style: const TextStyle(fontSize: 11, height: 1.4, color: Ls.textMuted),
          ),
        ),
        if (editing != active)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: FilledButton(
              onPressed: widget.state.busy
                  ? null
                  : () => act(widget.state, () => widget.state.api.post('/loadouts/$editing/activate', idempotent: true), widget.reload, ctx: context, okText: 'Aktywny zestaw ${loadoutName(editing)}'),
              style: FilledButton.styleFrom(
                backgroundColor: Ls.copper,
                foregroundColor: Ls.bg,
                minimumSize: const Size(double.infinity, 44),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
              child: Text('Włącz zestaw ${loadoutName(editing)}'),
            ),
          ),
        Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 8), child: Text('ZESTAW ${loadoutName(editing)}${editing == active ? ' · AKTYWNY' : ' · PODGLĄD'}', style: _section)),
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
                    inBoth: equipped[slot] != null && inLoadoutsOf(equipped[slot]!, active).length == 2,
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
        if (sel != null) _ItemCard(it: sel, state: widget.state, reload: widget.reload, active: active, editing: editing),
        const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 8), child: Text('EKWIPUNEK', style: _section)),
        if (items.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('Nic jeszcze nie wytworzyłeś. Zacznij od receptury poniżej.', style: TextStyle(color: Ls.textMuted))),
        for (final it in items) _InventoryRow(it: it, active: active, selected: it['id'] == _selected, onTap: () => setState(() => _selected = it['id'] as String)),
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
                for (final (slot, label) in <(String?, String)>[(null, 'Wszystko'), ('dive', 'Zjazdowe'), ('combat', 'Bojowe'), for (final s in slotOrder) (s, slotNames[s] ?? s)])
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
            if (shown.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Brak receptur w tym filtrze.', style: TextStyle(color: Ls.textMuted))),
          ]),
        ),
      ],
    );
  }
}

/// Dwa kafelki zestawów: stuknięcie pokazuje zestaw (podgląd), aktywny opisany słowem i znakiem, nie tylko kolorem.
class _LoadoutTiles extends StatelessWidget {
  const _LoadoutTiles({required this.active, required this.editing, required this.stats, required this.onTap});
  final int active;
  final int editing;
  final Map<String, dynamic> stats;
  final void Function(int) onTap;

  @override
  Widget build(BuildContext context) {
    Widget tile(int n) {
      final st = stats['$n'] is Map ? asMap(stats['$n']) : <String, dynamic>{};
      final isActive = n == active;
      final shown = n == editing;
      final parts = [('zjazd', st['dive']), ('atak', st['attack']), ('obrona', st['defense'])];
      final label = 'Zestaw ${loadoutName(n)}, ${isActive ? 'aktywny' : 'nieaktywny'}, ${parts.map((p) => '${p.$1} +${p.$2 ?? 0}').join(', ')}';
      return Semantics(
        button: true,
        selected: shown,
        label: label,
        excludeSemantics: true,
        child: Material(
          color: isActive ? const Color(0xFF1A1410) : Ls.card,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: shown ? Ls.copper : Ls.border, width: shown ? 2 : 1)),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => onTap(n),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 72),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Text('Zestaw ${loadoutName(n)}', style: _display.copyWith(fontSize: 15)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                      decoration: isActive
                          ? BoxDecoration(color: Ls.copper, borderRadius: BorderRadius.circular(9))
                          : BoxDecoration(border: Border.all(color: Ls.locked), borderRadius: BorderRadius.circular(9)),
                      child: Text(isActive ? '● aktywny' : '○ nieaktywny', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: isActive ? Ls.bg : const Color(0xFFC9D0DC))),
                    ),
                  ]),
                  const SizedBox(height: 6),
                  Wrap(spacing: 8, runSpacing: 2, children: [
                    for (final (name, v) in parts)
                      Text('$name +${v ?? 0}', style: TextStyle(fontSize: 12, color: asNum(v ?? 0) > 0 ? Ls.text : Ls.textFaint, fontWeight: asNum(v ?? 0) > 0 ? FontWeight.w600 : FontWeight.w400)),
                  ]),
                ]),
              ),
            ),
          ),
        ),
      );
    }

    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: tile(1)), const SizedBox(width: 8), Expanded(child: tile(2))]),
    );
  }
}

class _SlotTile extends StatelessWidget {
  const _SlotTile({required this.slot, required this.item, required this.inBoth, required this.selected, required this.onTap});
  final String slot;
  final Map<String, dynamic>? item;
  final bool inBoth;
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
      label: it == null ? '$name: pusto' : '$name: ${it['name']}, ${profileText(it)}, wytrzymałość $dw${inBoth ? ', w obu zestawach' : ''}',
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
              SlotIcon(it == null ? slot : iconSlotOf(it), color: it == null ? Ls.locked : Ls.copper),
              const SizedBox(height: 4),
              Text(name.toUpperCase(), style: const TextStyle(fontSize: 9, letterSpacing: 0.6, color: Ls.textFaint), textAlign: TextAlign.center),
              const SizedBox(height: 2),
              Expanded(
                  child: Text(it == null ? 'pusto' : '${it['name']}',
                      textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: it == null ? Ls.textMuted : Ls.text))),
              if (inBoth) const Text('⇄ w obu', style: TextStyle(fontSize: 10, color: Ls.teal)),
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
  const _ItemCard({required this.it, required this.state, required this.reload, required this.active, required this.editing});
  final Map<String, dynamic> it;
  final AppState state;
  final Future<void> Function() reload;
  final int active;
  final int editing;

  @override
  Widget build(BuildContext context) {
    final id = it['id'] as String;
    final inLo = inLoadoutsOf(it, active);
    final equipped = inLo.contains(editing);
    final other = editing == 1 ? 2 : 1;
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
          Expanded(child: Text('${(slotNames[it['slot']] ?? '${it['slot']}').toUpperCase()}${equipped ? ' · W ZESTAWIE ${loadoutName(editing)}' : ''}', style: _section)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(border: Border.all(color: Ls.teal), borderRadius: BorderRadius.circular(10)),
            child: Text('jakość ${it['quality']}', style: const TextStyle(fontSize: 12, color: Ls.teal)),
          ),
        ]),
        const SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text('${it['name']}', style: _display.copyWith(fontSize: 19)),
          if (it['rarity'] is Map)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(border: Border.all(color: Ls.copper.withValues(alpha: 0.6)), borderRadius: BorderRadius.circular(9)),
              child: Text(rarityText(it['rarity']), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Ls.copper)),
            ),
        ]),
        const SizedBox(height: 4),
        Text(profileText(it, long: true), style: const TextStyle(fontSize: 13, color: Ls.text)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 4, children: [
          for (final n in [1, 2])
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: inLo.contains(n)
                  ? BoxDecoration(color: const Color(0xFF1A2230), borderRadius: BorderRadius.circular(9))
                  : BoxDecoration(border: Border.all(color: Ls.locked), borderRadius: BorderRadius.circular(9)),
              child: Text(inLo.contains(n) ? '✓ w zestawie ${loadoutName(n)}' : '○ nie ma w zestawie ${loadoutName(n)}', style: TextStyle(fontSize: 11, color: inLo.contains(n) ? const Color(0xFFC9D0DC) : Ls.textMuted)),
            ),
        ]),
        const SizedBox(height: 8),
        Semantics(
          container: true,
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
        if (next != null && next['techDone'] == false) ...[
          const SizedBox(height: 8),
          Text('Wymaga badania: ${next['techName'] ?? next['tech']}', style: const TextStyle(fontSize: 12, color: Ls.warnText)),
        ],
        const SizedBox(height: 10),
        Wrap(spacing: 6, runSpacing: 6, children: [
          OutlinedButton(
            onPressed: busy || (broken && !equipped) ? null : () => act(state, () => state.api.post('/items/$id/${equipped ? 'unequip' : 'equip'}', body: {'loadout': editing}, idempotent: true), reload),
            style: outlined(Ls.locked),
            child: Text('${equipped ? 'Zdejmij z' : 'Załóż w'} ${loadoutName(editing)}'),
          ),
          if (equipped && !inLo.contains(other) && !broken)
            OutlinedButton(
              onPressed: busy ? null : () => act(state, () => state.api.post('/items/$id/equip', body: {'loadout': other}, idempotent: true), reload),
              style: outlined(Ls.copper),
              child: Text('Załóż też w ${loadoutName(other)}'),
            ),
          if (repair > 0)
            OutlinedButton(
              onPressed: busy ? null : () => act(state, () => state.api.post('/items/$id/repair', idempotent: true), reload, ctx: context, okText: 'Naprawiono'),
              style: outlined(Ls.copper),
              child: Text('Napraw · ${fmtInt(repair)} rudy'),
            ),
          if (next != null)
            FilledButton(
              onPressed: busy || next['techDone'] == false
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
  const _InventoryRow({required this.it, required this.active, required this.selected, required this.onTap});
  final Map<String, dynamic> it;
  final int active;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final maxDur = asNum(it['maxDurability']);
    final frac = (maxDur > 0 ? asNum(it['durability']) / maxDur : 0.0).toDouble();
    final (dc, dw) = _durability(frac, it['broken'] == true);
    final inLo = inLoadoutsOf(it, active);
    return Semantics(
      button: true,
      selected: selected,
      label: '${it['name']}, ${it['rarity'] is Map ? '${(it['rarity'] as Map)['name']}, ' : ''}${slotNames[it['slot']] ?? it['slot']}${inLo.isEmpty ? '' : ', w zestawie ${membershipText(inLo)}'}, wytrzymałość $dw',
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
                  SlotIcon(iconSlotOf(it), color: Ls.copper),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${it['name']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
                      Text('${it['rarity'] is Map ? '${rarityText(it['rarity'])} · ' : ''}${profileText(it)} · wzmocnienie ${it['tier']}/${it['maxTier']}', style: const TextStyle(fontSize: 11, color: Ls.textMuted)),
                    ]),
                  ),
                  if (inLo.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(right: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(color: Ls.copper.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                      child: Text(membershipText(inLo), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Ls.copper)),
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
    final chips = <(String?, String, bool)>[
      if (locked) ...[
        if (r['needsTech'] != null) (null, 'Wymaga badania', false),
        (null, 'Warsztat poz. ${r['workshop']}', true),
        if (r['radio'] != null) (null, 'Radiostacja poz. ${r['radio']}', true),
      ] else ...[
        if (asNum(r['ore']) > 0) ('ore', '${fmtInt(asNum(r['ore']))} rudy', have('ore', asNum(r['ore']))),
        if (asNum(r['tokens']) > 0) ('tokens', '${fmtInt(asNum(r['tokens']))} żet.', have('tokens', asNum(r['tokens']))),
        for (final e in ((r['materials'] as Map?) ?? const {}).entries) (e.key as String, '${e.value} ${resName(e.key as String)}', have(e.key as String, e.value as num)),
      ],
    ];
    final affordable = chips.every((c) => c.$3);
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
            Text('${profileText(r)} · ${r['durability']} wytrz. · ${slotNames[r['slot']] ?? r['slot']}', style: const TextStyle(fontSize: 11, color: Ls.textMuted)),
            const SizedBox(height: 4),
            Wrap(spacing: 4, runSpacing: 4, children: [
              for (final (res, t, ok) in chips) LsResChip(res, t, ok: ok),
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
          final icon = SlotIcon(iconSlotOf(r), color: locked ? Ls.locked : Ls.copper, size: 26);
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
