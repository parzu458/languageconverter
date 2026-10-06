'use client';
import { useState, useRef } from 'react';
import { extractPdfChunks } from '@/lib/pdfExtract';
import { preloadTranslationModel, translateChunkLocally } from '@/lib/translateLocal';

function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} sec`;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      setError('');
    } else {
      setError('Per favore, carica un file PDF valido.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError('');
    }
  };

  // Suddivisione approssimativa della barra unica tra le tre fasi:
  // 0-15% download modello (solo al primo utilizzo), 15-25% estrazione
  // testo, 25-100% traduzione (la fase più lunga, quindi le è riservata
  // la maggior parte della barra).
  const MODEL_PHASE_END = 15;
  const EXTRACT_PHASE_END = 25;

  const handleTranslate = async () => {
    if (!file) return setError('Per favore, carica un file PDF.');

    setError('');
    setIsTranslating(true);
    setResult('');
    setProgress(0);

    const translateStartRef = { current: 0 };

    try {
      // 1. Modello di traduzione: al primo utilizzo va scaricato (richiede
      //    internet una sola volta, ~90MB), poi resta in cache nel browser
      //    e funziona offline.
      setStatus('Preparazione del modello di traduzione locale (~90MB al primo avvio)...');
      await preloadTranslationModel((info) => {
        if (info.status === 'progress' && info.total) {
          const pct = Math.round(((info.loaded || 0) / info.total) * 100);
          setStatus(`Download modello di traduzione (una tantum): ${pct}%`);
          setProgress((pct / 100) * MODEL_PHASE_END);
        }
      });
      setProgress(MODEL_PHASE_END);

      // 2. Estrazione testo dal PDF, interamente nel browser.
      setStatus('Estrazione del testo dal PDF...');
      const chunks = await extractPdfChunks(file, (pagesDone, total) => {
        setStatus(`Estrazione testo: ${pagesDone} di ${total} pagine lette...`);
        setProgress(MODEL_PHASE_END + (pagesDone / total) * (EXTRACT_PHASE_END - MODEL_PHASE_END));
      });

      if (!chunks || chunks.length === 0) {
        throw new Error("Nessun testo trovato nel PDF (forse è un'immagine scannerizzata?)");
      }

      // 3. Traduzione locale, chunk per chunk. Il tempo dipende molto dal
      //    dispositivo (un modello locale su CPU è più lento di un'API
      //    cloud): calcoliamo una stima grezza in base ai primi chunk
      //    tradotti e la mostriamo, aggiornandola man mano.
      setProgress(EXTRACT_PHASE_END);
      let translatedText = '';
      translateStartRef.current = Date.now();

      for (let i = 0; i < chunks.length; i++) {
        const elapsedSec = (Date.now() - translateStartRef.current) / 1000;
        const avgPerChunk = i > 0 ? elapsedSec / i : null;
        const etaText = avgPerChunk
          ? ` (circa ${formatDuration(avgPerChunk * (chunks.length - i))} rimanenti)`
          : '';
        setStatus(`Traduzione porzione ${i + 1} di ${chunks.length}...${etaText}`);

        const translatedChunk = await translateChunkLocally(chunks[i]);
        translatedText += translatedChunk + '\n\n';
        setResult(translatedText);
        setProgress(EXTRACT_PHASE_END + ((i + 1) / chunks.length) * (100 - EXTRACT_PHASE_END));
      }

      setStatus('Traduzione completata!');
      setProgress(100);
    } catch (err: any) {
      setError(err.message || 'Si è verificato un errore');
      setStatus('Traduzione fallita.');
    } finally {
      setIsTranslating(false);
    }
  };

  const downloadText = () => {
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tradotto-${file?.name || 'documento'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <main className="container">
      <div className="header">
        <h1 className="title">Limitless PDF Translator</h1>
        <p className="subtitle">
          Traduci interi libri o documenti lunghi, completamente offline: PDF ed elaborazione
          restano sul tuo dispositivo, nessun server esterno.
        </p>
      </div>

      <div className="card">
        {error && <div style={{ color: '#ef4444', marginBottom: '1rem', fontWeight: 500 }}>{error}</div>}

        <div className="form-group" style={{ marginTop: '2rem' }}>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dropzone-icon">📄</div>
            <h3>{file ? file.name : "Trascina qui il tuo file PDF"}</h3>
            <p className="subtitle">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "oppure clicca per selezionare dal tuo computer"}</p>
            <input
              type="file"
              accept=".pdf"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        <p style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '1rem' }}>
          ℹ️ Al primo avvio l&apos;app scarica un modello di traduzione locale (~90MB, una tantum);
          dalle volte successive parte subito e funziona anche offline. La traduzione gira sul tuo
          dispositivo (non su un server), quindi su documenti lunghi può richiedere qualche minuto.
        </p>

        <button
          className="button"
          onClick={handleTranslate}
          disabled={isTranslating || file === null}
        >
          {isTranslating ? (
            <>
              <div className="spinner"></div> Traduzione in corso...
            </>
          ) : 'Traduci Documento'}
        </button>

        {isTranslating && (
          <div className="progress-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span>{status}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="result-area">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ color: 'var(--primary)' }}>Risultato della Traduzione</h2>
            <button className="button" style={{ marginTop: 0, width: 'auto', padding: '0.5rem 1rem' }} onClick={downloadText}>
              Scarica (.md)
            </button>
          </div>
          <div className="markdown-body" style={{ whiteSpace: 'pre-wrap' }}>
            {result}
          </div>
        </div>
      )}
    </main>
  );
}
