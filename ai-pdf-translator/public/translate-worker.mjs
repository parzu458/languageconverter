// Worker di traduzione: il modello gira qui, in background, così la pagina
// resta fluida e il browser non interrompe lo script per "timeout".
import { pipeline, env } from '/vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = '/vendor/transformers/';
env.backends.onnx.wasm.numThreads = 1;

const cache = new Map();
function getTranslator(key, report) {
  if (!cache.has(key)) {
    const p = pipeline('translation', `Xenova/opus-mt-${key}`, { progress_callback: report });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

self.onmessage = async (e) => {
  const { id, type, key, text } = e.data;
  try {
    if (type === 'load') {
      await getTranslator(key, (info) => self.postMessage({ id, type: 'progress', info }));
      self.postMessage({ id, type: 'done' });
    } else {
      const t = await getTranslator(key);
      const out = await t(text, { max_new_tokens: 512 });
      const result = Array.isArray(out) ? out[0].translation_text : out.translation_text;
      self.postMessage({ id, type: 'done', result });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String((err && err.message) || err) });
  }
};
