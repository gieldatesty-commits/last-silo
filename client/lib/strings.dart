/// Teksty interfejsu (PL). Dane z serwera mają własne polskie nazwy (budynki, trasy);
/// tu są etykiety klienta i komunikaty błędów. Do przeniesienia do l10n przy drugim języku.
const resourceNames = {
  'ore': 'Ruda',
  'steam': 'Para',
  'tokens': 'Żetony',
  'samples': 'Próbki',
  'miedz': 'Miedź',
  'krysztal': 'Kryształ',
  'siarka': 'Siarka',
};

const archetypeInfo = {
  'gornik': ('Górnik', 'Więcej rudy ze zjazdów (+10%).'),
  'inzynier': ('Inżynier', 'Ulepszenia budynków tańsze o 10%.'),
  'zwiadowca': ('Zwiadowca', 'Zjazdy kosztują o 10% mniej pary.'),
  'alchemik': ('Alchemik', 'Specjalista od próbek i badań.'),
};

const zoneNames = {'gorne': 'Górne', 'glebokie': 'Głębokie', 'rdzen': 'Rdzeń'};

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
};

String errorText(String code) => _errors[code] ?? 'Coś poszło nie tak ($code).';
