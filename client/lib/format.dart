import 'dart:async';
import 'package:flutter/material.dart';

/// 1 234 567 (spacja jako separator tysięcy, bez zależności od intl).
String fmtInt(num n) {
  final s = n.round().abs().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(' ');
    b.write(s[i]);
  }
  return (n < 0 ? '-' : '') + b.toString();
}

/// 1 d 2 h, 3 h 05 min, 4 min 09 s, 12 s.
String fmtDuration(int seconds) {
  if (seconds < 0) seconds = 0;
  final d = seconds ~/ 86400;
  final h = (seconds % 86400) ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  final s = seconds % 60;
  if (d > 0) return '$d d $h h';
  if (h > 0) return '$h h ${m.toString().padLeft(2, '0')} min';
  if (m > 0) return '$m min ${s.toString().padLeft(2, '0')} s';
  return '$s s';
}

Map<String, dynamic> asMap(dynamic v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> asList(dynamic v) => (v as List).map(asMap).toList();
num asNum(dynamic v) => v is num ? v : (num.tryParse('$v') ?? 0);

DateTime parseTime(dynamic v) => DateTime.parse(v as String).toLocal();

/// Odliczanie do [endsAt]. Po dojściu do zera woła [onDone] (raz), żeby odświeżyć stan z serwera.
class Countdown extends StatefulWidget {
  final DateTime endsAt;
  final VoidCallback? onDone;
  final TextStyle? style;
  const Countdown({super.key, required this.endsAt, this.onDone, this.style});
  @override
  State<Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<Countdown> {
  Timer? _timer;
  bool _fired = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (!_fired && !widget.endsAt.isAfter(DateTime.now())) {
        _fired = true;
        widget.onDone?.call();
      }
      setState(() {});
    });
  }

  @override
  void didUpdateWidget(Countdown old) {
    super.didUpdateWidget(old);
    if (old.endsAt != widget.endsAt) _fired = false;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.endsAt.difference(DateTime.now()).inSeconds;
    return Text(fmtDuration(left), style: widget.style);
  }
}
