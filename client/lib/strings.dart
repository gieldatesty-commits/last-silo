import 'format.dart';

/// Teksty interfejsu (PL). Dane z serwera mają własne polskie nazwy (budynki, trasy);
/// tu są etykiety klienta i komunikaty błędów. Do przeniesienia do l10n przy drugim języku.
const resourceNames = {
  'ore': 'Ruda',
  'steam': 'Para',
  'tokens': 'Żetony',
  'samples': 'Próbki',
  'miedz': 'Miedź',
  'krysztal': 'Kryształy',
  'siarka': 'Siarka',
};

const archetypeInfo = {
  'gornik': ('Górnik', 'Więcej rudy ze zjazdów (+10%).'),
  'inzynier': ('Inżynier', 'Ulepszenia budynków tańsze o 10%.'),
  'zwiadowca': ('Zwiadowca', 'Zjazdy kosztują o 10% mniej pary.'),
  'alchemik': ('Alchemik', 'Specjalista od próbek i badań.'),
};

/// Klucze jak `dives.zones` w config/game.yaml (strefa `jadro` to w configu „Strefa rdzenia”).
const zoneNames = {'gorne': 'Górne', 'glebokie': 'Głębokie', 'jadro': 'Rdzeń'};

/// Występowanie materiału w regionie silosu (`/geology` → `local`).
const localNames = {'obfity': 'obfity', 'sredni': 'średni', 'slady': 'ślady'};

const richnessNames = {
  'bogate': 'bogate złoże',
  'srednie': 'średnie złoże',
  'ubogie': 'ubogie złoże',
  'na_wyczerpaniu': 'złoże na wyczerpaniu',
};

const _errors = {
  'network': 'Brak połączenia z serwerem. Spróbuj ponownie.',
  'insufficient_ore': 'Za mało rudy.',
  'insufficient_steam': 'Za mało pary.',
  'queue_full': 'Kolejka jest pełna.',
  'short_route_only': 'Dodatkowe miejsce w kolejce (Wygoda) przyjmuje tylko krótkie trasy.',
  'max_level': 'Budynek ma już maksymalny poziom.',
  'level_too_low': 'Za niski poziom gracza.',
  'winded': 'Jesteś wyczerpany po nieudanym zjeździe. Odpocznij.',
  'nickname_taken': 'Ten pseudonim jest już zajęty.',
  'already_created': 'Postać już istnieje.',
  'unknown_archetype': 'Nieznany archetyp.',
  'bad_request': 'Nieprawidłowe dane.',
  'season_ended': 'Sezon się skończył. Poczekaj na start następnego.',
  'unauthorized': 'Sesja wygasła. Spróbuj ponownie.',
  'too_many_requests': 'Za dużo prób. Odczekaj chwilę.',
  'account_already_linked': 'Ta postać jest już połączona z innym kontem Google.',
  'google_in_use': 'To konto Google jest już połączone z inną postacią.',
  'no_linked_account': 'To konto Google nie jest połączone z żadną postacią. Zagraj jako gość i połącz konto w Więcej → Konto.',
  'bad_google_token': 'Google nie potwierdził logowania. Spróbuj ponownie.',
  'bad_nonce': 'Logowanie Google wygasło. Spróbuj ponownie.',
  'google_disabled': 'Logowanie Google jest teraz niedostępne.',
  'google_failed': 'Nie udało się zalogować przez Google. Spróbuj ponownie.',
  'internal': 'Błąd serwera. Spróbuj za chwilę.',
  'no_player': 'Najpierw utwórz postać.',
  'workshop_too_low': 'Warsztat ma za niski poziom.',
  'radio_too_low': 'Radiostacja ma za niski poziom.',
  'lab_too_low': 'Laboratorium ma za niski poziom.',
  'recipe_locked': 'Receptura jest zablokowana (wymaga badania).',
  'inventory_full': 'Ekwipunek jest pełny.',
  'nothing_to_repair': 'Przedmiot jest nienaruszony.',
  'max_tier': 'Przedmiot ma już maksymalne wzmocnienie.',
  'no_item': 'Nie ma takiego przedmiotu.',
  'unknown_recipe': 'Nieznana receptura.',
  'unknown_tech': 'Nieznane badanie.',
  'unknown_route': 'Nieznana trasa.',
  'unknown_material': 'Nieznany materiał.',
  'research_busy': 'Laboratorium już prowadzi badanie.',
  'prerequisites_missing': 'Brakuje wcześniejszych badań.',
  'already_researched': 'To badanie jest już ukończone.',
  'no_receiver': 'Potrzebujesz Odbiornika (Radiostacja).',
  'no_transmitter': 'Potrzebujesz Nadajnika (Radiostacja).',
  'not_transmitting': 'Włącz nadawanie, żeby to zobaczyć.',
  'no_signal': 'Sygnał zniknął.',
  'no_contact': 'Najpierw namierz ten silos.',
  'no_target': 'Nie ma takiego celu.',
  'bad_target': 'Nieprawidłowy cel.',
  'raid_in_progress': 'Twój najazd jest już w toku.',
  'daily_limit': 'Dzienny limit najazdów wyczerpany.',
  'target_daily_limit': 'Ten cel był już dziś atakowany zbyt często.',
  'target_cooldown': 'Ten cel odpoczywa po ostatnim najeździe.',
  'target_protected': 'Cel jest pod ochroną.',
  'target_silent': 'Cel zamilkł.',
  'out_of_league': 'Cel jest poza Twoją ligą.',
  'not_enough_points': 'Za mało wolnych punktów.',
  'bad_qty': 'Nieprawidłowa ilość.',
  'price_out_of_range': 'Cena poza dozwolonym korytarzem.',
  'too_many_listings': 'Masz już maksymalnie ofert.',
  'too_many_shipments': 'Za dużo karawan w drodze.',
  'too_many_contracts': 'Masz już maksymalnie zleceń w drodze.',
  'no_listing': 'Oferty już nie ma.',
  'listing_closed': 'Oferta jest zamknięta.',
  'own_listing': 'To Twoja oferta.',
  'not_enough_qty': 'W ofercie jest mniej sztuk.',
  'bot_daily_limit': 'Dzienny limit sprzedaży botom wyczerpany.',
  'no_offer': 'Nie ma takiego zlecenia.',
  'offer_expired': 'Zlecenie wygasło.',
  'offer_taken': 'Ktoś był szybszy: zlecenie jest już zajęte.',
  'already_accepted': 'Już przyjęte.',
  'already_active': 'Ten zestaw jest już aktywny.',
  'invalid_loadout': 'Nie ma takiego zestawu.',
  'not_equipped': 'Tego przedmiotu nie ma w tym zestawie.',
  'tech_required': 'Najpierw ukończ wymagane badanie.',
  'no_socket': 'Ten przedmiot nie ma takiego gniazda.',
  'socket_taken': 'To gniazdo jest już zajęte.',
  'socket_empty': 'To gniazdo jest puste.',
  'unknown_rune': 'Nie ma takiej runy.',
  'rune_not_craftable': 'Runy III zdobywa się tylko z łupu zjazdów.',
};

String errorText(String code) {
  if (_errors.containsKey(code)) return _errors[code]!;
  if (code.startsWith('insufficient_runa_')) return 'Za mało zasobu: ${runeLabelFromId(code.substring(13))}.';
  if (code.startsWith('insufficient_')) return 'Za mało zasobu: ${resName(code.substring(13))}.';
  return 'Coś poszło nie tak ($code).';
}

/// Rodzaje run (klucze jak `kind` z API) — nazwy do run znanych tylko z id (np. łup w historii zjazdów).
const runeKindNames = {'zyly': 'Żyły', 'ostrza': 'Ostrza', 'bastionu': 'Bastionu', 'trwalosci': 'Trwałości'};
const _roman = ['I', 'II', 'III'];
String romanLevel(Object? level) => _roman[((level as num?)?.toInt() ?? 1).clamp(1, 3) - 1];

/// Runa z API (`{name, level}`) jako „Ostrza III”.
String runeLabel(Map r) => '${r['name']} ${romanLevel(r['level'])}';

/// Runa z samego id (`runa_ostrza_3`) jako „Ostrza III”.
String runeLabelFromId(String id) {
  final m = RegExp(r'^runa_([a-z]+)_([123])$').firstMatch(id);
  return m == null ? id : '${runeKindNames[m.group(1)] ?? m.group(1)} ${romanLevel(int.parse(m.group(2)!))}';
}

/// Efekt runy słowem: „zjazd +0.2”, „atak +0.6”, „obrona +1”, „naprawy −10%”.
String runeEffectText(Object? effect, Object? value) {
  final v = (value as num?) ?? 0;
  return switch (effect) {
    'dive' => 'zjazd +${fmtDec(v)}',
    'attack' => 'atak +${fmtDec(v)}',
    'defense' => 'obrona +${fmtDec(v)}',
    'repair_pct' => 'naprawy −${fmtDec(v.abs())}%',
    _ => '',
  };
}

/// Krótkie nazwy kompletów do kafelków zestawów (klucze jak `id` z API); pełna nazwa przychodzi z serwera.
const setShortNames = {'sztygar': 'Sztygar', 'rdzen': 'Rdzeń', 'wartownik': 'Wartownik'};

/// Efekty kompletu słowem, w kolejności z configu: „ruda ze zjazdów +5%, zjazd +0,8”.
String setEffectText(Map bonus) => [
      for (final e in bonus.entries)
        switch (e.key) {
          'dive_ore_pct' => 'ruda ze zjazdów +${fmtDec(e.value as num)}%',
          'dive_power' => 'zjazd +${fmtDec(e.value as num)}',
          'attack' => 'atak +${fmtDec(e.value as num)}',
          'defense' => 'obrona +${fmtDec(e.value as num)}',
          'repair_pct' => 'naprawy −${fmtDec((e.value as num).abs())}%',
          _ => '${e.key} ${e.value}',
        },
    ].join(', ');

/// Znaki rzadkości (klucze jak `rarity.id` z API): rzadkość widać znakiem i nazwą, nie tylko kolorem.
const rarityMarks = {'zwykly': '●', 'solidny': '◆', 'mistrzowski': '★', 'unikatowy': '✦'};

/// Rzadkość przedmiotu z API (`{id, name}`) jako „◆ Solidny”; brak pola (stare API) = pusty tekst.
String rarityText(Object? r) => r is Map ? '${rarityMarks[r['id']] ?? '●'} ${r['name'] ?? r['id']}' : '';

/// Numer zestawu ekwipunku (1, 2) jako cyfra rzymska, tak jak w grze: „Zestaw I”, „Zestaw II”.
String loadoutName(Object? n) => n == 2 ? 'II' : 'I';

const slotNames = {'narzedzie': 'Narzędzie', 'ochrona': 'Ochrona', 'lampa': 'Lampa', 'sprzet': 'Sprzęt'};
const branchNames = {'gornictwo': 'Górnictwo', 'inzynieria': 'Inżynieria', 'rdzeniowcy': 'Rdzeniowcy'};
const strengthNames = {'slabszy': 'słabszy od Ciebie', 'rowny': 'podobny do Ciebie', 'silniejszy': 'silniejszy od Ciebie'};
const statNames = {'sila': 'Siła', 'technika': 'Technika', 'percepcja': 'Percepcja', 'wytrwalosc': 'Wytrwałość'};
const materialIds = ['miedz', 'krysztal', 'siarka'];
String resName(String id) => resourceNames[id] ?? id;

/// Opis efektu badania po polsku.
String effectText(Map effect) {
  const labels = {
    'dive_ore_pct': (r'Ruda ze zjazdów', '%'),
    'dive_power': ('Siła zjazdu', ''),
    'dive_steam_pct': ('Koszt pary zjazdu', '%'),
    'upgrade_cost_pct': ('Koszt ulepszeń budynków', '%'),
    'repair_pct': ('Koszt napraw', '%'),
    'quality': ('Jakość wytwarzanych przedmiotów', ''),
    'samples_pct': ('Próbki ze zjazdów', '%'),
    'winded_pct': ('Czas wyczerpania', '%'),
  };
  return effect.entries.map((e) {
    final l = labels[e.key];
    final v = e.value as num;
    final sign = v > 0 ? '+' : '';
    return l == null ? '${e.key} $v' : '${l.$1} $sign$v${l.$2}';
  }).join(', ');
}
