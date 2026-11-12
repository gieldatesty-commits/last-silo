import 'package:flutter/widgets.dart';
import 'building_art.dart' show parseSvgPath;

/// Ikony slotów wyposażenia z makiety Warsztat.dc.html (viewBox 24x24, linia 1.8). Dekoracja: ExcludeSemantics.
const Map<String, String> _slotPaths = {
  'narzedzie': 'M14 4c3 0 6 2 6 5-2-1-4-1.5-6-1.5M14 4c-3 0-6 2-6 5 2-1 4-1.5 6-1.5M14 7.5 5 20',
  'ochrona': 'M4 15a8 8 0 0 1 16 0v2H4zM12 7v-3M8 17v3h8v-3',
  'lampa': 'M9 3h6l-1 5h-4zM8 8h8l1 9H7zM12 17v4M9 21h6',
  'sprzet': 'M4 18a10 10 0 0 1 16 0M7.5 18a5.5 5.5 0 0 1 9 0M12 18l4-6M3 21h18',
  // broń w slocie narzędzia (makieta WarsztatZestawy.dc.html)
  'bron': 'M4 20l9-9M13 11l3-7 4 4-7 3M8 16l-2-2M11 13l-2-2',
};

/// Ikona przedmiotu lub receptury: broń (narzędzie z atakiem) ma własną, reszta ikonę slotu.
String iconSlotOf(Map m) => m['slot'] == 'narzedzie' && ((m['attack'] as num?) ?? 0) > 0 ? 'bron' : '${m['slot']}';

/// Sloty w kolejności wyświetlania (klucze jak `slot` z API).
const slotOrder = ['narzedzie', 'ochrona', 'lampa', 'sprzet'];

final Map<String, Path> _cache = {};

class SlotIcon extends StatelessWidget {
  const SlotIcon(this.slot, {super.key, required this.color, this.size = 22});
  final String slot;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final d = _slotPaths[slot];
    if (d == null) return SizedBox.square(dimension: size);
    final path = _cache.putIfAbsent(slot, () => parseSvgPath(d));
    return ExcludeSemantics(child: CustomPaint(size: Size.square(size), painter: _SlotPainter(path, color)));
  }
}

class _SlotPainter extends CustomPainter {
  _SlotPainter(this.path, this.color);
  final Path path;
  final Color color;
  late final Paint _p = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 1.8
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..color = color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 24, size.height / 24);
    canvas.drawPath(path, _p);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_SlotPainter old) => old.path != path || old.color != color;
}
