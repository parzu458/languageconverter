'use client';

// Traduzione interamente nel browser con Transformers.js (file statico in
// /public/vendor/transformers/, caricato senza passare dal bundler).
// Ogni coppia di lingue usa un modello OPUS-MT (~80-90MB), scaricato una
// sola volta da Hugging Face e poi tenuto in cache dal browser.

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

const VENDOR_URL = '/vendor/transformers/transformers.min.js';

type ProgressInfo = { status: string; loaded?: number; total?: number };

const translators = new Map<string, Promise<any>>();

async function getTranslator(src: LangCode, tgt: LangCode, onProgress?: (i: ProgressInfo) => void) {
  const key = `${src}-${tgt}`;
  if (!translators.has(key)) {
    const p = (async () => {
      const { pipeline, env } = await import(/* webpackIgnore: true */ VENDOR_URL);
      env.allowLocalModels = false;
      env.backends.onnx.wasm.wasmPaths = '/vendor/transformers/';
      env.backends.onnx.wasm.numThreads = 1;
      return pipeline('translation', `Xenova/opus-mt-${key}`, { progress_callback: onProgress });
    })();
    // Se il caricamento fallisce, non lasciare in cache una promise rotta.
    p.catch(() => translators.delete(key));
    translators.set(key, p);
  }
  return translators.get(key)!;
}

export async function preloadTranslationModel(
  src: LangCode,
  tgt: LangCode,
  onProgress?: (i: ProgressInfo) => void
) {
  await getTranslator(src, tgt, onProgress);
}

export async function translateChunkLocally(chunk: string, src: LangCode, tgt: LangCode): Promise<string> {
  const translator = await getTranslator(src, tgt);
  const out: any = await translator(chunk, { max_new_tokens: 512 });
  return Array.isArray(out) ? out[0].translation_text : out.translation_text;
}
