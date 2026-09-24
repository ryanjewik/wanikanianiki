/**
 * The API key this phone presents to the backend.
 *
 * Entered once on the profile screen and kept in the platform's secure
 * storage — the Android Keystore, the iOS keychain — never in the bundle. An
 * `EXPO_PUBLIC_` variable would have been simpler and would have put the key in
 * every copy of the APK, readable by anyone who unzipped it; the key is what
 * stands between a public URL and the WaniKani account, so it lives with the
 * device instead.
 *
 * Alongside it sits what the server last said about it, so a screen can tell
 * "offline" apart from "the server refused this phone". Both surface as failed
 * requests, and only one of them is fixed by waiting.
 */
import * as React from 'react';
import * as SecureStore from 'expo-secure-store';

const STORE_KEY = 'kanji-workshop.api-key';

/**
 * - `unknown` — nothing has been asked yet this launch.
 * - `ok` — the last request was let through (with a key, or by a local server
 *   that asks for none).
 * - `missing` — the server wants a key and this phone has none.
 * - `rejected` — the server wants a key and refused the one this phone sent.
 */
export type AuthStatus = 'unknown' | 'ok' | 'missing' | 'rejected';

// `undefined` until the store has been read once; `null` when it holds nothing.
let cached: string | null | undefined;
let status: AuthStatus = 'unknown';
const listeners = new Set<() => void>();

function setStatus(next: AuthStatus) {
  if (next === status) return;
  status = next;
  listeners.forEach((listener) => listener());
}

export async function getApiKey(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await SecureStore.getItemAsync(STORE_KEY);
  } catch {
    // Web has no secure store, and a build predating the native module has no
    // native side. Either way there is no key to send, which the server will
    // report as `missing` if it wants one.
    cached = null;
  }
  return cached;
}

export async function saveApiKey(value: string): Promise<void> {
  const key = value.trim();
  await SecureStore.setItemAsync(STORE_KEY, key);
  cached = key;
  // Whatever the server said about the previous key says nothing about this one.
  setStatus('unknown');
}

export async function clearApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
  cached = null;
  setStatus('unknown');
}

/** Called by the request layer with every response the server gave. */
export function reportAuth(httpStatus: number) {
  if (httpStatus === 401) setStatus(cached ? 'rejected' : 'missing');
  else if (httpStatus >= 200 && httpStatus < 300) setStatus('ok');
  // Anything else says nothing about the key: a 503 or a 404 is not a verdict.
}

export function useAuthStatus(): AuthStatus {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}
