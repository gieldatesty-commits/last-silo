import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET musi mieć min. 16 znaków'),
  GAME_CONFIG_PATH: z.string().default('../config/game.yaml'),
  PORT: z.coerce.number().default(3000),
  // Google Play Billing (subskrypcja „Wygoda”). Bez kompletu zmiennych płatności są wyłączone (503 billing_disabled).
  GOOGLE_PLAY_PACKAGE_NAME: z.string().min(1).optional(),
  /** zawartość JSON klucza konta serwisowego z dostępem do Play Developer API; tylko sekret środowiska, nigdy repo */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  /** audience ustawione w subskrypcji push Pub/Sub dla RTDN */
  RTDN_AUDIENCE: z.string().min(1).optional(),
  /** e-mail konta serwisowego, którym Pub/Sub podpisuje żądania push */
  RTDN_SERVICE_ACCOUNT_EMAIL: z.string().min(1).optional(),
  /** klucz HMAC do zaciemnionego identyfikatora konta (obfuscatedAccountId); zmiana unieważnia powiązania zakupów */
  BILLING_ACCOUNT_KEY: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;
// puste zmienne (np. `${VAR:-}` w docker-compose) traktujemy jak nieustawione
export const loadEnv = (src: NodeJS.ProcessEnv = process.env): Env => EnvSchema.parse(Object.fromEntries(Object.entries(src).filter(([, v]) => v !== '')));

/** Komplet zmiennych płatności albo null (płatności wyłączone). Częściowa konfiguracja to błąd startu. */
export function billingEnv(env: Env) {
  const keys = ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'RTDN_AUDIENCE', 'RTDN_SERVICE_ACCOUNT_EMAIL', 'BILLING_ACCOUNT_KEY'] as const;
  const set = keys.filter((k) => env[k] !== undefined);
  if (set.length === 0) return null;
  if (set.length !== keys.length) throw new Error(`Płatności: brak zmiennych ${keys.filter((k) => env[k] === undefined).join(', ')}`);
  return {
    packageName: env.GOOGLE_PLAY_PACKAGE_NAME!,
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON!,
    rtdnAudience: env.RTDN_AUDIENCE!,
    rtdnServiceAccountEmail: env.RTDN_SERVICE_ACCOUNT_EMAIL!,
    accountKey: env.BILLING_ACCOUNT_KEY!,
  };
}
