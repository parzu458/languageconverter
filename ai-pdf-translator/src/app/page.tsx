'use client';
import { useState, useRef } from 'react';
import { extractPdfChunks, chunkText } from '@/lib/pdfExtract';
import {
  preloadTranslationModel,
  translateChunkLocally,
  LANGUAGES,
  targetsFor,
  type LangCode,
} from '@/lib/translateLocal';

function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} sec`;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
}

export default function Home() {
  const [mode, setMode] = useState<'text' | 'pdf'>('text');
  const [src, setSrc] = useState<LangCode>('en');
  const [tgt, setTgt] = useState<LangCode>('it');
  const [inputText, setInputText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const changeSrc = (v: LangCode) => {
    setSrc(v);
    const options = targetsFor(v);
    if (!options.includes(tgt)) setTgt(options[0]);
  };

  // Inverti: possibile solo quando la coppia opposta esiste (es. en->it <-> it->en).
  const canSwap = targetsFor(tgt).includes(src);
  const swap = () => {
    if (!canSwap) return;
    setSrc(tgt);
    setTgt(src);
  };

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
    if (mode === 'pdf' && !file) return setError('Per favore, carica un file PDF.');
    if (mode === 'text' && !inputText.trim()) return setError('Per favore, inserisci del testo.');

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
      await preloadTranslationModel(src, tgt, (info) => {
        if (info.status === 'progress' && info.total) {
          const pct = Math.round(((info.loaded || 0) / info.total) * 100);
          setStatus(`Download modello di traduzione (una tantum): ${pct}%`);
          setProgress((pct / 100) * MODEL_PHASE_END);
        }
      });
      setProgress(MODEL_PHASE_END);

      // 2. Estrazione testo dal PDF, interamente nel browser.
      let chunks: string[];
      if (mode === 'pdf') {
        setStatus('Estrazione del testo dal PDF...');
        chunks = await extractPdfChunks(file!, (pagesDone, total) => {
          setStatus(`Estrazione testo: ${pagesDone} di ${total} pagine lette...`);
          setProgress(MODEL_PHASE_END + (pagesDone / total) * (EXTRACT_PHASE_END - MODEL_PHASE_END));
        });
      } else {
        chunks = chunkText(inputText, 1500);
      }

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

        const translatedChunk = await translateChunkLocally(chunks[i], src, tgt);
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
    a.download = `tradotto-${(mode === 'pdf' && file?.name) || 'testo'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <main className="container">
      <div className="header">
        <h1 className="title">Limitless PDF Translator</h1>
        <p className="subtitle">
          Traduci testi e interi documenti PDF tra inglese, italiano, francese, tedesco e spagnolo,
          completamente offline: tutto resta sul tuo dispositivo, nessun server esterno.
        </p>
      </div>

      <div className="card">
        {error && <div style={{ color: '#ef4444', marginBottom: '1rem', fontWeight: 500 }}>{error}</div>}

        <div className="tabs">
          <button className={`tab ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')} disabled={isTranslating}>✍️ Testo</button>
          <button className={`tab ${mode === 'pdf' ? 'active' : ''}`} onClick={() => setMode('pdf')} disabled={isTranslating}>📄 PDF</button>
        </div>

        <div className="lang-row">
          <div className="form-group">
            <label className="label">Da</label>
            <select className="select" value={src} disabled={isTranslating} onChange={(e) => changeSrc(e.target.value as LangCode)}>
              {(Object.keys(LANGUAGES) as LangCode[]).map((c) => <option key={c} value={c}>{LANGUAGES[c]}</option>)}
            </select>
          </div>
          <button className="swap-btn" onClick={swap} disabled={!canSwap || isTranslating} title="Inverti lingue">⇄</button>
          <div className="form-group">
            <label className="label">A</label>
            <select className="select" value={tgt} disabled={isTranslating} onChange={(e) => setTgt(e.target.value as LangCode)}>
              {targetsFor(src).map((c) => <option key={c} value={c}>{LANGUAGES[c]}</option>)}
            </select>
          </div>
        </div>

        {mode === 'text' && (
          <div className="form-group">
            <textarea className="textarea" placeholder="Incolla o scrivi qui il testo da tradurre..." value={inputText} disabled={isTranslating} onChange={(e) => setInputText(e.target.value)} />
          </div>
        )}

        {mode === 'pdf' && <div className="form-group">
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
        </div>}

        <p style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '1rem' }}>
          ℹ️ Al primo avvio l&apos;app scarica un modello di traduzione locale per ogni coppia di lingue (~90MB, una tantum);
          dalle volte successive parte subito e funziona anche offline. La traduzione gira sul tuo
          dispositivo (non su un server), quindi su documenti lunghi può richiedere qualche minuto.
        </p>

        <button
          className="button"
          onClick={handleTranslate}
          disabled={isTranslating || (mode === 'pdf' ? file === null : !inputText.trim())}
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
            <button className="button" style={{ marginTop: 0, width: 'auto', padding: '0.5rem 1rem', marginLeft: '0.5rem' }} onClick={() => navigator.clipboard.writeText(result)}>
              Copia
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
