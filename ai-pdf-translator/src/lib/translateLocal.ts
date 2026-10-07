'use client';


export const LANGUAGES = {
  en: 'Inglese',
  it: 'Italiano',
  fr: 'Francese',
  de: 'Tedesco',
  es: 'Spagnolo',
} as const;
export type LangCode = keyof typeof LANGUAGES;

/** Lingue di arrivo disponibili per una data lingua di partenza. */
export function targetsFor(src: LangCode): LangCode[] {
  return src === 'en' ? ['it', 'fr', 'de', 'es'] : ['en'];
}

type ProgressInfo = { status: string; loaded?: number; total?: number };
type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onProgress?: (i: ProgressInfo) => void;
};

// Il modello gira in un Web Worker (public/translate-worker.mjs), non sul
// thread principale: così la pagina non si blocca durante la traduzione.
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    const w = new Worker('/translate-worker.mjs', { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') return p.onProgress?.(m.info);
      pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.error));
      else p.resolve(m.result);
    };
    w.onerror = (e: ErrorEvent) => {
      const err = new Error('Errore nel traduttore: ' + (e.message || 'impossibile avviare il worker'));
      pending.forEach((p) => p.reject(err));
      pending.clear();
      w.terminate();
      worker = null;
    };
    worker = w;
  }
  return worker;
}

function call(msg: Record<string, unknown>, onProgress?: (i: ProgressInfo) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, ...msg });
  });
}

export async function preloadTranslationModel(
  src: LangCode,
  tgt: LangCode,
  onProgress?: (i: ProgressInfo) => void
) {
  await call({ type: 'load', key: `${src}-${tgt}` }, onProgress);
}

export async function translateChunkLocally(chunk: string, src: LangCode, tgt: LangCode): Promise<string> {
  return call({ type: 'translate', key: `${src}-${tgt}`, text: chunk });
}
