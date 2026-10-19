import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../widgets.dart';

/// Ranking nadających silosów: siła albo łup z najazdów z 7 dni.
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
        padding: const EdgeInsets.all(12),
        child: SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'power', label: Text('Siła')),
            ButtonSegment(value: 'loot', label: Text('Łup (7 dni)')),
          ],
          selected: {_type},
          onSelectionChanged: (s) => setState(() => _type = s.first),
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
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                Text('Nadających silosów: ${d['total']}', style: Theme.of(context).textTheme.bodySmall),
                for (final r in top) _Row(r: r),
                if (me != null && !inTop) ...[const Divider(), _Row(r: me)],
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
  const _Row({required this.r});
  @override
  Widget build(BuildContext context) {
    final me = r['me'] == true;
    return ListTile(
      dense: true,
      tileColor: me ? Theme.of(context).colorScheme.secondaryContainer : null,
      leading: Text('#${r['rank']}', style: Theme.of(context).textTheme.titleSmall),
      title: Text('${r['nickname']}${me ? ' (Ty)' : ''}'),
      subtitle: Text('poz. ${r['level']}'),
      trailing: Text(fmtInt(asNum(r['value'])), style: Theme.of(context).textTheme.titleSmall),
    );
  }
}
