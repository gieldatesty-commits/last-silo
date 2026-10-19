import 'package:flutter/material.dart';
import '../app_state.dart';
import '../strings.dart';
import 'dives_screen.dart';
import 'silo_screen.dart';

/// Dolna nawigacja. Kolejne ekrany (warsztat, radio, rynek…) dochodzą jako kolejne zakładki.
class Shell extends StatefulWidget {
  final AppState state;
  const Shell({super.key, required this.state});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_showError);
  }

  @override
  void dispose() {
    widget.state.removeListener(_showError);
    super.dispose();
  }

  /// Błędy akcji pokazujemy jako pasek na dole, niezależnie od zakładki.
  void _showError() {
    final code = widget.state.consumeError();
    if (code == null || !mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(errorText(code))));
  }

  @override
  Widget build(BuildContext context) {
    final pages = [SiloScreen(state: widget.state), DivesScreen(state: widget.state)];
    return Scaffold(
      body: SafeArea(child: IndexedStack(index: _tab, children: pages)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_work_outlined), selectedIcon: Icon(Icons.home_work), label: 'Silos'),
          NavigationDestination(icon: Icon(Icons.arrow_downward_outlined), selectedIcon: Icon(Icons.arrow_downward), label: 'Zjazdy'),
        ],
      ),
    );
  }
}
