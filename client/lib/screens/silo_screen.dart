import 'dart:async';

import 'package:flutter/material.dart';
import '../app_state.dart';
import '../building_art.dart';
import '../format.dart';
import '../palette.dart';
import '../strings.dart';

/// Silos jako przekrój (docs/warstwa-wizualna-v1.0.md §3): zasoby, powierzchnia, linia gruntu i pomieszczenia
/// pod ziemią. Logika bez zmian: dane z `/silo`, ulepszenie przez `state.upgrade`, odświeżenie pociągnięciem.
class SiloScreen extends StatelessWidget {
  final AppState state;
  const SiloScreen({super.key, required this.state});

  /// Rozmieszczenie budynków w przekroju (prezentacja). Typy spoza list trafiają pod ziemię na koniec.
  static const _surface = ['wartownia', 'szyb_glowny', 'radiostacja'];
  static const _underground = ['generator_pary', 'magazyn', 'warsztat', 'laboratorium'];

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final s = state.silo;
        if (s == null) return const ColoredBox(color: Ls.bg, child: Center(child: CircularProgressIndicator()));
        final player = s['player'] as Map;
        final wallet = s['wallet'] as Map;
        final caps = s['caps'] as Map;
        final rates = s['rates'] as Map;
        final job = s['job'] as Map?;
        final buildings = (s['buildings'] as List).cast<Map>();
        final ore = (wallet['ore'] as num).toInt();
        Map? byType(String t) => buildings.where((b) => b['type'] == t).firstOrNull;
        final rooms = [
          for (final t in _underground)
            if (byType(t) case final b?) b,
          ...buildings.where((b) => !_surface.contains(b['type']) && !_underground.contains(b['type'])),
        ];
        final ctl = _UpgradeCtl(state: state, ore: ore, job: job);

        return LsTheme(
          child: ColoredBox(
            color: Ls.bg,
            child: RefreshIndicator(
              onRefresh: state.refresh,
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _Hud(wallet: wallet, caps: caps, rates: rates),
                  _PlayerStrip(player: player),
                  if (s['windedUntil'] != null) _Banner(icon: Icons.air, text: 'Wyczerpany, odpoczywasz jeszcze ', endsAt: parseTime(s['windedUntil']), onDone: state.refresh),
                  if (s['protectedUntil'] != null) _Banner(icon: Icons.shield_outlined, text: 'Ochrona przed najazdami: ', endsAt: parseTime(s['protectedUntil']), onDone: state.refresh),
                  _Surface(buildings: [for (final t in _surface) byType(t)], ctl: ctl),
                  const _Ground(),
                  _Underground(children: [for (final b in rooms) _RoomCard(b: b, ctl: ctl)]),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Wspólna logika przycisku ulepszenia (ta sama co wcześniej w `_BuildingTile`).
class _UpgradeCtl {
  _UpgradeCtl({required this.state, required this.ore, required this.job});
  final AppState state;
  final int ore;
  final Map? job;

  bool upgrading(Map b) => job != null && job!['type'] == b['type'];
  bool canUpgrade(Map b) {
    final cost = ((b['next'] as Map?)?['cost'] as num?)?.toInt();
    return cost != null && !state.busy && job == null && ore >= cost;
  }

  void upgrade(Map b) => state.upgrade(b['type'] as String);
}

const _display = TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, color: Ls.text);

class _Hud extends StatelessWidget {
  const _Hud({required this.wallet, required this.caps, required this.rates});
  final Map wallet;
  final Map caps;
  final Map rates;

  @override
  Widget build(BuildContext context) {
    final items = <(String, String, String?)>[
      ('RUDA', '${fmtInt(wallet['ore'] as num)} / ${fmtInt(caps['ore'] as num)}', '+${rates['orePerHour']}/h'),
      ('PARA', '${fmtInt(wallet['steam'] as num)} / ${fmtInt(caps['steam'] as num)}', '+${rates['steamPerMin']}/min'),
      ('ŻETONY', fmtInt(wallet['tokens'] as num), null),
      ('PRÓBKI', fmtInt(wallet['samples'] as num), null),
      for (final m in materialIds)
        if (wallet[m] != null && (wallet[m] as num) > 0) (resName(m).toUpperCase(), fmtInt(wallet[m] as num), null),
    ];
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(color: Ls.panel, border: Border(bottom: BorderSide(color: Ls.border))),
      child: Wrap(spacing: 18, runSpacing: 8, children: [
        for (final (label, value, sub) in items)
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: const TextStyle(fontSize: 10, letterSpacing: 1.2, color: Ls.textFaint)),
            Text(value, style: _display.copyWith(fontSize: 15, fontFeatures: const [FontFeature.tabularFigures()])),
            if (sub != null) Text(sub, style: const TextStyle(fontSize: 10, color: Ls.textFaint)),
          ]),
      ]),
    );
  }
}

class _PlayerStrip extends StatelessWidget {
  const _PlayerStrip({required this.player});
  final Map player;

  @override
  Widget build(BuildContext context) {
    final xp = (player['xp'] as num).toDouble();
    final next = player['xpToNext'] as num?;
    final arch = archetypeInfo[player['archetype']]?.$1 ?? '';
    final free = (player['freePoints'] as num).toInt();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${player['nickname']}  ·  $arch  ·  poziom ${player['level']}', style: _display.copyWith(fontSize: 16)),
        if (next != null) ...[
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(value: next > 0 ? (xp / next).clamp(0.0, 1.0) : 0, minHeight: 6, color: Ls.amber, backgroundColor: Ls.border),
          ),
          const SizedBox(height: 4),
          Text('XP ${fmtInt(xp)} / ${fmtInt(next)}', style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
        ],
        if (free > 0) Text('Wolne punkty cech: $free', style: const TextStyle(fontSize: 13, color: Ls.amber)),
      ]),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.text, required this.endsAt, required this.onDone});
  final IconData icon;
  final String text;
  final DateTime endsAt;
  final Future<void> Function() onDone;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Ls.chip, borderRadius: BorderRadius.circular(12), border: Border.all(color: Ls.border)),
        child: Row(children: [
          Icon(icon, color: Ls.amber),
          const SizedBox(width: 12),
          Flexible(child: Text(text, style: const TextStyle(color: Ls.text))),
          Countdown(endsAt: endsAt, onDone: onDone, style: const TextStyle(color: Ls.amber, fontWeight: FontWeight.w600)),
        ]),
      );
}

/// Pas powierzchni: Szyb główny w środku (skala 1), Wartownia i Radiostacja po bokach (0.75). Dotknięcie = szczegóły.
class _Surface extends StatelessWidget {
  const _Surface({required this.buildings, required this.ctl});
  final List<Map?> buildings;
  final _UpgradeCtl ctl;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF1B2433), Color(0xFF10141D)])),
      padding: const EdgeInsets.fromLTRB(8, 12, 8, 4),
      child: LayoutBuilder(builder: (context, c) {
        // szerokości 120 + 160 + 120 (skala 0.75 / 1 / 0.75) i odstępy muszą się zmieścić; na szerokich ekranach nie rosną bez końca
        final unit = ((c.maxWidth - 12) / 400).clamp(0.0, 1.3);
        return Row(crossAxisAlignment: CrossAxisAlignment.end, mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
          for (var i = 0; i < buildings.length; i++)
            if (buildings[i] != null) _SurfaceBuilding(b: buildings[i]!, width: 160 * unit * (i == 1 ? 1.0 : 0.75), ctl: ctl),
        ]);
      }),
    );
  }
}

class _SurfaceBuilding extends StatelessWidget {
  const _SurfaceBuilding({required this.b, required this.width, required this.ctl});
  final Map b;
  final double width;
  final _UpgradeCtl ctl;

  @override
  Widget build(BuildContext context) {
    final level = (b['level'] as num).toInt();
    return SizedBox(
        width: width,
        child: Semantics(
          button: true,
          label: '${b['name']}, poziom $level z ${b['maxLevel']}${ctl.upgrading(b) ? ', ulepszanie w toku' : ''}',
          excludeSemantics: true,
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => _showDetails(context, b, ctl),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              BuildingArt.fromApi(b['type'] as String, level, width: width),
              Text('${b['name']}', style: const TextStyle(fontSize: 12, color: Ls.text), textAlign: TextAlign.center),
              Text(ctl.upgrading(b) ? 'ulepszanie…' : 'poz. $level', style: TextStyle(fontSize: 11, color: ctl.upgrading(b) ? Ls.amber : Ls.textMuted)),
              const SizedBox(height: 4),
            ]),
          ),
        ));
  }
}

void _showDetails(BuildContext context, Map b, _UpgradeCtl ctl) {
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: Ls.panel,
    builder: (_) => ListenableBuilder(
      listenable: ctl.state,
      builder: (context, _) {
        // po ulepszeniu stan się zmienia: bierzemy świeży wpis z `/silo`
        final fresh = ((ctl.state.silo?['buildings'] as List?)?.cast<Map>() ?? const []).where((x) => x['type'] == b['type']).firstOrNull ?? b;
        final wallet = ctl.state.silo?['wallet'] as Map?;
        final live = _UpgradeCtl(state: ctl.state, ore: (wallet?['ore'] as num?)?.toInt() ?? ctl.ore, job: ctl.state.silo?['job'] as Map?);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Row(children: [
              BuildingArt.fromApi(fresh['type'] as String, (fresh['level'] as num).toInt(), width: 120),
              const SizedBox(width: 12),
              Expanded(child: _RoomInfo(b: fresh, ctl: live)),
            ]),
          ),
        );
      },
    ),
  );
}

class _Ground extends StatelessWidget {
  const _Ground();
  @override
  Widget build(BuildContext context) => const SizedBox(height: 6, child: ColoredBox(color: Color(0xFF3A2A1E)));
}

/// Pod ziemią: szyb windy po lewej jako dekoracja, karty pomieszczeń po prawej.
class _Underground extends StatelessWidget {
  const _Underground({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF171B26), Color(0xFF0E1118)])),
      padding: const EdgeInsets.only(bottom: 16),
      child: IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const ExcludeSemantics(child: _Elevator()),
          const SizedBox(width: 10),
          Expanded(child: Column(children: children)),
          const SizedBox(width: 8),
        ]),
      ),
    );
  }
}

class _Elevator extends StatelessWidget {
  const _Elevator();
  @override
  Widget build(BuildContext context) => Container(
        width: 22,
        margin: const EdgeInsets.only(left: 8),
        decoration: const BoxDecoration(color: Ls.bg, border: Border.symmetric(vertical: BorderSide(color: Ls.steel, width: 2))),
        alignment: const Alignment(0, -0.2),
        child: Container(width: 12, height: 16, decoration: BoxDecoration(color: Ls.copper, borderRadius: BorderRadius.circular(2))),
      );
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({required this.b, required this.ctl});
  final Map b;
  final _UpgradeCtl ctl;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      constraints: const BoxConstraints(minHeight: 128),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: Ls.card, border: Border.all(color: Ls.border), borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        BuildingArt.fromApi(b['type'] as String, (b['level'] as num).toInt(), width: 132),
        const SizedBox(width: 10),
        Expanded(child: _RoomInfo(b: b, ctl: ctl)),
      ]),
    );
  }
}

/// Nazwa, poziom i przycisk ulepszenia albo postęp trwającego ulepszania.
class _RoomInfo extends StatelessWidget {
  const _RoomInfo({required this.b, required this.ctl});
  final Map b;
  final _UpgradeCtl ctl;

  @override
  Widget build(BuildContext context) {
    final next = b['next'] as Map?;
    final cost = (next?['cost'] as num?)?.toInt();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Text('${b['name']}', style: _display.copyWith(fontSize: 16)),
      const SizedBox(height: 2),
      Text('poz. ${b['level']} z ${b['maxLevel']}', style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
      const SizedBox(height: 8),
      if (ctl.upgrading(b))
        _JobProgress(job: ctl.job!, totalSeconds: (next?['seconds'] as num?)?.toInt(), onDone: ctl.state.refresh)
      else if (next == null)
        const Text('Maksymalny poziom', style: TextStyle(fontSize: 13, color: Ls.textMuted))
      else ...[
        ConstrainedBox(
          // minimalna, nie stała wysokość: przy dużej czcionce przycisk rośnie zamiast ucinać tekst
          constraints: const BoxConstraints(minHeight: 44, minWidth: double.infinity),
          child: OutlinedButton(
            onPressed: ctl.canUpgrade(b) ? () => ctl.upgrade(b) : null,
            style: OutlinedButton.styleFrom(
              foregroundColor: Ls.text,
              backgroundColor: const Color(0xFF1A1410),
              side: BorderSide(color: ctl.canUpgrade(b) ? Ls.copper : Ls.border),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            ),
            child: Text('Ulepsz · ${fmtInt(cost!)} rudy', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          ),
        ),
        const SizedBox(height: 4),
        Text('Poz. ${next['level']}: ${fmtDuration((next['seconds'] as num).toInt())}', style: const TextStyle(fontSize: 11, color: Ls.textFaint)),
      ],
    ]);
  }
}

/// „Ulepszanie do poz. n · odliczanie” i pasek postępu. Czas całkowity z API (`next.seconds` budowanego poziomu).
class _JobProgress extends StatefulWidget {
  const _JobProgress({required this.job, required this.totalSeconds, required this.onDone});
  final Map job;
  final int? totalSeconds;
  final Future<void> Function() onDone;
  @override
  State<_JobProgress> createState() => _JobProgressState();
}

class _JobProgressState extends State<_JobProgress> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final endsAt = parseTime(widget.job['endsAt']);
    final total = widget.totalSeconds;
    final left = endsAt.difference(DateTime.now()).inSeconds;
    final pct = (total == null || total <= 0) ? null : (1 - left / total).clamp(0.0, 1.0);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Wrap(children: [
        Text('Ulepszanie do poz. ${widget.job['toLevel']} · ', style: const TextStyle(fontSize: 12, color: Ls.amber)),
        Countdown(endsAt: endsAt, onDone: widget.onDone, style: const TextStyle(fontSize: 12, color: Ls.amber, fontFeatures: [FontFeature.tabularFigures()])),
      ]),
      const SizedBox(height: 6),
      ClipRRect(
        borderRadius: BorderRadius.circular(3),
        child: LinearProgressIndicator(value: pct?.toDouble(), minHeight: 6, color: Ls.amber, backgroundColor: Ls.border),
      ),
    ]);
  }
}
