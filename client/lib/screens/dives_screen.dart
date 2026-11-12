import 'dart:async';

import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';
import '../widgets.dart';

/// Zjazdy jako „szyb zjazdowy” (makieta Zjazdy.dc.html): kolejka z kabinami w drodze, trasy według głębokości
/// przy skali stref i ostatnie wyniki. Logika bez zmian: trasy, kolejka i historia z AppState, start przez `state.startDive`.
class DivesScreen extends StatelessWidget {
  final AppState state;
  const DivesScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final s = state.silo;
        if (s == null) return const ColoredBox(color: Ls.bg, child: Center(child: CircularProgressIndicator()));
        final wallet = s['wallet'] as Map;
        final caps = s['caps'] as Map;
        final rates = s['rates'] as Map;
        final steam = (wallet['steam'] as num).toInt();
        final queue = (s['queue'] as List).cast<Map>();
        final slots = (s['queueSlots'] as num).toInt();
        final extraMax = (s['queueExtraMaxSeconds'] as num?)?.toInt();
        final winded = s['windedUntil'] != null;
        final full = queue.length >= slots;
        String routeName(String id) => state.routes.where((r) => r['id'] == id).firstOrNull?['name'] as String? ?? id;

        String? prevZone;
        final rows = <Widget>[];
        for (final r in state.routes) {
          final zone = r['zone'] as String? ?? '';
          if (zone != prevZone) {
            rows.add(_ZoneLabel(zone: zone, first: prevZone == null));
            prevZone = zone;
          }
          rows.add(_RouteRow(r: r, steam: steam, blocked: full || winded, state: state));
        }

        return LsTheme(
          child: ColoredBox(
            color: Ls.bg,
            child: RefreshIndicator(
              onRefresh: state.refresh,
              child: ListView(
                padding: const EdgeInsets.only(bottom: 16),
                children: [
                  _Header(steam: steam, cap: (caps['steam'] as num).toInt(), rate: rates['steamPerMin']),
                  _LoadoutStrip(active: asNum((s['player'] as Map?)?['activeLoadout'] ?? 1).toInt() == 2 ? 2 : 1, state: state),
                  _Queue(queue: queue, slots: slots, extraMax: extraMax, routeName: routeName, state: state),
                  if (winded)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: Row(children: [
                        const Icon(Icons.air, size: 18, color: Ls.amber),
                        const SizedBox(width: 8),
                        const Flexible(child: Text('Wyczerpany, nie dodasz zjazdu jeszcze przez ', style: TextStyle(color: Ls.text, fontSize: 13))),
                        Countdown(endsAt: parseTime(s['windedUntil']), onDone: state.refresh, style: const TextStyle(color: Ls.amber, fontWeight: FontWeight.w600, fontSize: 13)),
                      ]),
                    ),
                  const SizedBox(height: 8),
                  ...rows,
                  if (state.history.isNotEmpty) _History(history: state.history, routeName: routeName),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

const _display = TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, color: Ls.text);
const _zones = {'gorne': ('GÓRNE', Ls.amber), 'glebokie': ('GŁĘBOKIE', Ls.teal), 'jadro': ('RDZEŃ', Ls.violet)};
Color _zoneColor(String z) => _zones[z]?.$2 ?? Ls.textMuted;

/// Czas trasy krótko: „3 min”, „1 h”, „4 h 30 min”.
String _dur(int s) {
  final h = s ~/ 3600, m = ((s % 3600) / 60).round();
  if (h > 0) return m > 0 ? '$h h $m min' : '$h h';
  return '$m min';
}

/// Przedział z API ([min, max]) jako „5–7”; `null`, gdy trasa nic nie daje.
String? _range(Object? v) {
  if (v is! List || v.length < 2) return null;
  final a = (v[0] as num).toInt(), b = (v[1] as num).toInt();
  if (b <= 0) return null;
  return a == b ? fmtInt(a) : '${fmtInt(a)}–${fmtInt(b)}';
}

class _Header extends StatelessWidget {
  const _Header({required this.steam, required this.cap, required this.rate});
  final int steam;
  final int cap;
  final Object? rate;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Zjazdy', style: _display.copyWith(fontSize: 24)),
              const SizedBox(height: 4),
              const Text('Wybierz trasę. Głębiej: więcej rudy, mniejsza szansa.', style: TextStyle(fontSize: 12, color: Ls.textMuted)),
            ]),
          ),
          const SizedBox(width: 12),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            const Text('PARA', style: TextStyle(fontSize: 10, letterSpacing: 1.2, color: Ls.textFaint)),
            Text('${fmtInt(steam)} / ${fmtInt(cap)}', style: _display.copyWith(fontSize: 17, fontFeatures: const [FontFeature.tabularFigures()])),
            Text('+$rate/min', style: const TextStyle(fontSize: 10, color: Ls.textFaint)),
          ]),
        ]),
      );
}

/// Którym zestawem pójdzie nowy zjazd (zapisuje się przy dodaniu do kolejki) i szybka zmiana zestawu.
class _LoadoutStrip extends StatelessWidget {
  const _LoadoutStrip({required this.active, required this.state});
  final int active;
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final other = active == 1 ? 2 : 1;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      decoration: BoxDecoration(color: Ls.card, border: Border.all(color: Ls.border), borderRadius: BorderRadius.circular(14)),
      child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 6, children: [
        Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text('Zjazd pójdzie zestawem ${loadoutName(active)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
          const Text('zestaw zapisuje się przy dodaniu do kolejki', style: TextStyle(fontSize: 11, color: Ls.textMuted)),
        ]),
        OutlinedButton(
          onPressed: state.busy ? null : () => act(state, () => state.api.post('/loadouts/$other/activate', idempotent: true), state.refresh, ctx: context, okText: 'Aktywny zestaw ${loadoutName(other)}'),
          style: OutlinedButton.styleFrom(
            foregroundColor: Ls.text,
            side: const BorderSide(color: Ls.locked),
            minimumSize: const Size(0, 44),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
          child: Text('Zmień na ${loadoutName(other)}'),
        ),
      ]),
    );
  }
}

/// Kolejka: zajęte miejsca (w drodze / czeka) i wolne. Miejsce ponad dwa z subskrypcji przyjmuje tylko krótkie trasy.
class _Queue extends StatelessWidget {
  const _Queue({required this.queue, required this.slots, required this.extraMax, required this.routeName, required this.state});
  final List<Map> queue;
  final int slots;
  final int? extraMax;
  final String Function(String) routeName;
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Ls.panel, border: Border.all(color: Ls.border), borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(alignment: WrapAlignment.spaceBetween, spacing: 8, runSpacing: 4, children: [
          Text('KOLEJKA ${queue.length} / $slots', style: const TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.6, color: Ls.copper)),
          const Text('zjazdy idą jeden po drugim', style: TextStyle(fontSize: 11, color: Ls.textFaint)),
        ]),
        for (var i = 0; i < slots; i++) ...[
          const SizedBox(height: 8),
          if (i < queue.length)
            _QueueSlot(q: queue[i], name: routeName(queue[i]['routeId'] as String), onDone: state.refresh)
          else
            _FreeSlot(note: i >= 2 && extraMax != null ? 'miejsce Wygody: trasy do ${_dur(extraMax!)}' : 'dodaj trasę, ruszy po poprzedniej'),
        ],
      ]),
    );
  }
}

class _QueueSlot extends StatefulWidget {
  const _QueueSlot({required this.q, required this.name, required this.onDone});
  final Map q;
  final String name;
  final Future<void> Function() onDone;
  @override
  State<_QueueSlot> createState() => _QueueSlotState();
}

class _QueueSlotState extends State<_QueueSlot> {
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final running = widget.q['running'] == true;
    final ends = parseTime(widget.q['endsAt']);
    final starts = widget.q['startsAt'] == null ? null : parseTime(widget.q['startsAt']);
    final total = starts == null ? 0 : ends.difference(starts).inSeconds;
    final pct = running && total > 0 ? (DateTime.now().difference(starts!).inSeconds / total).clamp(0.0, 1.0) : 0.0;
    final c = running ? Ls.amber : Ls.textMuted;
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: const Color(0xFF141925), borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(color: c.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(8)),
          child: Icon(running ? Icons.south : Icons.hourglass_empty, size: 16, color: c),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text('${widget.name} · ${running ? 'w drodze' : 'czeka'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Ls.text))),
              Countdown(endsAt: ends, onDone: widget.onDone, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c, fontFeatures: const [FontFeature.tabularFigures()])),
            ]),
            const SizedBox(height: 5),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(value: running ? pct.toDouble() : 0, minHeight: 5, color: c, backgroundColor: Ls.border),
            ),
            const SizedBox(height: 4),
            Wrap(spacing: 8, runSpacing: 2, children: [
              Text(running ? 'wynik po powrocie' : 'ruszy po poprzednim zjeździe', style: const TextStyle(fontSize: 11, color: Ls.textMuted)),
              if (widget.q['loadout'] != null) Text('zestaw ${loadoutName(widget.q['loadout'])}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Ls.copper)),
            ]),
          ]),
        ),
      ]),
    );
  }
}

class _FreeSlot extends StatelessWidget {
  const _FreeSlot({required this.note});
  final String note;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(border: Border.all(color: const Color(0xFF2B3546)), borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          const SizedBox(width: 28, height: 28, child: Icon(Icons.south, size: 16, color: Ls.locked)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Wolne miejsce', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Ls.textMuted)),
              Text(note, style: const TextStyle(fontSize: 11, color: Ls.textFaint)),
            ]),
          ),
        ]),
      );
}

/// Odcinek skali stref po lewej (szyn głębokości) + treść wiersza.
class _Railed extends StatelessWidget {
  const _Railed({required this.zone, required this.child, this.top = false});
  final String zone;
  final Widget child;
  final bool top;
  @override
  Widget build(BuildContext context) {
    final c = _zoneColor(zone);
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SizedBox(width: 16),
        ExcludeSemantics(
          child: Container(
            width: 22,
            decoration: BoxDecoration(
              gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [c.withValues(alpha: 0.33), c.withValues(alpha: 0.13)]),
              border: const Border.symmetric(vertical: BorderSide(color: Ls.border)),
              borderRadius: top ? const BorderRadius.vertical(top: Radius.circular(11)) : null,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(child: child),
        const SizedBox(width: 12),
      ]),
    );
  }
}

class _ZoneLabel extends StatelessWidget {
  const _ZoneLabel({required this.zone, required this.first});
  final String zone;
  final bool first;
  @override
  Widget build(BuildContext context) {
    final (name, color) = _zones[zone] ?? (zone.toUpperCase(), Ls.textMuted);
    return _Railed(
      zone: zone,
      top: first,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(0, 8, 0, 8),
        child: Semantics(header: true, child: Text('STREFA $name', style: TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.6, color: color))),
      ),
    );
  }
}

class _RouteRow extends StatelessWidget {
  const _RouteRow({required this.r, required this.steam, required this.blocked, required this.state});
  final Map r;
  final int steam;
  final bool blocked;
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final zone = r['zone'] as String? ?? '';
    final c = _zoneColor(zone);
    final locked = r['locked'] == true;
    final cost = (r['steam'] as num).toInt();
    final chance = (r['chancePct'] as num).toInt();
    final enough = steam >= cost;
    final chips = <(String?, String)>[
      ('ore', '${_range(r['ore']) ?? '0'} rudy'),
      (null, '${r['xp']} XP'),
      if (_range(r['tokens']) case final t?) ('tokens', '$t żet.'),
      if (_range(r['samples']) case final p?) ('samples', 'próbki $p'),
      if (richnessNames[r['zoneRichness']] case final rich?) (null, rich),
    ];
    final enabled = !locked && enough && !blocked && !state.busy;
    final label = locked ? 'Zablokowane · od poziomu ${r['minLevel']}' : (enough ? 'Zjedź · $cost pary' : 'Brak pary ($cost)');

    return _Railed(
      zone: zone,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Opacity(
          opacity: locked ? 0.55 : 1,
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            decoration: BoxDecoration(color: Ls.card, border: Border.all(color: locked ? const Color(0xFF1A2130) : Ls.border), borderRadius: BorderRadius.circular(14)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.end, spacing: 8, children: [
                Text('${r['name']}', style: _display.copyWith(fontSize: 15)),
                Text('${_dur((r['seconds'] as num).toInt())} · $cost pary', style: const TextStyle(fontSize: 11, color: Ls.textMuted, fontFeatures: [FontFeature.tabularFigures()])),
              ]),
              const SizedBox(height: 7),
              Row(children: [
                Expanded(
                  child: ExcludeSemantics(
                    child: ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(value: chance / 100, minHeight: 6, color: c, backgroundColor: Ls.border)),
                  ),
                ),
                const SizedBox(width: 8),
                Text('szansa $chance%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Ls.text)),
              ]),
              const SizedBox(height: 7),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final (res, t) in chips) LsResChip(res, t),
              ]),
              const SizedBox(height: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44, minWidth: double.infinity),
                child: enabled
                    ? FilledButton(
                        onPressed: () => state.startDive(r['id'] as String),
                        style: FilledButton.styleFrom(
                          backgroundColor: c,
                          foregroundColor: Ls.bg,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                        child: Text(label, textAlign: TextAlign.center),
                      )
                    : OutlinedButton(
                        onPressed: null,
                        style: OutlinedButton.styleFrom(
                          disabledForegroundColor: Ls.textMuted,
                          side: const BorderSide(color: Ls.locked),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                        child: Text(!locked && enough && blocked ? (state.busy ? label : 'Kolejka pełna') : label, textAlign: TextAlign.center),
                      ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _History extends StatelessWidget {
  const _History({required this.history, required this.routeName});
  final List<Map<String, dynamic>> history;
  final String Function(String) routeName;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
      decoration: BoxDecoration(color: Ls.panel, border: Border.all(color: Ls.border), borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('OSTATNIE ZJAZDY', style: TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.6, color: Ls.copper)),
        const SizedBox(height: 6),
        for (final h in history)
          if (h['result'] is Map) _HistoryLine(res: h['result'] as Map, name: routeName(h['routeId'] as String)),
      ]),
    );
  }
}

class _HistoryLine extends StatelessWidget {
  const _HistoryLine({required this.res, required this.name});
  final Map res;
  final String name;
  @override
  Widget build(BuildContext context) {
    final ok = res['success'] == true;
    final mats = (res['materials'] as Map?) ?? const {};
    final parts = <String>[
      '${ok ? '+' : ''}${fmtInt(res['ore'] as num)} rudy',
      if ((res['tokens'] as num) > 0) '${res['tokens']} żet.',
      if ((res['samples'] as num) > 0) '${res['samples']} prób.',
      for (final e in mats.entries) '${e.value} ${resourceNames[e.key] ?? e.key}',
      '${res['xp']} XP',
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // znak i słowo, nie tylko kolor
        Text(ok ? '✓' : '✗', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: ok ? const Color(0xFF9CE0B5) : Ls.warnText)),
        const SizedBox(width: 8),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$name · ${ok ? 'udany' : 'nieudany'}${res['levelUp'] == true ? ' · awans! poz. ${res['level']}' : ''}', style: const TextStyle(fontSize: 13, color: Ls.text, fontWeight: FontWeight.w600)),
            Text(parts.join(' · '), style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
          ]),
        ),
      ]),
    );
  }
}
