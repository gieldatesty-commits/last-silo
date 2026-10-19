import 'package:flutter/material.dart';
import '../app_state.dart';
import '../strings.dart';
import 'dives_screen.dart';
import 'lab_screen.dart';
import 'more_screen.dart';
import 'silo_screen.dart';
import 'workshop_screen.dart';

/// Dolna nawigacja: Silos, Zjazdy, Warsztat, Laboratorium i menu „Więcej” (reszta ekranów).
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
    final pages = [
      SiloScreen(state: widget.state),
      DivesScreen(state: widget.state),
      WorkshopScreen(state: widget.state),
      LabScreen(state: widget.state),
      MoreScreen(state: widget.state),
    ];
    return Scaffold(
      // tylko aktywna zakładka: wejście na nią ładuje świeże dane z serwera
      body: SafeArea(child: KeyedSubtree(key: ValueKey(_tab), child: pages[_tab])),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_work_outlined), selectedIcon: Icon(Icons.home_work), label: 'Silos'),
          NavigationDestination(icon: Icon(Icons.arrow_downward_outlined), selectedIcon: Icon(Icons.arrow_downward), label: 'Zjazdy'),
          NavigationDestination(icon: Icon(Icons.build_outlined), selectedIcon: Icon(Icons.build), label: 'Warsztat'),
          NavigationDestination(icon: Icon(Icons.science_outlined), selectedIcon: Icon(Icons.science), label: 'Lab'),
          NavigationDestination(icon: Icon(Icons.menu), label: 'Więcej'),
        ],
      ),
    );
  }
}
