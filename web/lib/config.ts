import { KlarityApi } from './api';

const ENV_KEY = 'NEXT_PUBLIC_KLARITY_API_BASE';

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_KLARITY_API_BASE;
  if (!base) {
    throw new Error(
      `${ENV_KEY} is not set. Point it at your Klarity API origin (see web/.env.example).`,
    );
  }
  return base;
}

export function makeApi(): KlarityApi {
  return new KlarityApi(apiBase());
}
