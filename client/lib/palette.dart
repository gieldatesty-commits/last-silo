import 'package:flutter/material.dart';

/// Paleta warstwy wizualnej (docs/warstwa-wizualna-v1.0.md §4). Jedno miejsce na kolory ekranów Silos i Laboratorium.
abstract final class Ls {
  static const bg = Color(0xFF0A0C12);
  static const rock = Color(0xFF1A1F2B);
  static const steel = Color(0xFF3A4558);
  static const steelLight = Color(0xFF55637A);
  static const copper = Color(0xFFC8794A);
  static const copperDark = Color(0xFF8E4F2E);
  static const amber = Color(0xFFF0B45A);
  static const teal = Color(0xFF62C9C0);
  static const violet = Color(0xFFB79CFF);
  static const text = Color(0xFFE8E3D6);

  // pochodne z makiet (panele, obramowania, tekst drugorzędny)
  static const panel = Color(0xFF0F131C);
  static const card = Color(0xFF10141D);
  static const border = Color(0xFF222B3A);
  static const chip = Color(0xFF1A2230);
  static const textMuted = Color(0xFFA5AEC0);
  static const textFaint = Color(0xFF7C899E);
  static const locked = Color(0xFF46536A);
  static const warn = Color(0xFFF0867A);
  static const warnText = Color(0xFFF0A89E);

  /// Czcionki z paczki (assets/fonts, OFL). Gdy zasobów brak, Flutter użyje domyślnej czcionki.
  static const display = 'SpaceGrotesk';
  static const body = 'Inter';
}
