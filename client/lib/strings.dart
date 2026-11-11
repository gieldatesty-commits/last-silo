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
  'max_level': 'Budynek ma już maksymalny poziom.',
  'level_too_low': 'Za niski poziom gracza.',
  'winded': 'Jesteś wyczerpany po nieudanym zjeździe. Odpocznij.',
  'nickname_taken': 'Ten pseudonim jest już zajęty.',
  'already_created': 'Postać już istnieje.',
  'unknown_archetype': 'Nieznany archetyp.',
  'bad_request': 'Nieprawidłowe dane.',
  'season_ended': 'Sezon się skończył. Poczekaj na start następnego.',
  'unauthorized': 'Sesja wygasła. Spróbuj ponownie.',
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
};

String errorText(String code) {
  if (_errors.containsKey(code)) return _errors[code]!;
  if (code.startsWith('insufficient_')) return 'Za mało zasobu: ${resName(code.substring(13))}.';
  return 'Coś poszło nie tak ($code).';
}

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
