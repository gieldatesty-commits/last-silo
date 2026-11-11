import 'dart:math' as math;

import 'package:flutter/animation.dart';
import 'package:flutter/rendering.dart';
import 'lab_layout.dart';
import 'palette.dart';

/// Rysuje tło i krawędzie konstelacji. Węzły są osobnymi widgetami (dostępność, fokus), nie tutaj.
/// Puls aktywnego węzła idzie przez `repaint: pulse`, a nie przez setState.
class ConstellationPainter extends CustomPainter {
  ConstellationPainter({required this.scene, required this.pulse}) : super(repaint: pulse);
  final ConstellationScene scene;

  /// 0..1; zatrzymane (wartość stała), gdy animacje są wyłączone w systemie
  final Animation<double> pulse;

  final Paint _ring = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 1;
  final Paint _star = Paint();
  final Paint _glow = Paint();
  final Paint _edge = Paint()
    ..style = PaintingStyle.stroke
    ..strokeCap = StrokeCap.round;
  final Paint _pulse = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 2;

  static final List<(Shader, Rect)> _glows = [
    for (final (b, r, a) in [('gornictwo', 130.0, 0.10), ('inzynieria', 130.0, 0.10), ('rdzeniowcy', 160.0, 0.12)])
      (
        RadialGradient(colors: [branchColor[b]!.withValues(alpha: a), branchColor[b]!.withValues(alpha: 0)]).createShader(Rect.fromCircle(center: branchAnchor[b]!, radius: r)),
        Rect.fromCircle(center: branchAnchor[b]!, radius: r),
      ),
  ];

  static const _edgeOpacity = {EdgeWeight.full: 0.95, EdgeWeight.half: 0.6, EdgeWeight.faint: 0.22};
  static const _edgeWidth = {EdgeWeight.full: 2.0, EdgeWeight.half: 1.6, EdgeWeight.faint: 1.2};

  @override
  void paint(Canvas canvas, Size size) {
    // poświaty gałęzi
    for (final (shader, rect) in _glows) {
      _glow.shader = shader;
      canvas.drawRect(rect, _glow);
    }
    // pierścienie wokół Laboratorium
    for (final (r, a) in const [(95.0, 0.05), (160.0, 0.05), (230.0, 0.04)]) {
      _ring.color = Ls.text.withValues(alpha: a);
      canvas.drawCircle(labCenter, r, _ring);
    }
    for (final s in labStars) {
      _star.color = Ls.text.withValues(alpha: s.opacity);
      canvas.drawCircle(s.p, s.r, _star);
    }
    for (final e in scene.edges) {
      _edge
        ..color = e.color.withValues(alpha: _edgeOpacity[e.weight]!)
        ..strokeWidth = _edgeWidth[e.weight]!;
      if (e.dashed) {
        _dashed(canvas, e.a, e.b);
      } else {
        canvas.drawLine(e.a, e.b, _edge);
      }
    }
    final at = scene.pulseAt;
    if (at != null) {
      final t = pulse.value;
      _pulse.color = (scene.pulseColor ?? Ls.text).withValues(alpha: 0.55 * (1 - t));
      canvas.drawCircle(at, labNodeRadius + 4 + 8 * t, _pulse);
    }
  }

  /// Linia przerywana 3/5 dp (jak stroke-dasharray w makiecie).
  void _dashed(Canvas canvas, Offset a, Offset b) {
    final d = b - a;
    final len = d.distance;
    if (len == 0) return;
    final u = d / len;
    for (var s = 0.0; s < len; s += 8) {
      canvas.drawLine(a + u * s, a + u * math.min(s + 3, len), _edge);
    }
  }

  @override
  bool shouldRepaint(ConstellationPainter old) => old.scene != scene || old.pulse != pulse;
}
