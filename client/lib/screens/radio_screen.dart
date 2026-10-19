import 'package:flutter/material.dart';
import '../app_state.dart';
import '../format.dart';
import '../widgets.dart';

/// Radio: nasłuch sygnałów innych silosów, namierzanie (kontakt) i włączanie nadawania.
class RadioScreen extends StatelessWidget {
  final AppState state;
  const RadioScreen({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Loader(
      load: () => state.api.get('/radio'),
      builder: (context, data, reload) {
        final d = asMap(data);
        final signals = asList(d['signals']);
        final receiver = d['receiver'] == true;
        final transmitter = d['transmitter'] == true;
        final cost = asNum(d['contactSteam']).toInt();
        return ListenableBuilder(
          listenable: state,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Radiostacja poz. ${d['level']}', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              Text([
                receiver ? 'Odbiornik: zasięg ${fmtInt(asNum(d['rangeKm']))} km' : 'Odbiornik: niedostępny',
                transmitter ? 'Nadajnik: tak' : 'Nadajnik: niedostępny',
                if (d['cipher'] == true) 'Szyfr',
                if (d['relays'] == true) 'Przekaźniki',
              ].join('  ·  ')),
              const SizedBox(height: 8),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Nadawanie'),
                subtitle: Text(transmitter ? 'Inni mogą Cię usłyszeć i namierzyć; tylko nadający widzą ranking i mogą atakować.' : 'Rozbuduj Radiostację, żeby nadawać.'),
                value: d['on'] == true,
                onChanged: (!transmitter || state.busy)
                    ? null
                    : (v) => act(state, () async {
                          await state.api.post('/radio/broadcast', body: {'on': v});
                        }, reload),
              ),
              const SectionTitle('Nasłuch'),
              if (!receiver) const EmptyNote('Bez Odbiornika nic nie usłyszysz. Rozbuduj Radiostację.'),
              if (receiver && signals.isEmpty) const EmptyNote('Cisza w eterze. Nikt w zasięgu nie nadaje.'),
              for (final s in signals)
                Card(
                  child: ListTile(
                    leading: Icon(s['contacted'] == true ? Icons.person : Icons.settings_input_antenna),
                    title: Text(s['contacted'] == true ? '${s['nickname']}  ·  poz. ${s['level']}' : 'Nieznany sygnał'),
                    subtitle: Text('kierunek ${s['sector']}  ·  ok. ${fmtInt(asNum(s['distanceKm']))} km'),
                    trailing: s['contacted'] == true
                        ? const Icon(Icons.check, color: Colors.greenAccent)
                        : FilledButton.tonal(
                            onPressed: state.busy
                                ? null
                                : () => act(state, () => state.api.post('/radio/contact', body: {'signalId': s['id']}, idempotent: true), reload,
                                    ctx: context, okText: 'Namierzono sygnał'),
                            child: Text('Namierz ($cost pary)'),
                          ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
