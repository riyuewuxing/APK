/** Strict, bounded SSE reader. A successful terminal frame is provisional until EOF. */
export async function readResearchStream<T extends { type: string }>(
  response: Response, onEvent: (event: T) => void,
  options: { assertCurrent: () => void; signal?: AbortSignal; allowedTypes: readonly string[];
    idleMs?: number; maxBytes?: number; maxFrameChars?: number },
): Promise<void> {
  if (!response.ok || !response.body || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Invalid research stream response');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const idleMs = options.idleMs ?? 120_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const maxFrameChars = options.maxFrameChars ?? 512 * 1024;
  let buffer = '', bytes = 0, terminal = false, meta = false, failed = false;
  const check = () => {
    options.assertCurrent();
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const frame = (raw: string) => {
    if (raw.length > maxFrameChars) throw new Error('Research frame too large');
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) return;
    if (terminal) throw new Error('Research data after terminal event');
    const event: unknown = JSON.parse(data);
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid research event');
    const e = event as Record<string, unknown>;
    if (typeof e.type !== 'string' || !options.allowedTypes.includes(e.type)) throw new Error('Unknown research event');
    if (e.type === 'meta') {
      if (meta || failed || e.research_only !== true || e.execution_allowed !== false) throw new Error('Invalid research metadata');
      meta = true;
    } else if (e.type === 'error') {
      failed = true;
    } else if (e.type === 'done') {
      if (typeof e.ok !== 'boolean' || (e.ok && (!meta || failed))) throw new Error('Invalid research terminal event');
      terminal = true;
    } else if (!meta || failed) {
      throw new Error('Research event outside valid metadata state');
    }
    check();
    onEvent(event as T);
  };
  try {
    while (true) {
      check();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      try {
        const limit = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Research stream idle timeout')), idleMs);
          abort = () => reject(new DOMException('Aborted', 'AbortError'));
          options.signal?.addEventListener('abort', abort, { once: true });
        });
        const { value, done } = await Promise.race([reader.read(), limit]);
        check();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error('Research stream too large');
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const part of parts) frame(part);
        if (buffer.length > maxFrameChars) throw new Error('Research frame too large');
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (abort) options.signal?.removeEventListener('abort', abort);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() || !terminal) throw new Error('Incomplete research stream; output is a draft');
    check();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
