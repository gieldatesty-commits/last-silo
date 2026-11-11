import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../app_state.dart';
import '../building_art.dart';
import '../format.dart';
import '../palette.dart';
import '../ui.dart';
import '../widgets.dart';

/// Radio: radar sygnałów, nasłuch, namierzanie (kontakt) i nadawanie. Logika bez zmian:
/// GET /radio, POST /radio/broadcast, POST /radio/contact przez `act()` z Idempotency-Key.
class RadioScreen extends StatelessWidget {
  final AppState state;
  const RadioScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/radio'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final signals = asList(d['signals']);
        final receiver = d['receiver'] == true;
        final transmitter = d['transmitter'] == true;
        final cost = asNum(d['contactSteam']).toInt();
        final range = asNum(d['rangeKm']).toDouble();
        final level = asNum(d['level']).toInt();
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            children: [
              LsHeader('Radiostacja', subtitle: 'poz. $level · ${receiver ? 'zasięg ${fmtInt(range)} km' : 'bez odbiornika'}', leading: BuildingArt.fromApi('radiostacja', level, width: 96)),
              Wrap(spacing: 6, runSpacing: 6, children: [
                _Cap('Odbiornik', receiver),
                _Cap('Nadajnik', transmitter),
                _Cap('Szyfr', d['cipher'] == true),
                _Cap('Przekaźniki', d['relays'] == true),
              ]),
              const SizedBox(height: 12),
              LsCard(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                child: SwitchListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 10),
                  activeThumbColor: Ls.teal,
                  title: Text('Nadawanie', style: lsDisplay.copyWith(fontSize: 16)),
                  subtitle: Text(
                    transmitter ? (d['on'] == true ? 'Włączone: inni Cię słyszą i mogą namierzyć. Tylko nadający widzą ranking i mogą atakować.' : 'Wyłączone: jesteś niewidoczny, ale nie widzisz rankingu i nie atakujesz.') : 'Rozbuduj Radiostację, żeby nadawać.',
                    style: lsMuted,
                  ),
                  value: d['on'] == true,
                  onChanged: (!transmitter || state.busy)
                      ? null
                      : (v) => act(state, () async {
                            await state.api.post('/radio/broadcast', body: {'on': v});
                          }, reload),
                ),
              ),
              const SectionTitle('Nasłuch'),
              if (!receiver) const EmptyNote('Bez Odbiornika nic nie usłyszysz. Rozbuduj Radiostację.'),
              if (receiver) ...[
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 320),
                    child: AspectRatio(
                      aspectRatio: 1,
                      child: Semantics(
                        container: true,
                        label: signals.isEmpty ? 'Radar: cisza w eterze' : 'Radar: ${signals.length} sygnałów w zasięgu, lista poniżej',
                        excludeSemantics: true,
                        child: RepaintBoundary(child: CustomPaint(painter: RadarPainter(blips: radarBlips(signals, range)))),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                const Wrap(spacing: 14, runSpacing: 4, alignment: WrapAlignment.center, children: [
                  _Legend(filled: false, text: 'nieznany sygnał'),
                  _Legend(filled: true, text: 'namierzony'),
                ]),
                const SizedBox(height: 12),
                if (signals.isEmpty) const EmptyNote('Cisza w eterze. Nikt w zasięgu nie nadaje.'),
                for (final s in signals) _SignalCard(s: s, cost: cost, state: state, reload: reload),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _Cap extends StatelessWidget {
  const _Cap(this.name, this.on);
  final String name;
  final bool on;
  @override
  Widget build(BuildContext context) => Semantics(
        container: true,
        label: '$name: ${on ? 'jest' : 'brak'}',
        excludeSemantics: true,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: on ? Ls.teal.withValues(alpha: 0.14) : null,
            border: Border.all(color: on ? Ls.teal.withValues(alpha: 0.6) : Ls.locked),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text('${on ? '✓' : '○'} $name', style: TextStyle(fontSize: 12, color: on ? Ls.teal : Ls.textMuted)),
        ),
      );
}

class _Legend extends StatelessWidget {
  const _Legend({required this.filled, required this.text});
  final bool filled;
  final String text;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(shape: BoxShape.circle, color: filled ? Ls.teal : null, border: Border.all(color: filled ? Ls.teal : Ls.amber, width: 2)),
        ),
        const SizedBox(width: 6),
        Flexible(child: Text(text, style: const TextStyle(fontSize: 12, color: Ls.textMuted))),
      ]);
}

class _SignalCard extends StatelessWidget {
  const _SignalCard({required this.s, required this.cost, required this.state, required this.reload});
  final Map<String, dynamic> s;
  final int cost;
  final AppState state;
  final Future<void> Function() reload;
  @override
  Widget build(BuildContext context) {
    final known = s['contacted'] == true;
    return LsCard(
      border: known ? Ls.teal.withValues(alpha: 0.4) : null,
      child: LsActionRow(
        leading: Icon(known ? Icons.person_outline : Icons.settings_input_antenna, color: known ? Ls.teal : Ls.amber),
        body: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(known ? '${s['nickname']} · poz. ${s['level']}' : 'Nieznany sygnał', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
          Text('kierunek ${s['sector']} · ok. ${fmtInt(asNum(s['distanceKm']))} km', style: lsMuted),
        ]),
        action: known
            ? const LsChip('namierzony', color: Ls.teal)
            : LsButton(
                'Namierz · $cost pary',
                color: Ls.amber,
                expand: false,
                onPressed: state.busy ? null : () => act(state, () => state.api.post('/radio/contact', body: {'signalId': s['id']}, idempotent: true), reload, ctx: context, okText: 'Namierzono sygnał'),
              ),
      ),
    );
  }
}

/// Punkt na radarze w układzie biegunowym: kąt (radiany, 0 = północ, zgodnie z ruchem wskazówek) i promień 0..1.
@immutable
class RadarBlip {
  const RadarBlip(this.angle, this.radius, this.known);
  final double angle;
  final double radius;
  final bool known;
  @override
  bool operator ==(Object other) => other is RadarBlip && other.angle == angle && other.radius == radius && other.known == known;
  @override
  int get hashCode => Object.hash(angle, radius, known);
}

const _sectors = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/// Sygnały → punkty: kierunek z sektora (kolejne w tym samym sektorze rozsunięte o ±8°), odległość / zasięg.
List<RadarBlip> radarBlips(List<Map<String, dynamic>> signals, double rangeKm) {
  final perSector = <String, int>{};
  return [
    for (final s in signals)
      () {
        final sec = '${s['sector']}';
        final i = perSector[sec] = (perSector[sec] ?? -1) + 1;
        final base = (_sectors.indexOf(sec).clamp(0, 7)) * math.pi / 4;
        final spread = (i.isEven ? 1 : -1) * ((i + 1) ~/ 2) * (8 * math.pi / 180);
        final r = rangeKm > 0 ? (asNum(s['distanceKm']) / rangeKm).clamp(0.12, 1.0).toDouble() : 0.5;
        return RadarBlip(base + spread, r, s['contacted'] == true);
      }(),
  ];
}

/// Tarcza radaru: pierścienie, osie sektorów, litery kierunków, środek (Twój silos) i punkty sygnałów.
class RadarPainter extends CustomPainter {
  RadarPainter({required this.blips});
  final List<RadarBlip> blips;

  final Paint _bg = Paint()..color = const Color(0xFF0D1512);
  final Paint _ring = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 1
    ..color = Ls.teal.withValues(alpha: 0.22);
  final Paint _axis = Paint()
    ..strokeWidth = 1
    ..color = Ls.teal.withValues(alpha: 0.10);
  final Paint _fill = Paint()..color = Ls.teal;
  final Paint _hollow = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 2
    ..color = Ls.amber;
  final Paint _glow = Paint()..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5);
  final Paint _center = Paint()..color = Ls.copper;

  static final _labels = {
    for (final (i, s) in ['N', 'E', 'S', 'W'].indexed)
      s: (TextPainter(text: TextSpan(text: s, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Ls.textFaint, fontFamily: Ls.display)), textDirection: TextDirection.ltr)..layout(), i * math.pi / 2),
  };

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.shortestSide / 2 - 14;
    canvas.drawCircle(c, r, _bg);
    for (final k in [0.33, 0.66, 1.0]) {
      canvas.drawCircle(c, r * k, _ring);
    }
    for (var i = 0; i < 8; i++) {
      final a = i * math.pi / 4;
      canvas.drawLine(c, c + Offset(math.sin(a), -math.cos(a)) * r, _axis);
    }
    for (final e in _labels.values) {
      final (tp, a) = e;
      final p = c + Offset(math.sin(a), -math.cos(a)) * (r + 8);
      tp.paint(canvas, p - Offset(tp.width / 2, tp.height / 2));
    }
    canvas.drawCircle(c, 5, _center);
    for (final b in blips) {
      final p = c + Offset(math.sin(b.angle), -math.cos(b.angle)) * (r * b.radius);
      if (b.known) {
        _glow.color = Ls.teal.withValues(alpha: 0.6);
        canvas.drawCircle(p, 7, _glow);
        canvas.drawCircle(p, 5, _fill);
      } else {
        _glow.color = Ls.amber.withValues(alpha: 0.4);
        canvas.drawCircle(p, 7, _glow);
        canvas.drawCircle(p, 5, _hollow);
      }
    }
  }

  @override
  bool shouldRepaint(RadarPainter old) => !_listEq(old.blips, blips);

  static bool _listEq(List<RadarBlip> a, List<RadarBlip> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
