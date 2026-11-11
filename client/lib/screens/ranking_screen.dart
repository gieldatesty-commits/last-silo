import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../palette.dart';
import '../ui.dart';
import '../widgets.dart';

/// Ranking nadających silosów: siła albo łup z najazdów z 7 dni. Dane: GET /ranking?type=power|loot.
class RankingScreen extends StatefulWidget {
  final AppState state;
  const RankingScreen({super.key, required this.state});
  @override
  State<RankingScreen> createState() => _RankingScreenState();
}

class _RankingScreenState extends State<RankingScreen> {
  String _type = 'power';

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'power', label: Text('Siła'), icon: Icon(Icons.bolt_outlined)),
            ButtonSegment(value: 'loot', label: Text('Łup (7 dni)'), icon: Icon(Icons.inventory_2_outlined)),
          ],
          selected: {_type},
          onSelectionChanged: (s) => setState(() => _type = s.first),
          style: ButtonStyle(
            minimumSize: const WidgetStatePropertyAll(Size(0, 44)),
            backgroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Ls.violet.withValues(alpha: 0.22) : Colors.transparent),
            foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Ls.text : Ls.textMuted),
            side: const WidgetStatePropertyAll(BorderSide(color: Ls.border)),
          ),
        ),
      ),
      Expanded(
        child: Loader(
          key: ValueKey(_type),
          load: () => widget.state.api.get('/ranking?type=$_type'),
          builder: (context, data, reload) {
            final d = asMap(data);
            final top = asList(d['top']);
            final me = d['me'] == null ? null : asMap(d['me']);
            final inTop = top.any((r) => r['me'] == true);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              children: [
                Text('Nadających silosów: ${d['total']} · ${_type == 'power' ? 'siła silosu' : 'ruda zdobyta w najazdach'}', style: lsMuted),
                const SizedBox(height: 8),
                if (top.isEmpty) const EmptyNote('Nikt jeszcze nie nadaje. Włącz nadawanie w Radiu, żeby pojawić się w rankingu.'),
                for (final r in top) _Row(r: r, loot: _type == 'loot'),
                if (me != null && !inTop) ...[const Divider(color: Ls.border), _Row(r: me, loot: _type == 'loot')],
              ],
            );
          },
        ),
      ),
    ]);
  }
}

class _Row extends StatelessWidget {
  final Map<String, dynamic> r;
  final bool loot;
  const _Row({required this.r, required this.loot});
  @override
  Widget build(BuildContext context) {
    final me = r['me'] == true;
    final rank = asNum(r['rank']).toInt();
    final medal = switch (rank) { 1 => Ls.amber, 2 => const Color(0xFFC9D0DC), 3 => Ls.copper, _ => Ls.locked };
    return Semantics(
      label: 'miejsce $rank, ${r['nickname']}${me ? ', to Ty' : ''}, poziom ${r['level']}, ${loot ? 'łup' : 'siła'} ${fmtInt(asNum(r['value']))}',
      excludeSemantics: true,
      child: LsCard(
        color: me ? const Color(0xFF1A2230) : Ls.card,
        border: me ? Ls.teal.withValues(alpha: 0.6) : null,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(shape: BoxShape.circle, color: rank <= 3 ? medal.withValues(alpha: 0.14) : null, border: Border.all(color: medal, width: 2)),
            child: Text('$rank', style: lsDisplay.copyWith(fontSize: 13, color: rank <= 3 ? medal : Ls.textMuted)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${r['nickname']}${me ? ' (Ty)' : ''}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.text)),
              Text('poz. ${r['level']}', style: lsMuted),
            ]),
          ),
          const SizedBox(width: 8),
          LsStat(loot ? 'ŁUP' : 'SIŁA', fmtInt(asNum(r['value'])), alignEnd: true),
        ]),
      ),
    );
  }
}
