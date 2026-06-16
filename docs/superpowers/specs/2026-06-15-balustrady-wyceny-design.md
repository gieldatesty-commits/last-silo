# BaluSTRADY — Aplikacja do Wycen Balustrad Nierdzewnych

**Data:** 2026-06-15  
**Status:** Zatwierdzony

---

## Cel

Webowa aplikacja dla kilku pracowników firmy produkcyjnej, umożliwiająca szybkie tworzenie wycen balustrad nierdzewnych, generowanie ofert PDF i eksport do Excel.

---

## Technologia

- **Framework:** Next.js 15 (App Router)
- **Hosting:** Vercel
- **Baza danych:** PostgreSQL przez Vercel Marketplace (Neon)
- **ORM:** Prisma
- **PDF:** `@react-pdf/renderer` (server-side)
- **Excel:** `xlsx` (SheetJS)
- **Auth:** magic link przez Resend (bez haseł)
- **UI:** Tailwind CSS + shadcn/ui

---

## Ekrany

### 1. Lista wycen (`/quotes`)
- Tabela wszystkich ofert z kolumnami: numer, klient, data, wartość brutto, status, autor
- Filtrowanie po kliencie i zakresie dat
- Status: `szkic` / `wysłana` / `zaakceptowana`
- Akcje per wiersz: otwórz, duplikuj, usuń
- Przycisk „Nowa wycena"

### 2. Edycja wyceny (`/quotes/[id]`)
Jeden ekran, dwie kolumny:

**Lewa kolumna:**
- Dane klienta: nazwa, adres budowy, telefon, email
- Tabela elementów z kolumnami: nazwa, ilość, jednostka (mb/szt/kpl), cena jednostkowa (edytowalna, z cennika jako domyślna), wartość
- Przycisk „+ Dodaj element" (wybór z listy elementów cennika lub wpisanie własnego)
- Pole „Narzut %" (domyślnie np. 20%)

**Prawa kolumna (na żywo):**
- Suma materiałów netto
- Suma robocizny netto
- Narzut (kwota)
- Razem netto / VAT 23% / Razem brutto
- Przyciski: Zapisz, Generuj PDF, Eksport Excel, Zmień status

### 3. Cennik (`/price-list`)
- Tabela elementów: nazwa, jednostka, cena bazowa netto
- Edycja inline lub przez modal
- Dodawanie / usuwanie elementów
- Zmiany obowiązują od następnej wyceny (nie retroaktywnie)

### 4. Ustawienia firmy (`/settings`)
- Logo (upload pliku)
- Nazwa firmy, NIP, adres, telefon, email
- Domyślna ważność oferty (dni)
- Domyślny narzut %
- Dane zapisywane jako JSON w tabeli `company_settings`

---

## Model danych

```sql
-- Wyceny
quote {
  id           uuid PK
  number       string UNIQUE  -- format: YYYY/MM/NNN
  client_name  string
  client_addr  string
  client_phone string?
  client_email string?
  markup_pct   decimal        -- narzut %
  status       enum(draft, sent, accepted)
  created_by   string         -- email użytkownika
  created_at   datetime
  updated_at   datetime
}

-- Pozycje wyceny
quote_item {
  id           uuid PK
  quote_id     uuid FK
  name         string
  quantity     decimal
  unit         string         -- mb, szt, kpl, m2
  unit_price   decimal        -- cena netto z narzutem
  sort_order   int
}

-- Cennik bazowy
price_list_item {
  id           uuid PK
  name         string
  unit         string
  base_price   decimal        -- cena netto bez narzutu
  category     string?        -- pochwyt / słupek / wypełnienie / montaż
  active       bool
}

-- Ustawienia firmy (jeden wiersz)
company_settings {
  id           uuid PK
  name         string
  nip          string
  address      string
  phone        string
  email        string
  logo_url     string?
  quote_validity_days int
  default_markup_pct  decimal
}
```

---

## Generowanie PDF

- Numer oferty: `YYYY/MM/NNN` (auto-inkrementowany per miesiąc)
- Zawartość: logo firmy, dane firmy, dane klienta, numer i data, tabela pozycji (nazwa / ilość / j.m. / cena jedn. / wartość), suma netto, VAT 23%, suma brutto
- Stopka: „Oferta ważna X dni" + dane kontaktowe
- Narzut nie jest widoczny dla klienta — wbudowany w ceny jednostkowe

---

## Eksport Excel

- Jeden arkusz z tymi samymi kolumnami co tabela w PDF
- Wiersz podsumowania na dole

---

## Autoryzacja

- Magic link wysyłany na adres email
- Sesja przez NextAuth.js (lub Auth.js)
- Wszyscy zalogowani użytkownicy mają równe uprawnienia (brak ról na starcie)
- Cennik i ustawienia firmy dostępne dla każdego zalogowanego

---

## Poza zakresem (v1)

- Zarządzanie rolami i uprawnieniami
- Integracja z systemem fakturowym
- Automatyczne powiadomienia email do klienta
- Wersjonowanie wycen
- Konfigurator publiczny dla klientów
