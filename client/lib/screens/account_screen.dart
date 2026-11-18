import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api.dart';
import '../app_state.dart';
import '../palette.dart';
import '../strings.dart';
import '../ui.dart';

/// Konto (Więcej → Konto, makieta „Konto”): gość czy połączone z Google, łączenie i usuwanie konta.
/// docs/konto-google-v1.0.md §4.
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.state});
  final AppState state;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  String? _loadErr;
  String? _err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      await widget.state.loadAccount();
      if (mounted) setState(() => _loadErr = null);
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadErr = e.code);
    }
  }

  Future<void> _link() async {
    setState(() => _err = null);
    final ok = await widget.state.linkGoogle();
    if (!ok && mounted) {
      final code = widget.state.consumeError();
      setState(() => _err = code == null ? null : errorText(code));
    }
  }

  Future<void> _delete() async {
    final yes = await showDialog<bool>(context: context, builder: (_) => const _DeleteDialog());
    if (yes != true || !mounted) return;
    final nav = Navigator.of(context);
    final ok = await widget.state.deleteAccount();
    if (ok) {
      nav.popUntil((r) => r.isFirst);
    } else if (mounted) {
      final code = widget.state.consumeError();
      setState(() => _err = code == null ? null : errorText(code));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final account = state.account;
        final nickname = ((state.me?['player'] as Map?)?['nickname'] as String?) ?? 'Twoja postać';
        final google = state.api.google.available;
        final linked = account?['google'] == true;
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          children: [
            LsCard(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    Text(nickname, style: lsDisplay.copyWith(fontSize: 16)),
                    if (account != null) _StatusChip(linked: linked),
                  ],
                ),
                const SizedBox(height: 8),
                if (account == null && _loadErr == null)
                  const Text('Sprawdzam konto…', style: lsMuted)
                else if (account == null)
                  Text(errorText(_loadErr!), style: const TextStyle(fontSize: 13, color: Ls.warnText))
                else if (linked) ...[
                  const Text('Konto zabezpieczone: postać jest połączona z Twoim kontem Google.', style: TextStyle(fontSize: 13, height: 1.45)),
                  const SizedBox(height: 6),
                  const Text('Na nowym telefonie wybierz „Mam już konto (Google)” na ekranie tworzenia postaci.', style: lsMuted),
                ] else ...[
                  const Text(
                    'Postać jest zapisana tylko na tym telefonie. Po zmianie telefonu albo reinstalacji gry przepadnie, jeśli nie połączysz konta z Google.',
                    style: TextStyle(fontSize: 13, height: 1.45, color: Color(0xFFC9D0DC)),
                  ),
                  const SizedBox(height: 10),
                  if (google) ...[
                    FilledButton.icon(
                      onPressed: state.busy ? null : _link,
                      icon: const Icon(Icons.account_circle_outlined, size: 18),
                      label: Text(state.busy ? 'Łączę…' : 'Połącz z Google', textAlign: TextAlign.center),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(double.infinity, 48),
                        backgroundColor: Ls.text,
                        foregroundColor: Ls.bg,
                        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text('Używamy tylko identyfikatora konta Google — bez adresu e‑mail i kontaktów.',
                        style: TextStyle(fontSize: 11, color: Ls.textMuted)),
                  ] else
                    const Text('Łączenie z Google jest niedostępne w tej wersji gry.', style: lsMuted),
                ],
                if (_err != null) ...[
                  const SizedBox(height: 8),
                  Semantics(
                    liveRegion: true,
                    container: true,
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Icon(Icons.error_outline, color: Ls.warnText, size: 18),
                      const SizedBox(width: 8),
                      Expanded(child: Text(_err!, style: const TextStyle(fontSize: 13, color: Ls.warnText))),
                    ]),
                  ),
                ],
              ]),
            ),
            const SizedBox(height: 16),
            LsCard(
              padding: const EdgeInsets.all(14),
              color: Colors.transparent,
              border: Ls.warn.withValues(alpha: 0.4),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Semantics(header: true, child: const Text('Usuń konto', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Ls.warnText))),
                const SizedBox(height: 6),
                const Text('Usuwa postać, silos, przedmioty i historię. Tego nie da się cofnąć.', style: TextStyle(fontSize: 12, color: Color(0xFFC9D0DC))),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: state.busy ? null : _delete,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 44),
                    foregroundColor: Ls.warnText,
                    side: const BorderSide(color: Ls.warn),
                    textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Usuń konto…', textAlign: TextAlign.center),
                ),
                if (account?['code'] is String) ...[
                  const SizedBox(height: 10),
                  const Divider(height: 1, color: Ls.border),
                  const SizedBox(height: 8),
                  Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
                    const Text('Kod konta', style: TextStyle(fontSize: 12, color: Color(0xFFC9D0DC))),
                    SelectableText(account!['code'] as String,
                        style: lsDisplay.copyWith(fontSize: 14, letterSpacing: 1, color: Ls.text), semanticsLabel: 'Kod konta ${account['code']}'),
                  ]),
                  const SizedBox(height: 2),
                  const Text('Podaj go na stronie usuwania konta, jeśli nie możesz usunąć konta w grze.',
                      style: TextStyle(fontSize: 11, height: 1.4, color: Ls.textMuted)),
                ],
              ]),
            ),
          ],
        );
      },
    );
  }
}

/// Status konta znakiem i słowem (nie tylko kolorem).
class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.linked});
  final bool linked;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color: linked ? Ls.teal.withValues(alpha: 0.14) : null,
          borderRadius: BorderRadius.circular(9),
          border: linked ? null : Border.all(color: Ls.amber),
        ),
        child: Text(linked ? '✓ Google' : '○ Gość', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: linked ? Ls.teal : Ls.amber)),
      );
}

/// Potwierdzenie usunięcia konta: trzeba wpisać USUŃ (makieta „Konto”, dialog). Ostrzega, że subskrypcja w Google Play
/// nie zostanie anulowana (serwer nie może jej anulować za gracza).
class _DeleteDialog extends StatefulWidget {
  const _DeleteDialog();
  @override
  State<_DeleteDialog> createState() => _DeleteDialogState();
}

class _DeleteDialogState extends State<_DeleteDialog> {
  final _text = TextEditingController();
  static final _subscriptions = Uri.parse('https://play.google.com/store/account/subscriptions');

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  bool get _confirmed => const {'USUŃ', 'USUN'}.contains(_text.text.trim());

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('Usunąć konto?', style: lsDisplay.copyWith(fontSize: 18)),
        scrollable: true,
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Postać, silos, przedmioty i wyniki znikną na zawsze. W rankingach sezonów zostaniesz jako „Usunięty gracz”.',
              style: TextStyle(fontSize: 13, height: 1.45, color: Color(0xFFC9D0DC))),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1410),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Ls.amber.withValues(alpha: 0.4)),
            ),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const ExcludeSemantics(child: Text('!', style: TextStyle(fontWeight: FontWeight.w700, color: Ls.amber))),
              const SizedBox(width: 8),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Subskrypcja w Google Play nie zostanie anulowana.', style: TextStyle(fontSize: 12, height: 1.4, color: Ls.text)),
                  TextButton(
                    onPressed: () => launchUrl(_subscriptions, mode: LaunchMode.externalApplication),
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(0, 44),
                      alignment: Alignment.centerLeft,
                      foregroundColor: Ls.amber,
                      textStyle: const TextStyle(fontSize: 12, decoration: TextDecoration.underline),
                    ),
                    child: const Text('Zarządzaj subskrypcjami w Google Play'),
                  ),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _text,
            onChanged: (_) => setState(() {}),
            textCapitalization: TextCapitalization.characters,
            autocorrect: false,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Ls.text),
            decoration: InputDecoration(
              labelText: 'Wpisz USUŃ, aby potwierdzić',
              labelStyle: const TextStyle(color: Ls.textMuted),
              filled: true,
              fillColor: Ls.panel,
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Ls.locked)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Ls.warn, width: 1.5)),
            ),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Anuluj')),
          FilledButton(
            onPressed: _confirmed ? () => Navigator.pop(context, true) : null,
            style: FilledButton.styleFrom(backgroundColor: Ls.warn, foregroundColor: Ls.bg),
            child: const Text('Usuń na zawsze'),
          ),
        ],
      );
}
