import { GoogleAuth, OAuth2Client } from 'google-auth-library';

/**
 * Stan subskrypcji w Google Play (purchases.subscriptionsv2), zredukowany do pól, których używamy.
 * `state` to surowa wartość `subscriptionState` z Google (np. SUBSCRIPTION_STATE_ACTIVE).
 */
export interface PlaySubscription {
  productId: string;
  state: string;
  startTime: Date;
  /** koniec dostępu; w grace Google go wydłuża, przy on hold ustawia w przeszłości */
  expiryTime: Date;
  autoRenewing: boolean;
  linkedPurchaseToken: string | null;
  acknowledged: boolean;
  /** to, co klient podał jako obfuscatedAccountId przy zakupie */
  obfuscatedAccountId: string | null;
  testPurchase: boolean;
  raw: unknown;
}

/** Granica do Google Play. Prawdziwa implementacja w GooglePlayBillingClient, atrapa w FakePlayBilling. */
export interface PlayBillingClient {
  /** Aktualny stan zakupu. `null`, gdy Google nie zna tokenu (404/410: nieważny albo wygasł ponad 60 dni temu). */
  getSubscription(purchaseToken: string): Promise<PlaySubscription | null>;
  /** Potwierdzenie zakupu (idempotentne po stronie Google). */
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
  /** Weryfikacja nagłówka Authorization z Pub/Sub push (OIDC JWT od Google). */
  verifyPushAuth(authorization: string | undefined): Promise<boolean>;
}

export class BillingUnavailable extends Error {}

export interface GooglePlayBillingOptions {
  packageName: string;
  /** zawartość pliku JSON klucza konta serwisowego (nie ścieżka) */
  serviceAccountJson: string;
  /** audience ustawione w subskrypcji push Pub/Sub */
  rtdnAudience: string;
  /** e-mail konta serwisowego, którym podpisuje Pub/Sub push */
  rtdnServiceAccountEmail: string;
  fetchTimeoutMs?: number;
}

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

/** Klient Google Play Developer API v3 (subscriptionsv2.get, subscriptions.acknowledge) i weryfikator OIDC dla RTDN. */
export class GooglePlayBillingClient implements PlayBillingClient {
  private readonly auth: GoogleAuth;
  private readonly oidc = new OAuth2Client();

  constructor(private readonly opt: GooglePlayBillingOptions) {
    this.auth = new GoogleAuth({ credentials: JSON.parse(opt.serviceAccountJson), scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  }

  async getSubscription(purchaseToken: string): Promise<PlaySubscription | null> {
    const client = await this.auth.getClient();
    const url = `${API}/${encodeURIComponent(this.opt.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    try {
      const res = await client.request<GoogleSubscriptionV2>({ url, method: 'GET', timeout: this.opt.fetchTimeoutMs ?? 10_000 });
      return parseSubscriptionV2(res.data);
    } catch (e) {
      const status = (e as { status?: number; response?: { status?: number } }).response?.status ?? (e as { status?: number }).status;
      if (status === 404 || status === 410) return null;
      throw new BillingUnavailable(`subscriptionsv2.get: ${status ?? (e as Error).message}`);
    }
  }

  async acknowledge(productId: string, purchaseToken: string): Promise<void> {
    const client = await this.auth.getClient();
    const url = `${API}/${encodeURIComponent(this.opt.packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
    try {
      await client.request({ url, method: 'POST', data: {}, timeout: this.opt.fetchTimeoutMs ?? 10_000 });
    } catch (e) {
      throw new BillingUnavailable(`subscriptions.acknowledge: ${(e as Error).message}`);
    }
  }

  async verifyPushAuth(authorization: string | undefined): Promise<boolean> {
    const m = /^Bearer (.+)$/.exec(authorization ?? '');
    if (!m) return false;
    try {
      const ticket = await this.oidc.verifyIdToken({ idToken: m[1]!, audience: this.opt.rtdnAudience });
      const p = ticket.getPayload();
      return !!p && p.email === this.opt.rtdnServiceAccountEmail && p.email_verified === true && (p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com');
    } catch {
      return false;
    }
  }
}

/** Fragment SubscriptionPurchaseV2, z którego korzystamy (nazwy pól jak w dokumentacji Google). */
export interface GoogleSubscriptionV2 {
  subscriptionState?: string;
  startTime?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  testPurchase?: object;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean }; prepaidPlan?: object }[];
}

/** SubscriptionPurchaseV2 → PlaySubscription. Bierzemy pozycję o najpóźniejszym expiryTime (jeden produkt bez dodatków). */
export function parseSubscriptionV2(d: GoogleSubscriptionV2): PlaySubscription {
  const items = [...(d.lineItems ?? [])].sort((a, b) => Date.parse(b.expiryTime ?? '0') - Date.parse(a.expiryTime ?? '0'));
  const li = items[0];
  if (!li?.productId || !li.expiryTime) throw new BillingUnavailable('subscriptionsv2: brak lineItems');
  return {
    productId: li.productId,
    state: d.subscriptionState ?? 'SUBSCRIPTION_STATE_UNSPECIFIED',
    startTime: new Date(d.startTime ?? li.expiryTime),
    expiryTime: new Date(li.expiryTime),
    autoRenewing: li.autoRenewingPlan?.autoRenewEnabled === true,
    linkedPurchaseToken: d.linkedPurchaseToken ?? null,
    acknowledged: d.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    obfuscatedAccountId: d.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    testPurchase: d.testPurchase !== undefined,
    raw: d,
  };
}

/** Atrapa Google Play do testów i dev: stan zakupów trzymany w pamięci. */
export class FakePlayBilling implements PlayBillingClient {
  readonly purchases = new Map<string, PlaySubscription>();
  readonly acknowledged: string[] = [];
  /** wartość nagłówka Authorization, którą atrapa uznaje za poprawny token Pub/Sub */
  pushAuth = 'Bearer test-push-token';
  failNext = false;

  set(token: string, p: Partial<PlaySubscription> & Pick<PlaySubscription, 'productId' | 'expiryTime'>) {
    const prev = this.purchases.get(token);
    this.purchases.set(token, {
      state: 'SUBSCRIPTION_STATE_ACTIVE',
      startTime: prev?.startTime ?? new Date(p.expiryTime.getTime() - 30 * 86_400_000),
      autoRenewing: true,
      linkedPurchaseToken: null,
      acknowledged: prev?.acknowledged ?? false,
      obfuscatedAccountId: null,
      testPurchase: true,
      raw: {},
      ...prev,
      ...p,
    });
  }

  async getSubscription(token: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new BillingUnavailable('fake: awaria');
    }
    const p = this.purchases.get(token);
    return p ? { ...p } : null;
  }

  async acknowledge(_productId: string, token: string) {
    const p = this.purchases.get(token);
    if (p) p.acknowledged = true;
    this.acknowledged.push(token);
  }

  async verifyPushAuth(authorization: string | undefined) {
    return authorization === this.pushAuth;
  }
}
