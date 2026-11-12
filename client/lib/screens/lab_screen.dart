import 'dart:async';

import 'package:flutter/material.dart';
import '../app_state.dart';
import '../constellation_painter.dart';
import '../format.dart';
import '../lab_layout.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';
import '../widgets.dart';

/// Laboratorium: konstelacja badań (docs/warstwa-wizualna-v1.0.md §2) i Kodeks Rdzeniowców.
class LabScreen extends StatelessWidget {
  final AppState state;
  const LabScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return LsTheme(
      child: DefaultTabController(
        length: 2,
        child: ColoredBox(
          color: Ls.bg,
          child: Column(children: [
            const TabBar(tabs: [Tab(text: 'Badania'), Tab(text: 'Kodeks')]),
            Expanded(child: TabBarView(children: [_Research(state: state), _Codex(state: state)])),
          ]),
        ),
      ),
    );
  }
}

class _Research extends StatelessWidget {
  final AppState state;
  const _Research({required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      // /items tylko do odczytu nazw receptur w „Odblokowuje” (API badań podaje identyfikatory receptur)
      load: () async {
        final r = await Future.wait([state.api.get('/research'), state.api.get('/items')]);
        return {'research': r[0], 'items': r[1]};
      },
      builder: (context, data, reload) {
        final d = asMap(asMap(data)['research']);
        final recipes = {for (final r in asList(asMap(asMap(data)['items'])['recipes'])) r['id'] as String: r['name'] as String};
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => _Constellation(
            state: state,
            techs: asList(d['techs']),
            labLevel: asNum(d['labLevel']).toInt(),
            active: d['active'] == null ? null : asMap(d['active']),
            recipeNames: recipes,
            reload: reload,
          ),
        );
      },
    );
  }
}

class _Constellation extends StatefulWidget {
  const _Constellation({required this.state, required this.techs, required this.labLevel, required this.active, required this.recipeNames, required this.reload});
  final AppState state;
  final List<Map<String, dynamic>> techs;
  final int labLevel;
  final Map<String, dynamic>? active;
  final Map<String, String> recipeNames;
  final Future<void> Function() reload;

  @override
  State<_Constellation> createState() => _ConstellationState();
}

class _ConstellationState extends State<_Constellation> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400));
  final _view = TransformationController();
  String? _selected;
  double? _fittedFor;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // brak pulsu przy wyłączonych animacjach; stan nadal czytelny z podwójnego pierścienia i „…”
    if (MediaQuery.disableAnimationsOf(context)) {
      _pulse
        ..stop()
        ..value = 0;
    } else if (!_pulse.isAnimating) {
      _pulse.repeat();
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    _view.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final built = buildConstellation(widget.techs);
    final nodes = built.nodes;
    final byId = {for (final n in nodes) n.id: n};
    final activeId = widget.active?['techId'] as String?;
    _selected ??= activeId ?? nodes.where((n) => n.state == TechState.available).firstOrNull?.id ?? nodes.firstOrNull?.id;
    final sel = byId[_selected];
    final selTech = widget.techs.where((t) => t['id'] == _selected).firstOrNull;
    final done = nodes.where((n) => n.state == TechState.done).length;

    return Column(children: [
      _Header(labLevel: widget.labLevel, done: done, total: nodes.length, active: widget.active, activeNode: activeId == null ? null : byId[activeId], reload: widget.reload),
      Expanded(
        child: LayoutBuilder(builder: (context, c) {
          // dopasuj mapę do szerokości przy pierwszym układzie (i po obrocie), w granicach min/max powiększenia
          if (_fittedFor != c.maxWidth + c.maxHeight / 10000) {
            _fittedFor = c.maxWidth + c.maxHeight / 10000;
            // cała mapa widoczna na starcie (dopasowanie do mniejszego wymiaru), ale nie mniej niż 0.8
            final w = c.maxWidth / labMapSize.width, h = c.maxHeight / labMapSize.height;
            final s = (w < h ? w : h).clamp(0.8, 2.5);
            _view.value = Matrix4.identity()..scaleByDouble(s, s, 1, 1);
          }
          return InteractiveViewer(
            transformationController: _view,
            constrained: false,
            minScale: 0.8,
            maxScale: 2.5,
            boundaryMargin: EdgeInsets.zero,
            child: SizedBox.fromSize(
              size: labMapSize,
              child: Stack(clipBehavior: Clip.none, children: [
                Positioned.fill(
                  child: ExcludeSemantics(
                    child: RepaintBoundary(child: CustomPaint(painter: ConstellationPainter(scene: built.scene, pulse: _pulse), isComplex: true)),
                  ),
                ),
                const _BranchLabel('GÓRNICTWO', Ls.amber, left: 20, top: 14),
                const _BranchLabel('INŻYNIERIA', Ls.teal, right: 20, top: 14),
                const _BranchLabel('RDZENIOWCY', Ls.violet, left: 196, top: 458),
                const _CenterNode(),
                for (final n in nodes)
                  Positioned(
                    left: n.pos.dx - 22,
                    top: n.pos.dy - 22,
                    child: _NodeButton(node: n, selected: n.id == _selected, onTap: () => setState(() => _selected = n.id)),
                  ),
                if (sel != null) _Caption(node: sel, others: nodes),
              ]),
            ),
          );
        }),
      ),
      if (sel != null && selTech != null)
        _Panel(
          state: widget.state,
          node: sel,
          tech: selTech,
          byId: byId,
          labLevel: widget.labLevel,
          anyActive: widget.active != null,
          activeEndsAt: activeId == sel.id ? parseTime(widget.active!['endsAt']) : null,
          recipeNames: widget.recipeNames,
          reload: widget.reload,
        ),
    ]);
  }
}

const _display = TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, color: Ls.text);

/// h:mm:ss (jak w makiecie).
String _clock(int s) {
  if (s < 0) s = 0;
  String p(int n) => n.toString().padLeft(2, '0');
  return '${s ~/ 3600}:${p(s % 3600 ~/ 60)}:${p(s % 60)}';
}

/// Odliczanie w formacie h:mm:ss; po zerze woła `onDone` (raz).
class _ClockCountdown extends StatefulWidget {
  const _ClockCountdown({required this.endsAt, required this.onDone, required this.builder});
  final DateTime endsAt;
  final Future<void> Function() onDone;
  final Widget Function(String left) builder;
  @override
  State<_ClockCountdown> createState() => _ClockCountdownState();
}

class _ClockCountdownState extends State<_ClockCountdown> {
  Timer? _t;
  bool _fired = false;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (!_fired && !widget.endsAt.isAfter(DateTime.now())) {
        _fired = true;
        widget.onDone();
      }
      setState(() {});
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(_clock(widget.endsAt.difference(DateTime.now()).inSeconds));
}

class _Header extends StatelessWidget {
  const _Header({required this.labLevel, required this.done, required this.total, required this.active, required this.activeNode, required this.reload});
  final int labLevel;
  final int done;
  final int total;
  final Map<String, dynamic>? active;
  final LabNode? activeNode;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final c = activeNode?.color ?? Ls.textFaint;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.end, spacing: 12, children: [
          Text('Laboratorium', style: _display.copyWith(fontSize: 22)),
          Text('poz. $labLevel · $done z $total badań', style: const TextStyle(fontSize: 13, color: Ls.textMuted)),
        ]),
        const SizedBox(height: 8),
        Container(
          constraints: const BoxConstraints(minHeight: 30),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(color: const Color(0xFF141925), borderRadius: BorderRadius.circular(15)),
          child: Row(children: [
            Container(
              width: 8,
              height: 8,
              decoration: active != null ? BoxDecoration(color: c, shape: BoxShape.circle) : BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Ls.textFaint, width: 2)),
            ),
            const SizedBox(width: 8),
            if (active != null) ...[
              Expanded(child: Text('W toku: ${activeNode?.name ?? active!['techId']}', style: const TextStyle(fontSize: 13, color: Ls.text))),
              _ClockCountdown(
                endsAt: parseTime(active!['endsAt']),
                onDone: reload,
                builder: (left) => Text(left, style: TextStyle(fontSize: 13, color: c, fontWeight: FontWeight.w600, fontFeatures: const [FontFeature.tabularFigures()])),
              ),
            ] else
              const Expanded(child: Text('Laboratorium wolne. Wybierz badanie.', style: TextStyle(fontSize: 13, color: Ls.textMuted))),
          ]),
        ),
      ]),
    );
  }
}

class _BranchLabel extends StatelessWidget {
  const _BranchLabel(this.text, this.color, {this.left, this.right, required this.top});
  final String text;
  final Color color;
  final double? left;
  final double? right;
  final double top;
  @override
  Widget build(BuildContext context) => Positioned(
        left: left,
        right: right,
        top: top,
        child: Text(text, style: TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.6, color: color)),
      );
}

class _CenterNode extends StatelessWidget {
  const _CenterNode();
  @override
  Widget build(BuildContext context) => Positioned(
        left: labCenter.dx - 26,
        top: labCenter.dy - 26,
        child: ExcludeSemantics(
          child: Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: const Color(0xFF10222A),
              shape: BoxShape.circle,
              border: Border.all(color: Ls.teal, width: 2),
              boxShadow: [BoxShadow(color: Ls.teal.withValues(alpha: 0.35), blurRadius: 22)],
            ),
            child: const Icon(Icons.science_outlined, color: Ls.text, size: 24),
          ),
        ),
      );
}

/// Węzeł: dotyk 44x44, koło 34. Stan niesie kształt i znak (✓, …, numer poziomu Lab), nie tylko kolor.
class _NodeButton extends StatelessWidget {
  const _NodeButton({required this.node, required this.selected, required this.onTap});
  final LabNode node;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = node.color;
    final (glyph, fg) = switch (node.state) {
      TechState.done => ('✓', Ls.bg),
      TechState.active => ('…', c),
      TechState.available => ('${node.labRequired}', c),
      TechState.locked => ('${node.labRequired}', const Color(0xFF8D99AD)),
    };
    return Semantics(
      button: true,
      selected: selected,
      label: '${node.name}, ${node.state.label}',
      excludeSemantics: true,
      onTap: onTap,
      child: FocusableActionDetector(
        actions: {ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) => onTap())},
        child: GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            width: 44,
            height: 44,
            child: Center(
              child: CustomPaint(
                painter: _NodePainter(state: node.state, color: c, selected: selected),
                child: SizedBox(
                  width: labNodeRadius * 2,
                  height: labNodeRadius * 2,
                  child: Center(child: Text(glyph, textScaler: TextScaler.noScaling, style: TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 12, color: fg))),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NodePainter extends CustomPainter {
  _NodePainter({required this.state, required this.color, required this.selected});
  final TechState state;
  final Color color;
  final bool selected;

  final Paint _fill = Paint();
  final Paint _stroke = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 2;
  final Paint _glow = Paint()..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);

  static const _dashes = 12;
  static const _sweep = 2 * 3.141592653589793 / _dashes;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    const r = labNodeRadius;
    switch (state) {
      case TechState.done:
        _glow.color = color.withValues(alpha: 0.5);
        canvas.drawCircle(c, r, _glow);
        _fill.color = color;
        canvas.drawCircle(c, r, _fill);
      case TechState.active:
        _glow.color = color.withValues(alpha: 0.5);
        canvas.drawCircle(c, r, _glow);
        _fill.color = Ls.bg;
        canvas.drawCircle(c, r, _fill);
        _stroke.color = color;
        canvas.drawCircle(c, r - 1, _stroke);
        // podwójny pierścień: stały sygnał „w toku”, także bez animacji
        _stroke.color = color.withValues(alpha: 0.35);
        canvas.drawCircle(c, r + 3, _stroke);
      case TechState.available:
        _glow.color = color.withValues(alpha: 0.33);
        canvas.drawCircle(c, r, _glow);
        _fill.color = Ls.panel;
        canvas.drawCircle(c, r, _fill);
        _stroke.color = color;
        canvas.drawCircle(c, r - 1, _stroke);
      case TechState.locked:
        _fill.color = const Color(0xFF0A0D14);
        canvas.drawCircle(c, r, _fill);
        _stroke.color = Ls.locked;
        // pierścień przerywany
        final rect = Rect.fromCircle(center: c, radius: r - 1);
        for (var i = 0; i < _dashes; i++) {
          canvas.drawArc(rect, i * _sweep, _sweep * 0.55, false, _stroke);
        }
    }
    if (selected) {
      _stroke.color = Ls.text;
      canvas.drawCircle(c, r + 5, _stroke);
    }
  }

  @override
  bool shouldRepaint(_NodePainter old) => old.state != state || old.color != color || old.selected != selected;
}

/// Podpis zaznaczonego węzła nad nim (pod nim, gdy blisko górnej krawędzi).
class _Caption extends StatelessWidget {
  const _Caption({required this.node, required this.others});
  final LabNode node;
  final List<LabNode> others;
  @override
  Widget build(BuildContext context) {
    final r = captionRect(node.pos, [
      for (final o in others)
        if (o.id != node.id) o.pos
    ]);
    return Positioned(
      left: r.left,
      top: r.top,
      width: r.width,
      child: IgnorePointer(
        child: ExcludeSemantics(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
            decoration: BoxDecoration(color: Ls.bg.withValues(alpha: 0.8), border: Border.all(color: node.color.withValues(alpha: 0.4)), borderRadius: BorderRadius.circular(8)),
            child: Text(node.name, textAlign: TextAlign.center, maxLines: 2, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Ls.text)),
          ),
        ),
      ),
    );
  }
}

/// Dolny panel szczegółów zaznaczonego badania. Akcja startu jak dotąd: act() + Idempotency-Key.
class _Panel extends StatelessWidget {
  const _Panel({
    required this.state,
    required this.node,
    required this.tech,
    required this.byId,
    required this.labLevel,
    required this.anyActive,
    required this.activeEndsAt,
    required this.recipeNames,
    required this.reload,
  });
  final AppState state;
  final LabNode node;
  final Map<String, dynamic> tech;
  final Map<String, LabNode> byId;
  final int labLevel;
  final bool anyActive;
  final DateTime? activeEndsAt;
  final Map<String, String> recipeNames;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final c = node.color;
    final st = node.state;
    final effect = tech['effect'] is Map ? effectText(tech['effect'] as Map) : '';
    final unlocks = ((tech['unlocks'] as List?) ?? const []).cast<String>().map((u) => recipeNames[u] ?? u).toList();
    final wallet = (state.silo?['wallet'] as Map?) ?? const {};
    final radioLevel = ((state.silo?['radio'] as Map?)?['level'] as num?)?.toInt();
    final radioReq = (tech['radioRequired'] as num?)?.toInt();
    final (tag, tagFill) = switch (st) {
      TechState.done => ('✓ Ukończone', true),
      TechState.active => ('… W toku', false),
      TechState.available => ('● Dostępne', false),
      TechState.locked => ('○ Zablokowane', false),
    };

    bool have(String res, num need) => need <= 0 || asNum(wallet[res]) >= need;
    final chips = <(String?, String, bool)>[
      if (asNum(tech['ore']) > 0) ('ore', '${fmtInt(asNum(tech['ore']))} rudy', have('ore', asNum(tech['ore']))),
      if (asNum(tech['tokens']) > 0) ('tokens', '${fmtInt(asNum(tech['tokens']))} żet.', have('tokens', asNum(tech['tokens']))),
      if (asNum(tech['samples']) > 0) ('samples', '${fmtInt(asNum(tech['samples']))} prób.', have('samples', asNum(tech['samples']))),
      for (final e in ((tech['materials'] as Map?) ?? const {}).entries) (e.key as String, '${e.value} ${resName(e.key as String)}', have(e.key as String, e.value as num)),
      (null, fmtDuration(asNum(tech['seconds']).toInt()), true),
      (null, node.labRequired > labLevel ? 'Wymaga Lab ${node.labRequired}' : 'Lab ${node.labRequired}', node.labRequired <= labLevel),
      if (radioReq != null) (null, (radioLevel ?? 0) < radioReq ? 'Wymaga Radio $radioReq' : 'Radio $radioReq', (radioLevel ?? 0) >= radioReq),
    ];
    final reqs = [for (final id in node.requires) (byId[id]?.name ?? id, byId[id]?.state == TechState.done)];

    // zasoby (chipy z surowcem) osobno od wymagań budynków (chipy bez surowca: czas, Lab, Radio)
    final enoughRes = chips.every((c) => c.$1 == null || c.$3);
    final buildingsOk = chips.every((c) => c.$1 != null || c.$3);
    final idle = st == TechState.available && !anyActive && !state.busy && enoughRes && buildingsOk;
    final Widget label = switch (st) {
      TechState.done => const Text('Ukończone'),
      TechState.active when activeEndsAt != null => _ClockCountdown(endsAt: activeEndsAt!, onDone: reload, builder: (l) => Text('W toku, jeszcze $l')),
      TechState.active => const Text('W toku'),
      TechState.locked => const Text('Najpierw spełnij wymagania'),
      TechState.available when anyActive => const Text('Laboratorium zajęte'),
      TechState.available when !buildingsOk => const Text('Najpierw spełnij wymagania'),
      TechState.available when !enoughRes => const Text('Brak zasobów'),
      TechState.available => const Text('Rozpocznij badanie'),
    };

    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.45),
      child: Container(
        width: double.infinity,
        decoration: const BoxDecoration(
          color: Ls.panel,
          border: Border(top: BorderSide(color: Ls.border)),
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                  child:
                      Text((branchNames[node.branch] ?? node.branch).toUpperCase(), style: TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.6, color: c))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: tagFill ? c : null,
                  borderRadius: BorderRadius.circular(12),
                  border: tagFill ? null : Border.all(color: st == TechState.locked ? Ls.locked : c),
                ),
                child: Text(tag, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: tagFill ? Ls.bg : (st == TechState.locked ? Ls.textMuted : c))),
              ),
            ]),
            const SizedBox(height: 6),
            Text(node.name, style: _display.copyWith(fontSize: 20)),
            const SizedBox(height: 6),
            Text(effect.isEmpty ? 'Brak bezpośredniego bonusu. Otwiera dalsze badania.' : effect, style: const TextStyle(fontSize: 14, color: Ls.text)),
            if (unlocks.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('Odblokowuje: ${unlocks.join(', ')}', style: const TextStyle(fontSize: 13, color: Ls.textMuted)),
            ],
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final (name, ok) in reqs) _Chip(text: '${ok ? '✓' : '○'} $name', ok: ok),
              for (final (res, text, ok) in chips) LsResChip(res, text, ok: ok),
            ]),
            const SizedBox(height: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 46, minWidth: double.infinity),
              child: FilledButton(
                key: const ValueKey('lab-action'),
                onPressed: idle ? () => act(state, () => state.api.post('/research/${node.id}/start', idempotent: true), reload, ctx: context, okText: 'Badanie rozpoczęte') : null,
                style: FilledButton.styleFrom(
                  backgroundColor: c,
                  foregroundColor: Ls.bg,
                  disabledBackgroundColor: Ls.chip,
                  disabledForegroundColor: Ls.textMuted,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                child: label,
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Chip wymagania/kosztu; brak = obramowanie i ciepły kolor (plus „Wymaga” albo ○ w tekście).
class _Chip extends StatelessWidget {
  const _Chip({required this.text, required this.ok});
  final String text;
  final bool ok;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(color: ok ? Ls.chip : null, borderRadius: BorderRadius.circular(12), border: ok ? null : Border.all(color: Ls.warn)),
        child: Text(text, style: TextStyle(fontSize: 12, color: ok ? const Color(0xFFC9D0DC) : Ls.warnText)),
      );
}

class _Codex extends StatelessWidget {
  final AppState state;
  const _Codex({required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/codex'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final entries = asList(d['entries']);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Kodeks Rdzeniowców: ${d['unlocked']}/${d['total']}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final e in entries)
              Card(
                child: e['unlocked'] == true
                    ? ExpansionTile(
                        title: Text('${e['order']}. ${e['title']}'),
                        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        expandedCrossAxisAlignment: CrossAxisAlignment.start,
                        children: [Text(e['text'] as String)],
                      )
                    : ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text('${e['order']}. ???'),
                        subtitle: Text(e['hint'] as String),
                      ),
              ),
          ],
        );
      },
    );
  }
}
