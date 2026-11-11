import 'package:flutter/material.dart';
import 'palette.dart';

/// Wspólne klocki warstwy wizualnej (ekrany z „Więcej”): karta, chip, przyciski, nagłówek, pasek.
/// Wysokości są minimalne, nie stałe: przy dużej czcionce elementy rosną zamiast ucinać tekst.

const lsDisplay = TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, color: Ls.text);
const lsLabel = TextStyle(fontFamily: Ls.display, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.6, color: Ls.copper);
const lsMuted = TextStyle(fontSize: 12, color: Ls.textMuted);
const lsBody = TextStyle(fontSize: 14, color: Ls.text);

/// Karta: ciemne tło, cienka ramka, zaokrąglenie 14. Z `onTap` staje się przyciskiem (InkWell + Semantics).
class LsCard extends StatelessWidget {
  const LsCard({super.key, required this.child, this.padding = const EdgeInsets.all(12), this.margin = const EdgeInsets.only(bottom: 8), this.border, this.color = Ls.card, this.onTap});
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry margin;
  final Color? border;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: border ?? Ls.border));
    return Padding(
      padding: margin,
      child: Material(
        color: color,
        shape: shape,
        clipBehavior: Clip.antiAlias,
        child: onTap == null ? Padding(padding: padding, child: child) : InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
      ),
    );
  }
}

/// Chip informacyjny; `ok: false` = brak/ostrzeżenie (obramowanie i ciepły tekst, nie tylko kolor tła).
class LsChip extends StatelessWidget {
  const LsChip(this.text, {super.key, this.ok = true, this.color});
  final String text;
  final bool ok;
  final Color? color;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: ok ? (color?.withValues(alpha: 0.14) ?? Ls.chip) : null,
          borderRadius: BorderRadius.circular(10),
          border: ok ? (color == null ? null : Border.all(color: color!.withValues(alpha: 0.6))) : Border.all(color: Ls.warn),
        ),
        child: Text(text, style: TextStyle(fontSize: 12, color: ok ? (color ?? const Color(0xFFC9D0DC)) : Ls.warnText)),
      );
}

/// Główny przycisk akcji (wypełniony kolorem). Bez `onPressed` = nieaktywny z przerywaną ramką i tym samym napisem.
class LsButton extends StatelessWidget {
  const LsButton(this.label, {super.key, required this.onPressed, this.color = Ls.copper, this.expand = true, this.secondary = false});
  final String label;
  final VoidCallback? onPressed;
  final Color color;
  final bool expand;

  /// obramowany zamiast wypełnionego (akcja poboczna)
  final bool secondary;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(10));
    const text = TextStyle(fontSize: 13, fontWeight: FontWeight.w600);
    const pad = EdgeInsets.symmetric(horizontal: 12, vertical: 10);
    final min = Size(expand ? double.infinity : 0, 44);
    final child = Text(label, textAlign: TextAlign.center);
    if (onPressed == null) {
      return OutlinedButton(
        onPressed: null,
        style: OutlinedButton.styleFrom(minimumSize: min, padding: pad, shape: shape, textStyle: text, disabledForegroundColor: Ls.textMuted, side: const BorderSide(color: Ls.locked)),
        child: child,
      );
    }
    if (secondary) {
      return OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(minimumSize: min, padding: pad, shape: shape, textStyle: text, foregroundColor: Ls.text, backgroundColor: const Color(0xFF1A1410), side: BorderSide(color: color)),
        child: child,
      );
    }
    return FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(minimumSize: min, padding: pad, shape: shape, textStyle: text, backgroundColor: color, foregroundColor: Ls.bg),
      child: child,
    );
  }
}

/// Nagłówek ekranu: duży tytuł, podpis i opcjonalny element z prawej (np. licznik).
/// `title: null` = sam opis (gdy tytuł jest już w pasku aplikacji).
class LsHeader extends StatelessWidget {
  const LsHeader(this.title, {super.key, this.subtitle, this.trailing, this.leading});
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final Widget? leading;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          if (leading != null) ...[leading!, const SizedBox(width: 12)],
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (title != null) Semantics(header: true, child: Text(title!, style: lsDisplay.copyWith(fontSize: 22))),
              if (subtitle != null) ...[if (title != null) const SizedBox(height: 4), Text(subtitle!, style: title == null ? lsBody : lsMuted)],
            ]),
          ),
          if (trailing != null) ...[const SizedBox(width: 12), trailing!],
        ]),
      );
}

/// Pasek postępu/wartości 0..1 z zaokrągleniem.
class LsMeter extends StatelessWidget {
  const LsMeter(this.value, {super.key, this.color = Ls.amber, this.height = 6});
  final double? value;
  final Color color;
  final double height;
  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(height / 2),
        child: LinearProgressIndicator(value: value?.clamp(0.0, 1.0), minHeight: height, color: color, backgroundColor: Ls.border),
      );
}

/// Duża liczba z małym podpisem (statystyka w nagłówku).
class LsStat extends StatelessWidget {
  const LsStat(this.label, this.value, {super.key, this.sub, this.alignEnd = false});
  final String label;
  final String value;
  final String? sub;
  final bool alignEnd;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: const TextStyle(fontSize: 10, letterSpacing: 1.2, color: Ls.textFaint)),
        Text(value, style: lsDisplay.copyWith(fontSize: 17, fontFeatures: const [FontFeature.tabularFigures()])),
        if (sub != null) Text(sub!, style: const TextStyle(fontSize: 10, color: Ls.textFaint)),
      ]);
}

/// Wiersz „ikona + opis + akcja”: na wąskim ekranie albo przy dużej czcionce akcja schodzi pod opis (pełna szerokość).
class LsActionRow extends StatelessWidget {
  const LsActionRow({super.key, this.leading, required this.body, required this.action});
  final Widget? leading;
  final Widget body;
  final Widget action;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final stacked = box.maxWidth < 300 || MediaQuery.textScalerOf(context).scale(1) > 1.3;
        final head = Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          if (leading != null) ...[leading!, const SizedBox(width: 12)],
          Expanded(child: body),
          if (!stacked) ...[const SizedBox(width: 8), action],
        ]);
        if (!stacked) return head;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [head, const SizedBox(height: 8), action]);
      });
}
