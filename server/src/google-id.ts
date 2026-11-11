import { OAuth2Client } from 'google-auth-library';

/** Sprawdzone dane z tokenu ID Google. Identyfikatorem konta jest wyłącznie `sub` (docs/konto-google-v1.0.md §0). */
export interface GoogleIdentity {
  sub: string;
  /** nonce z tokenu, jeśli klient go podał przy logowaniu */
  nonce: string | null;
}

/** Granica do Google: weryfikacja tokenu ID. Prawdziwa implementacja niżej, atrapa w FakeGoogleIdVerifier. */
export interface GoogleIdVerifier {
  /** Zwraca tożsamość albo `null`, gdy token jest nieważny (podpis, aud, iss, exp). */
  verify(idToken: string): Promise<GoogleIdentity | null>;
}

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** Weryfikacja przez google-auth-library: podpis kluczami Google, `aud` = nasz klient Web, `exp`; plus `iss`. */
export class GoogleOAuthIdVerifier implements GoogleIdVerifier {
  private readonly client = new OAuth2Client();
  constructor(private readonly webClientId: string) {}

  async verify(idToken: string): Promise<GoogleIdentity | null> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.webClientId });
      const p = ticket.getPayload();
      if (!p?.sub || !p.iss || !ISSUERS.has(p.iss)) return null;
      return { sub: p.sub, nonce: typeof p.nonce === 'string' ? p.nonce : null };
    } catch {
      return null;
    }
  }
}

/** Atrapa do testów: token → tożsamość ustawiona w teście; reszta to „zły token”. */
export class FakeGoogleIdVerifier implements GoogleIdVerifier {
  readonly tokens = new Map<string, GoogleIdentity>();
  async verify(idToken: string) {
    return this.tokens.get(idToken) ?? null;
  }
}
