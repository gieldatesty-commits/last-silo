import 'dart:async';

import 'package:flutter/material.dart';
import '../app_state.dart';
import '../building_art.dart';
import '../format.dart';
import '../palette.dart';
import '../resource_art.dart';
import '../strings.dart';

/// Silos (docs/warstwa-wizualna-v1.0.md §3, zmienione 2026-11-11): wszystkie budynki jako jednakowe karty w siatce
/// 2 kolumn na tle przekroju (niebo, grunt, podziemie). Kabina windy w szybie po lewej jedzie razem z przewijaniem.
/// Logika bez zmian: dane z `/silo`, ulepszenie przez `state.upgrade`, odświeżenie pociągnięciem.
class SiloScreen extends StatefulWidget {
  final AppState state;
  const SiloScreen({super.key, required this.state});

  @override
  State<SiloScreen> createState() => _SiloScreenState();
}

class _SiloScreenState extends State<SiloScreen> {
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
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
        // kolejność jak w odpowiedzi serwera (config): Szyb, Generator, Magazyn, Warsztat, Wartownia, Laboratorium, Radiostacja
        final buildings = (s['buildings'] as List).cast<Map>();
        final ctl = _UpgradeCtl(state: state, ore: (wallet['ore'] as num).toInt(), job: job);

        return LsTheme(
          child: ColoredBox(
            color: Ls.bg,
            child: RefreshIndicator(
              onRefresh: state.refresh,
              child: ListView(
                controller: _scroll,
                padding: EdgeInsets.zero,
                children: [
                  _Hud(wallet: wallet, caps: caps, rates: rates),
                  _PlayerStrip(player: player),
                  if (s['windedUntil'] != null) _Banner(icon: Icons.air, text: 'Wyczerpany, odpoczywasz jeszcze ', endsAt: parseTime(s['windedUntil']), onDone: state.refresh),
                  if (s['protectedUntil'] != null) _Banner(icon: Icons.shield_outlined, text: 'Ochrona przed najazdami: ', endsAt: parseTime(s['protectedUntil']), onDone: state.refresh),
                  const _Sky(),
                  const _Ground(),
                  _Underground(scroll: _scroll, buildings: buildings, ctl: ctl),
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
    final items = <(String, String, String, String?)>[
      ('ore', 'RUDA', '${fmtInt(wallet['ore'] as num)} / ${fmtInt(caps['ore'] as num)}', '+${rates['orePerHour']}/h'),
      ('steam', 'PARA', '${fmtInt(wallet['steam'] as num)} / ${fmtInt(caps['steam'] as num)}', '+${rates['steamPerMin']}/min'),
      ('tokens', 'ŻETONY', fmtInt(wallet['tokens'] as num), null),
      ('samples', 'PRÓBKI', fmtInt(wallet['samples'] as num), null),
      for (final m in materialIds)
        if (wallet[m] != null && (wallet[m] as num) > 0) (m, resName(m).toUpperCase(), fmtInt(wallet[m] as num), null),
    ];
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(color: Ls.panel, border: Border(bottom: BorderSide(color: Ls.border))),
      child: Wrap(spacing: 18, runSpacing: 8, children: [
        for (final (res, label, value, sub) in items)
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Row(mainAxisSize: MainAxisSize.min, children: [
              ResourceIcon(res, size: 14),
              const SizedBox(width: 4),
              Text(label, style: const TextStyle(fontSize: 10, letterSpacing: 1.2, color: Ls.textFaint)),
            ]),
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

class _Ground extends StatelessWidget {
  const _Ground();
  @override
  Widget build(BuildContext context) => const SizedBox(height: 6, child: ColoredBox(color: Color(0xFF3A2A1E)));
}

/// Niebo nad Silosem: gwiazdy i sylwetka horyzontu (dekoracja).
class _Sky extends StatelessWidget {
  const _Sky();
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: SizedBox(height: 56, width: double.infinity, child: CustomPaint(painter: _SkyPainter())),
      );
}

class _SkyPainter extends CustomPainter {
  final Paint _bg = Paint();
  final Paint _star = Paint()..color = Ls.text.withValues(alpha: 0.45);
  final Paint _hill = Paint()..color = const Color(0xFF161C28);
  final Path _hills = Path();

  @override
  void paint(Canvas canvas, Size size) {
    _bg.shader = const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF1B2433), Color(0xFF10141D)]).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, _bg);
    for (final (x, y, r) in const [(0.15, 0.25, 1.0), (0.38, 0.12, 1.2), (0.66, 0.3, 1.0), (0.87, 0.15, 1.2), (0.52, 0.45, 0.8)]) {
      canvas.drawCircle(Offset(x * size.width, y * size.height), r, _star);
    }
    // sylwetka wzgórz (jak w makiecie Silos.dc.html, przeskalowana do szerokości)
    final w = size.width / 390, h = size.height;
    _hills
      ..reset()
      ..moveTo(0, h - 18)
      ..lineTo(70 * w, h - 28)
      ..lineTo(150 * w, h - 16)
      ..lineTo(230 * w, h - 32)
      ..lineTo(310 * w, h - 18)
      ..lineTo(390 * w, h - 30)
      ..lineTo(size.width, h)
      ..lineTo(0, h)
      ..close();
    canvas.drawPath(_hills, _hill);
  }

  @override
  bool shouldRepaint(_SkyPainter old) => false;
}

/// Podziemie: szyb windy po lewej i siatka kart (2 kolumny, karty w rzędzie równej wysokości).
class _Underground extends StatelessWidget {
  const _Underground({required this.scroll, required this.buildings, required this.ctl});
  final ScrollController scroll;
  final List<Map> buildings;
  final _UpgradeCtl ctl;

  static const _gap = 8.0;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF171B26), Color(0xFF0E1118)])),
      padding: const EdgeInsets.only(bottom: 16),
      child: Stack(children: [
        Positioned(left: 8, top: 0, bottom: 0, width: 22, child: ExcludeSemantics(child: _Elevator(scroll: scroll))),
        Padding(
          padding: const EdgeInsets.fromLTRB(40, 0, 8, 0),
          child: LayoutBuilder(builder: (context, c) {
            final colW = (c.maxWidth - _gap) / 2;
            return Column(children: [
              for (var i = 0; i < buildings.length; i += 2)
                Padding(
                  padding: const EdgeInsets.only(top: _gap),
                  child: IntrinsicHeight(
                    child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      SizedBox(width: colW, child: _BuildingCard(b: buildings[i], ctl: ctl, artWidth: colW - 20)),
                      const SizedBox(width: _gap),
                      SizedBox(width: colW, child: i + 1 < buildings.length ? _BuildingCard(b: buildings[i + 1], ctl: ctl, artWidth: colW - 20) : null),
                    ]),
                  ),
                ),
            ]);
          }),
        ),
      ]),
    );
  }
}

/// Szyb windy: lina i kabina. Pozycja kabiny = postęp przewijania ekranu (0 = góra, 1 = dół).
class _Elevator extends StatelessWidget {
  const _Elevator({required this.scroll});
  final ScrollController scroll;

  static const _cabin = 16.0;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: Ls.bg, border: Border.symmetric(vertical: BorderSide(color: Ls.steel, width: 2))),
      child: LayoutBuilder(builder: (context, c) {
        return ListenableBuilder(
          listenable: scroll,
          builder: (context, _) {
            var t = 0.0;
            if (scroll.hasClients && scroll.position.hasContentDimensions && scroll.position.maxScrollExtent > 0) {
              t = (scroll.position.pixels / scroll.position.maxScrollExtent).clamp(0.0, 1.0);
            }
            final top = 6 + t * (c.maxHeight - _cabin - 12);
            return Stack(clipBehavior: Clip.hardEdge, children: [
              Positioned(left: 8, top: 0, width: 2, height: top, child: const ColoredBox(color: Color(0x66E8E3D6))),
              Positioned(
                left: 3,
                top: top,
                width: 12,
                height: _cabin,
                child: DecoratedBox(decoration: BoxDecoration(color: Ls.copper, borderRadius: BorderRadius.circular(2))),
              ),
            ]);
          },
        );
      }),
    );
  }
}

/// Jednakowa karta budynku: grafika u góry, pod nią nazwa, poziom i ulepszenie.
class _BuildingCard extends StatelessWidget {
  const _BuildingCard({required this.b, required this.ctl, required this.artWidth});
  final Map b;
  final _UpgradeCtl ctl;
  final double artWidth;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
      decoration: BoxDecoration(
        color: Ls.card,
        border: Border.all(color: ctl.upgrading(b) ? Ls.amber.withValues(alpha: 0.6) : Ls.border),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: BuildingArt.fromApi(b['type'] as String, (b['level'] as num).toInt(), width: artWidth)),
        const SizedBox(height: 4),
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
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${b['name']}', style: _display.copyWith(fontSize: 15)),
      const SizedBox(height: 2),
      Text('poz. ${b['level']} z ${b['maxLevel']}', style: const TextStyle(fontSize: 12, color: Ls.textMuted)),
      const SizedBox(height: 8),
      const Spacer(),
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
