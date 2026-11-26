import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestForActiveBundle, rememberDownloadedBundle } from './bundleActivation';

vi.mock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: {} }));
vi.mock('./runtime', () => ({ isNativeApp: () => false }));

const old = 'a'.repeat(64);
const next = 'b'.repeat(64);
const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
} as Storage;

describe('OTA download receipts', () => {
  beforeEach(() => memory.clear());
  it('requires a native-ready current ID, not download completion', () => {
    rememberDownloadedBundle(storage, 'bundle-new', next);
    expect(digestForActiveBundle(storage, 'bundle-old', true)).toBe('');
    expect(digestForActiveBundle(storage, 'bundle-new', false)).toBe('');
    expect(digestForActiveBundle(storage, 'bundle-new', true)).toBe(next);
  });
  it('preserves older known bundle after rollback and rejects legacy optimistic SHA', () => {
    storage.setItem('tz.mobile.local_bundle_sha256', next);
    rememberDownloadedBundle(storage, 'bundle-old', old);
    rememberDownloadedBundle(storage, 'bundle-new', next);
    expect(digestForActiveBundle(storage, 'bundle-old', true)).toBe(old);
    expect(digestForActiveBundle(storage, 'builtin', true)).toBe('');
  });
  it('rejects malformed digests and ambiguous receipts', () => {
    expect(() => rememberDownloadedBundle(storage, 'bundle-bad', 'abc')).toThrow();
    storage.setItem('tz.mobile.downloaded_bundle_v2', JSON.stringify([{id:'x',sha:old},{id:'x',sha:next}]));
    expect(digestForActiveBundle(storage, 'x', true)).toBe('');
  });
});
