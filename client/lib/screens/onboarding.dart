import 'package:flutter/material.dart';
import '../app_state.dart';
import '../strings.dart';

/// Tworzenie postaci: pseudonim + archetyp (raz na sezon).
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
    return Scaffold(
      appBar: AppBar(title: const Text('Zejdź do Głębi')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Kim jesteś?', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            controller: _nick,
            maxLength: 20,
            decoration: const InputDecoration(labelText: 'Pseudonim', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          for (final e in archetypeInfo.entries)
            RadioListTile<String>(
              value: e.key,
              groupValue: _arch,
              onChanged: busy ? null : (v) => setState(() => _arch = v!),
              title: Text(e.value.$1),
              subtitle: Text(e.value.$2),
            ),
          if (_err != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(_err!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: busy ? null : _submit,
            child: busy ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Zacznij'),
          ),
        ],
      ),
    );
  }
}
