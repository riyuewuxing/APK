import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNativeApp } from './runtime';

const KEY = 'tz.mobile.downloaded_bundle_v2';
const SHA256 = /^[0-9a-f]{64}$/;

type BundleReceipt = { id: string; sha: string };

/** Download receipt only. It is not proof that the native layer activated the bundle. */
export function rememberDownloadedBundle(storage: Storage, id: string, sha: string): void {
  if (!id || id === 'builtin' || !SHA256.test(sha)) throw new Error('无效的前端资源包身份');
  let prior: BundleReceipt[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      prior = parsed.filter((entry): entry is BundleReceipt =>
        entry && typeof entry.id === 'string' && typeof entry.sha === 'string' && SHA256.test(entry.sha));
    }
  } catch { /* Invalid old receipt is not an installed version. */ }
  storage.setItem(KEY, JSON.stringify([{ id, sha }, ...prior.filter(x => x.id !== id)].slice(0, 4)));
}

/** Never trust the legacy optimistic SHA or a receipt for a different active ID. */
export function digestForActiveBundle(storage: Storage, id: string, ready: boolean): string {
  if (!ready || !id || id === 'builtin') return '';
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return '';
    const matching = parsed.filter(entry => entry?.id === id);
    return matching.length === 1 && typeof matching[0].sha === 'string' && SHA256.test(matching[0].sha)
      ? matching[0].sha : '';
  } catch { return ''; }
}

let readyPromise: Promise<boolean> | undefined;

/** Called at every native JS launch, before network requests; keep rollback enabled. */
export function confirmNativeBundleReady(): Promise<boolean> {
  if (!isNativeApp()) return Promise.resolve(false);
  readyPromise ??= CapacitorUpdater.notifyAppReady().then(() => true, () => false);
  return readyPromise;
}

export async function readActiveBundle(): Promise<{ version: string; sha: string }> {
  if (!isNativeApp()) return { version: 'builtin', sha: '' };
  try {
    const ready = await confirmNativeBundleReady();
    const current = await CapacitorUpdater.current();
    const id = current.bundle?.id ?? '';
    const version = current.bundle?.version || current.native || 'builtin';
    return { version, sha: digestForActiveBundle(localStorage, id, ready) };
  } catch { return { version: 'unknown', sha: '' }; }
}
