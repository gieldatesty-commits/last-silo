import { defineConfig } from 'vitest/config';

// testy integracyjne współdzielą jedną bazę, więc pliki idą po kolei
export default defineConfig({ test: { fileParallelism: false, testTimeout: 20000 } });
