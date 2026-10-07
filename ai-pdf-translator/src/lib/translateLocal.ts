'use client';



export const LANGUAGES = {
  en: 'Inglese',
  it: 'Italiano',
  fr: 'Francese',
  de: 'Tedesco',
  es: 'Spagnolo',
} as const;
export type LangCode = keyof typeof LANGUAGES;

export function targetsFor(src: LangCode): LangCode[] {
  return src === 'en' ? ['it', 'fr', 'de', 'es'] : ['en'];
}

type ProgressInfo = { status: string; loaded?: number; total?: number };
type Slot = { w: Worker; busy: number; dead: boolean };
type Pending = {
  slot: Slot;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onProgress?: (i: ProgressInfo) => void;
};

let pool: Slot[] = [];
let nextId = 1;
const pending = new Map<number, Pending>();

export function recommendedWorkers(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const mem = (navigator as any).deviceMemory as number | undefined; 
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  let n = Math.min(4, Math.max(1, Math.floor(cores / 2)));
  if (mobile) n = Math.min(n, 2);
  if (mem !== undefined && mem <= 4) n = Math.min(n, 2);
  if (mem !== undefined && mem <= 2) n = 1;
  return n;
}

function spawn(): Slot {
  const w = new Worker('/translate-worker.mjs', { type: 'module' });
  const slot: Slot = { w, busy: 0, dead: false };
  w.onmessage = (e: MessageEvent) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') return p.onProgress?.(m.info);
    pending.delete(m.id);
    slot.busy--;
    if (m.type === 'error') p.reject(new Error(m.error));
    else p.resolve(m.result);
  };
  w.onerror = (e: ErrorEvent) => {
    slot.dead = true;
    const err = new Error('Errore nel traduttore: ' + (e.message || 'impossibile avviare il worker'));
    pending.forEach((p, id) => {
      if (p.slot === slot) { p.reject(err); pending.delete(id); }
    });
    slot.busy = 0;
    w.terminate();
  };
  return slot;
}

function call(slot: Slot, msg: Record<string, unknown>, onProgress?: (i: ProgressInfo) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    slot.busy++;
    pending.set(id, { slot, resolve, reject, onProgress });
    slot.w.postMessage({ id, ...msg });
  });
}

export async function preloadTranslationModel(
  src: LangCode,
  tgt: LangCode,
  onProgress?: (i: ProgressInfo) => void
): Promise<number> {
  const key = `${src}-${tgt}`;
  pool = pool.filter((s) => !s.dead);
  if (!pool.length) pool = [spawn()];

  await call(pool[0], { type: 'load', key }, onProgress);

  const want = recommendedWorkers();
  while (pool.length < want) pool.push(spawn());
  await Promise.all(
    pool.slice(1).map((s) =>
      call(s, { type: 'load', key }).catch(() => { s.dead = true; s.w.terminate(); })
    )
  );
  pool = pool.filter((s) => !s.dead);
  return pool.length;
}

export async function translateChunkLocally(chunk: string, src: LangCode, tgt: LangCode): Promise<string> {
  const slot = pool.filter((s) => !s.dead).sort((a, b) => a.busy - b.busy)[0];
  if (!slot) throw new Error('Il traduttore non è pronto.');
  return call(slot, { type: 'translate', key: `${src}-${tgt}`, text: chunk });
}
