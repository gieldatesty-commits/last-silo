import 'package:flutter/material.dart';
import 'palette.dart';
import 'ui.dart';
import 'api.dart';
import 'app_state.dart';
import 'format.dart';
import 'strings.dart';

/// Ładuje dane z serwera, pokazuje spinner / błąd z ponowieniem i daje `reload`.
/// [builder] musi zwracać przewijalny widżet (ListView), bo całość jest w RefreshIndicator.
class Loader extends StatefulWidget {
  final Future<dynamic> Function() load;
  final Widget Function(BuildContext context, dynamic data, Future<void> Function() reload) builder;
  const Loader({super.key, required this.load, required this.builder});
  @override
  State<Loader> createState() => _LoaderState();
}

class _LoaderState extends State<Loader> {
  dynamic _data;
  String? _err;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    try {
      final d = await widget.load();
      if (!mounted) return;
      setState(() {
        _data = d;
        _err = null;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _err = e.code;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return const Center(child: CircularProgressIndicator());
    if (_data == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(errorText(_err ?? 'network'), textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () {
                setState(() => _loading = true);
                reload();
              },
              child: const Text('Spróbuj ponownie'),
            ),
          ]),
        ),
      );
    }
    return RefreshIndicator(onRefresh: reload, child: widget.builder(context, _data, reload));
  }
}

void toast(BuildContext context, String text) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
}

/// Wykonuje akcję przez [AppState.run], a potem zawsze odświeża widok (stan mógł się zmienić także po błędzie).
/// Zwraca true, gdy akcja się udała. Błąd pokazuje Shell (SnackBar).
Future<bool> act(AppState s, Future<void> Function() f, Future<void> Function() reload, {BuildContext? ctx, String? okText}) async {
  final ok = await s.run(f);
  await reload();
  if (ok && okText != null && ctx != null && ctx.mounted) toast(ctx, okText);
  return ok;
}

/// Koszt jako tekst: "150 rudy, 5 żet., 6 Miedź".
String costText(Map c) {
  final parts = <String>[];
  final ore = asNum(c['ore'] ?? 0);
  if (ore > 0) parts.add('${fmtInt(ore)} rudy');
  final tokens = asNum(c['tokens'] ?? 0);
  if (tokens > 0) parts.add('${fmtInt(tokens)} żet.');
  final samples = asNum(c['samples'] ?? 0);
  if (samples > 0) parts.add('${fmtInt(samples)} prób.');
  final mats = c['materials'];
  if (mats is Map) {
    for (final e in mats.entries) {
      parts.add('${e.value} ${resName(e.key as String)}');
    }
  }
  return parts.isEmpty ? 'za darmo' : parts.join(', ');
}

class SectionTitle extends StatelessWidget {
  final String text;
  const SectionTitle(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 18, bottom: 8),
        child: Semantics(header: true, child: Text(text.toUpperCase(), style: lsLabel)),
      );
}

class InfoBanner extends StatelessWidget {
  final IconData icon;
  final Widget child;
  const InfoBanner({super.key, required this.icon, required this.child});
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Ls.chip, border: Border.all(color: Ls.border), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [Icon(icon, color: Ls.amber), const SizedBox(width: 12), Expanded(child: DefaultTextStyle.merge(style: const TextStyle(color: Ls.text), child: child))]),
      );
}

class EmptyNote extends StatelessWidget {
  final String text;
  const EmptyNote(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(border: Border.all(color: const Color(0xFF2B3546)), borderRadius: BorderRadius.circular(12)),
        child: Text(text, style: const TextStyle(fontSize: 13, color: Ls.textMuted)),
      );
}

/// Pyta o ilość (i opcjonalnie ubezpieczenie). Zwraca null po anulowaniu.
Future<({int qty, bool insure})?> askQty(
  BuildContext context, {
  required String title,
  required int max,
  int initial = 1,
  String? hint,
  bool insurable = false,
  String Function(int qty)? summary,
}) {
  return showDialog<({int qty, bool insure})>(
    context: context,
    builder: (ctx) => _QtyDialog(title: title, max: max, initial: initial, hint: hint, insurable: insurable, summary: summary),
  );
}

class _QtyDialog extends StatefulWidget {
  final String title;
  final int max;
  final int initial;
  final String? hint;
  final bool insurable;
  final String Function(int qty)? summary;
  const _QtyDialog({required this.title, required this.max, required this.initial, this.hint, required this.insurable, this.summary});
  @override
  State<_QtyDialog> createState() => _QtyDialogState();
}

class _QtyDialogState extends State<_QtyDialog> {
  late final TextEditingController _c = TextEditingController(text: '${widget.initial.clamp(1, widget.max)}');
  bool _insure = false;

  int get _qty => int.tryParse(_c.text.trim()) ?? 0;
  bool get _valid => _qty >= 1 && _qty <= widget.max;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (widget.hint != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(widget.hint!)),
          TextField(
            controller: _c,
            keyboardType: TextInputType.number,
            autofocus: true,
            decoration: InputDecoration(labelText: 'Ilość (1–${widget.max})', border: const OutlineInputBorder()),
            onChanged: (_) => setState(() {}),
          ),
          if (widget.summary != null && _valid) Padding(padding: const EdgeInsets.only(top: 8), child: Text(widget.summary!(_qty))),
          if (widget.insurable)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Ubezpiecz ładunek'),
              subtitle: const Text('Chroni przed stratą w zasadzce (opłata ok. 6% wartości).'),
              value: _insure,
              onChanged: (v) => setState(() => _insure = v),
            ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Anuluj')),
          FilledButton(onPressed: _valid ? () => Navigator.pop(context, (qty: _qty, insure: _insure)) : null, child: const Text('OK')),
        ],
      );
}

/// Okno z samym wyborem ubezpieczenia (np. przy przyjmowaniu zlecenia). Zwraca null po anulowaniu.
Future<bool?> askInsure(BuildContext context, {required String title, required String hint}) {
  var insure = false;
  return showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        title: Text(title),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(hint),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Ubezpiecz ładunek'),
            subtitle: const Text('Chroni przed stratą w zasadzce (opłata ok. 6% wartości).'),
            value: insure,
            onChanged: (v) => setState(() => insure = v),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Anuluj')),
          FilledButton(onPressed: () => Navigator.pop(ctx, insure), child: const Text('Przyjmij')),
        ],
      ),
    ),
  );
}

/// Proste potwierdzenie (np. przed drogą akcją).
Future<bool> confirm(BuildContext context, String title, String body, {String ok = 'Tak'}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Anuluj')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(ok)),
      ],
    ),
  );
  return r ?? false;
}

/// Ekran-kontener dla podekranów otwieranych z menu „Więcej”: ciemny motyw warstwy wizualnej.
class SubScreen extends StatelessWidget {
  final String title;
  final Widget body;
  const SubScreen({super.key, required this.title, required this.body});
  @override
  Widget build(BuildContext context) => LsTheme(
        child: Scaffold(
          backgroundColor: Ls.bg,
          appBar: AppBar(
            title: Text(title, style: lsDisplay.copyWith(fontSize: 20)),
            backgroundColor: Ls.bg,
            foregroundColor: Ls.text,
            surfaceTintColor: Colors.transparent,
            bottom: const PreferredSize(preferredSize: Size.fromHeight(1), child: Divider(height: 1, color: Ls.border)),
          ),
          body: SafeArea(child: body),
        ),
      );
}
