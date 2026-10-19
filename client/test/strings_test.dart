import 'package:flutter_test/flutter_test.dart';
import 'package:lastsilo/strings.dart';
import 'package:lastsilo/widgets.dart';

void main() {
  test('errorText: znane kody, zasoby i nieznane', () {
    expect(errorText('insufficient_ore'), 'Za mało rudy.');
    expect(errorText('insufficient_miedz'), 'Za mało zasobu: Miedź.');
    expect(errorText('offer_taken'), contains('zajęte'));
    expect(errorText('cos_nowego'), contains('cos_nowego'));
  });

  test('effectText', () {
    expect(effectText({'dive_ore_pct': 3}), 'Ruda ze zjazdów +3%');
    expect(effectText({'dive_steam_pct': -4}), 'Koszt pary zjazdu -4%');
    expect(effectText({'winded_pct': -25, 'dive_power': 0.3}), 'Czas wyczerpania -25%, Siła zjazdu +0.3');
  });

  test('costText', () {
    expect(costText({'ore': 150, 'tokens': 0}), '150 rudy');
    expect(costText({'ore': 3500, 'tokens': 25, 'materials': {'miedz': 20}}), '3 500 rudy, 25 żet., 20 Miedź');
    expect(costText({'ore': 0}), 'za darmo');
  });
}
