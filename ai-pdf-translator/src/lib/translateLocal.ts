'use client';

// Traduzione eseguita interamente nel browser tramite Transformers.js
// (ONNX Runtime Web), caricata come FILE STATICO da /public/vendor/transformers/
// invece che come pacchetto npm importato dal bundler di Next.js.
//
// Perché: onnxruntime-web/transformers.js istanzia internamente dei Web
// Worker e si aspetta di trovare i propri file .wasm accanto al proprio
// file .js. Quando Next.js/Turbopack "impacchetta" la libreria insieme al
// resto del codice, questi meccanismi interni vengono riscritti/spostati
// e si rompono in modo silenzioso (errori generici come
// "can't convert undefined to object"). Caricando il file esattamente
// come farebbe una pagina HTML statica (fetch diretto del file, nessuna
// trasformazione), la libreria si comporta esattamente come testata dai
// suoi autori.
//
// La prima volta che l'app viene usata, il modello (~80MB, coppia
// inglese -> italiano, Helsinki-NLP/OPUS-MT) viene scaricato da Hugging
// Face e messo in cache dal browser (Cache Storage). Da quel momento in
// poi la traduzione funziona anche a telefono/PC senza connessione a
// internet.
//
// Per tradurre verso un'altra lingua, cambia MODEL_ID con la coppia
// corrispondente, es. 'Xenova/opus-mt-en-fr' per il francese,
// 'Xenova/opus-mt-en-de' per il tedesco, ecc.
// (elenco modelli disponibili: https://huggingface.co/Helsinki-NLP)

const MODEL_ID = 'Xenova/opus-mt-en-it';
const VENDOR_URL = '/vendor/transformers/transformers.min.js';

type ProgressInfo = {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

let translatorPromise: Promise<any> | null = null;

async function loadTransformersModule() {
  // Import di un URL letterale (non un bare specifier di pacchetto):
  // Next.js/Turbopack non può "vederlo" a build-time e lo lascia come
  // import dinamico nativo, risolto dal browser a runtime, esattamente
  // come un <script type="module" src="..."> in una pagina HTML pura.
  return import(/* webpackIgnore: true */ VENDOR_URL);
}

async function getTranslator(onModelProgress?: (info: ProgressInfo) => void) {
  if (!translatorPromise) {
    translatorPromise = (async () => {
      const { pipeline, env } = await loadTransformersModule();

      env.allowLocalModels = false;

      // I file .wasm di ONNX Runtime si trovano nella stessa cartella del
      // file .js vendorizzato.
      env.backends.onnx.wasm.wasmPaths = '/vendor/transformers/';

      // Forza il backend WASM a singolo thread: la variante "threaded"
      // richiederebbe worker aggiuntivi e header speciali (COOP/COEP) lato
      // server, non disponibili in un semplice hosting statico offline.
      env.backends.onnx.wasm.numThreads = 1;

      return pipeline('translation', MODEL_ID, {
        progress_callback: onModelProgress,
      });
    })();
  }
  return translatorPromise;
}

/**
 * Pre-carica il modello di traduzione (utile per mostrare una barra di
 * download separata dalla traduzione vera e propria al primo avvio).
 */
export async function preloadTranslationModel(onModelProgress?: (info: ProgressInfo) => void) {
  await getTranslator(onModelProgress);
}

/**
 * Traduce un singolo chunk di testo interamente in locale.
 */
export async function translateChunkLocally(chunk: string): Promise<string> {
  const translator = await getTranslator();
  const output: any = await translator(chunk, { max_new_tokens: 512 });
  return Array.isArray(output) ? output[0].translation_text : output.translation_text;
}
