import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/format.dart';

void main() {
  test('fmtInt grupuje tysiące', () {
    expect(fmtInt(0), '0');
    expect(fmtInt(999), '999');
    expect(fmtInt(1234567), '1 234 567');
    expect(fmtInt(-1500), '-1 500');
  });

  test('fmtDuration', () {
    expect(fmtDuration(12), '12 s');
    expect(fmtDuration(249), '4 min 09 s');
    expect(fmtDuration(3 * 3600 + 300), '3 h 05 min');
    expect(fmtDuration(93600), '1 d 2 h');
    expect(fmtDuration(-5), '0 s');
  });
}
