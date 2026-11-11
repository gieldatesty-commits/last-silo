import 'package:flutter/material.dart';
import '../app_state.dart';
import '../building_art.dart';
import '../palette.dart';
import '../slot_icon.dart';
import '../strings.dart';
import '../ui.dart';

/// Tworzenie postaci: pseudonim + archetyp (raz na sezon). Logika bez zmian: walidacja pseudonimu
/// jak na serwerze, `state.createPlayer`, błąd z serwera przez `errorText`.
class OnboardingScreen extends StatefulWidget {
  final AppState state;
  const OnboardingScreen({super.key, required this.state});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _nick = TextEditingController();
  String _arch = 'gornik';
  String? _err;

  static final _nickRe = RegExp(r'^[\p{L}\p{N}_ -]+$', unicode: true);

  /// Wygląd archetypów (prezentacja); nazwy i opisy z `archetypeInfo` w strings.dart.
  static const _accent = {'gornik': Ls.amber, 'inzynier': Ls.copper, 'zwiadowca': Ls.teal, 'alchemik': Ls.violet};

  @override
  void dispose() {
    _nick.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final nick = _nick.text.trim();
    if (nick.length < 3 || nick.length > 20 || !_nickRe.hasMatch(nick)) {
      setState(() => _err = 'Pseudonim: 3–20 znaków, litery, cyfry, spacja, _ lub -.');
      return;
    }
    setState(() => _err = null);
    final ok = await widget.state.createPlayer(nick, _arch);
    if (!ok && mounted) setState(() => _err = errorText(widget.state.consumeError() ?? 'internal'));
  }

  @override
  Widget build(BuildContext context) {
    final busy = widget.state.busy;
    return LsTheme(
      child: Scaffold(
        backgroundColor: Ls.bg,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              Center(child: BuildingArt.fromApi('szyb_glowny', 1, width: 150)),
              const SizedBox(height: 8),
              Semantics(header: true, child: Text('Zejdź do Głębi', textAlign: TextAlign.center, style: lsDisplay.copyWith(fontSize: 26))),
              const SizedBox(height: 6),
              const Text(
                'Nowy sezon, nowy silos. Wybierz pseudonim i specjalizację: zostają z Tobą do końca sezonu.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: Ls.textMuted),
              ),
              const SizedBox(height: 20),
              const Text('PSEUDONIM', style: lsLabel),
              const SizedBox(height: 8),
              TextField(
                controller: _nick,
                maxLength: 20,
                enabled: !busy,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => busy ? null : _submit(),
                style: const TextStyle(fontSize: 16, color: Ls.text),
                cursorColor: Ls.amber,
                decoration: InputDecoration(
                  hintText: 'np. Sztygar',
                  hintStyle: const TextStyle(color: Ls.textFaint),
                  helperText: '3–20 znaków: litery, cyfry, spacja, _ lub -',
                  helperStyle: const TextStyle(color: Ls.textFaint),
                  counterStyle: const TextStyle(color: Ls.textFaint),
                  filled: true,
                  fillColor: Ls.card,
                  prefixIcon: const Icon(Icons.badge_outlined, color: Ls.textMuted),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Ls.border)),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Ls.amber, width: 1.5)),
                  disabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Ls.border)),
                ),
              ),
              const SizedBox(height: 12),
              const Text('SPECJALIZACJA', style: lsLabel),
              const SizedBox(height: 8),
              RadioGroup<String>(
                groupValue: _arch,
                onChanged: (v) {
                  if (!busy && v != null) setState(() => _arch = v);
                },
                child: Column(children: [
                  for (final e in archetypeInfo.entries)
                    _ArchetypeCard(
                      id: e.key,
                      name: e.value.$1,
                      desc: e.value.$2,
                      color: _accent[e.key] ?? Ls.amber,
                      selected: _arch == e.key,
                      enabled: !busy,
                      onTap: () => setState(() => _arch = e.key),
                    ),
                ]),
              ),
              if (_err != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4, bottom: 8),
                  child: Semantics(
                    liveRegion: true,
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Icon(Icons.error_outline, color: Ls.warnText, size: 18),
                      const SizedBox(width: 8),
                      Expanded(child: Text(_err!, style: const TextStyle(fontSize: 13, color: Ls.warnText))),
                    ]),
                  ),
                ),
              const SizedBox(height: 8),
              LsButton(busy ? 'Tworzę silos…' : 'Zacznij', color: Ls.amber, onPressed: busy ? null : _submit),
            ],
          ),
        ),
      ),
    );
  }
}

/// Karta archetypu: radio + ikona + nazwa + opis. Wybór widać po radiu, ramce i znaczniku (nie tylko kolorze).
class _ArchetypeCard extends StatelessWidget {
  const _ArchetypeCard({required this.id, required this.name, required this.desc, required this.color, required this.selected, required this.enabled, required this.onTap});
  final String id;
  final String name;
  final String desc;
  final Color color;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final icon = switch (id) {
      'gornik' => SlotIcon('narzedzie', color: color, size: 24),
      'inzynier' => Icon(Icons.engineering_outlined, color: color),
      'zwiadowca' => Icon(Icons.explore_outlined, color: color),
      'alchemik' => Icon(Icons.science_outlined, color: color),
      _ => Icon(Icons.person_outline, color: color),
    };
    return MergeSemantics(
      child: LsCard(
        onTap: enabled ? onTap : null,
        color: selected ? color.withValues(alpha: 0.08) : Ls.card,
        border: selected ? color : null,
        padding: const EdgeInsets.fromLTRB(4, 8, 12, 8),
        child: Row(children: [
          Radio<String>(value: id, enabled: enabled, activeColor: color),
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(12)),
            child: icon,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: lsDisplay.copyWith(fontSize: 16)),
              const SizedBox(height: 2),
              Text(desc, style: lsMuted),
            ]),
          ),
          if (selected) ...[const SizedBox(width: 8), Text('✓', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: color))],
        ]),
      ),
    );
  }
}
