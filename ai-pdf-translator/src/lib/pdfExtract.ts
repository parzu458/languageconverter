'use client';

// Estrazione testo da PDF interamente lato client (browser), usando pdf.js.
// Il worker viene servito da /public/pdf-worker (copia locale), NON da una
// CDN, così l'estrazione funziona anche offline (dopo il primo caricamento
// dell'app) sia su desktop che su mobile.

let workerConfigured = false;

async function getPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf-worker/pdf.worker.min.mjs';
    workerConfigured = true;
  }
  return pdfjsLib;
}

export function chunkText(text: string, maxLength: number = 1500): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  const paragraphs = text.split(/\n\s*\n/);

  for (const p of paragraphs) {
    if (currentChunk.length + p.length > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }

    if (p.length > maxLength) {
      const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxLength && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        currentChunk += sentence + ' ';
      }
    } else {
      currentChunk += p + '\n\n';
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Estrae il testo da un file PDF (interamente nel browser) e lo divide
 * in chunk adatti alla traduzione locale (i modelli di traduzione locali
 * hanno un limite di token molto più basso di un'API cloud, per questo
 * i chunk sono più piccoli rispetto alla versione precedente).
 *
 * Le pagine vengono lette a gruppi in parallelo (invece che una alla
 * volta in sequenza): pdf.js supporta l'accesso concorrente alle pagine,
 * e la maggior parte del tempo per pagina è I/O/parsing nel worker, non
 * CPU del thread principale, quindi il parallelismo riduce sensibilmente
 * i tempi su documenti lunghi.
 */
export async function extractPdfChunks(
  file: File,
  onProgress?: (page: number, totalPages: number) => void
): Promise<string[]> {
  const pdfjsLib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = new Array(pdf.numPages);
  let pagesDone = 0;

  const CONCURRENCY = 8; // pagine lette in parallelo per batch

  async function extractPage(pageNum: number) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    pageTexts[pageNum - 1] = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    pagesDone++;
    onProgress?.(pagesDone, pdf.numPages);
  }

  for (let start = 1; start <= pdf.numPages; start += CONCURRENCY) {
    const batch: Promise<void>[] = [];
    for (let pageNum = start; pageNum < start + CONCURRENCY && pageNum <= pdf.numPages; pageNum++) {
      batch.push(extractPage(pageNum));
    }
    await Promise.all(batch);
  }

  const fullText = pageTexts.join('\n\n');

  if (!fullText.trim()) {
    throw new Error('Nessun testo trovato nel PDF (forse è un\'immagine scannerizzata?)');
  }

  return chunkText(fullText, 1500);
}
