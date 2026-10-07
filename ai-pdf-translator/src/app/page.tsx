'use client';

import { useEffect, useRef, useState } from 'react';
import { extractPdfChunks } from '@/lib/pdfExtract';
import {
  preloadTranslationModel,
  translateChunkLocally,
  LANGUAGES,
  targetsFor,
  type LangCode,
} from '@/lib/translateLocal';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<LangCode>('en');
  const [tgt, setTgt] = useState<LangCode>('it');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [result, setResult] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const srcBox = useRef<HTMLPreElement>(null);
  const outBox = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!busy) return;
    const o = outBox.current;
    if (o) o.scrollTop = o.scrollHeight;
    const s = srcBox.current;
    if (s && o) s.scrollTop = (o.scrollTop / Math.max(1, o.scrollHeight)) * s.scrollHeight;
  }, [result, busy]);

  const baseName = (f: File | null) => (f ? f.name.replace(/\.pdf$/i, '') : 'traduzione') + `-${tgt}`;

  const downloadTxt = (text = result, f = file) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = baseName(f) + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async (text = result, f = file) => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 56;
      const width = doc.internal.pageSize.getWidth() - margin * 2;
      const height = doc.internal.pageSize.getHeight() - margin;
      doc.setFont('times', 'normal');
      doc.setFontSize(12);
      // I font standard di jsPDF coprono solo Latin-1 (vanno bene le lettere accentate).
      const safe = text
        .normalize('NFC')
        .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...')
        .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
      let y = margin;
      for (const par of safe.split(/\n/)) {
        for (const line of doc.splitTextToSize(par || ' ', width) as string[]) {
          if (y > height) { doc.addPage(); y = margin; }
          doc.text(line, margin, y);
          y += 17;
        }
        y += 5;
      }
      doc.save(baseName(f) + '.pdf');
    } catch {
      downloadTxt(text, f); // se il PDF fallisce, scarica comunque il testo
    }
  };

  const reset = () => {
    setFile(null); setSource(''); setResult(''); setProgress(0); setStatus(''); setError('');
  };

  const changeSrc = (v: LangCode) => {
    setSrc(v);
    if (!targetsFor(v).includes(tgt)) setTgt(targetsFor(v)[0]);
  };

  const run = async (f: File) => {
    setFile(f);
    setBusy(true);
    setError('');
    setProgress(0);
    setSource('');
    setResult('');
    try {
      setStatus('Preparo il traduttore (la prima volta scarica ~90 MB)');
      await preloadTranslationModel(src, tgt, (i) => {
        if (i.total && i.loaded) setProgress((i.loaded / i.total) * 0.3);
      });

      setStatus('Leggo il PDF');
      const chunks = await extractPdfChunks(f, (done, total) =>
        setProgress(0.3 + (done / total) * 0.1)
      );
      if (!chunks.length) throw new Error('Nessun testo trovato: il PDF potrebbe essere una scansione.');

      setSource(chunks.join('\n\n'));
      const out: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        setStatus(`Traduzione in corso (${i + 1} di ${chunks.length})`);
        out.push(await translateChunkLocally(chunks[i], src, tgt));
        setResult(out.join('\n\n'));
        setProgress(0.4 + ((i + 1) / chunks.length) * 0.6);
      }

      setProgress(1);
      setStatus('Traduzione completata');
    } catch (e: any) {
      setError(e?.message || 'Qualcosa è andato storto.');
      setStatus('Traduzione interrotta');
    } finally {
      setBusy(false);
    }
  };

  const pick = (f?: File | null) => {
    if (!f || busy) return;
    if (!f.name.toLowerCase().endsWith('.pdf')) return setError('Serve un file PDF.');
    run(f);
  };

  return (
    <main>
      <div className="pill">
        <select value={src} disabled={busy} onChange={(e) => changeSrc(e.target.value as LangCode)}>
          {(Object.keys(LANGUAGES) as LangCode[]).map((c) => (
            <option key={c} value={c}>{LANGUAGES[c]}</option>
          ))}
        </select>
        <span>→</span>
        <select value={tgt} disabled={busy} onChange={(e) => setTgt(e.target.value as LangCode)}>
          {targetsFor(src).map((c) => (
            <option key={c} value={c}>{LANGUAGES[c]}</option>
          ))}
        </select>
      </div>

      <h1>Traduci PDF senza limiti</h1>
      <p className="sub">
        Carica un documento e ricevi l&apos;intera traduzione.<br />
        Nessun limite di pagine, nessuna registrazione: tutto resta sul tuo dispositivo.
      </p>

      <div
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M12 17v-6m-3 3 3-3 3 3" />
        </svg>
        <h2>Trascina qui il tuo PDF oppure scegli un file</h2>
        {file && <p className="fname">{file.name}</p>}
        <button onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Traduzione in corso…' : error || file ? 'Scegli un altro PDF' : 'Seleziona PDF'}
        </button>
        <input ref={input} type="file" accept="application/pdf" hidden
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {status && (
        <div className="prog">
          <span>{status}</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
      )}
      {status && <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>}

      {error && (
        <div className="err">
          <b>Impossibile completare la traduzione</b>
          <span>{error}</span>
          {file && !busy && <u onClick={() => run(file)}>Riprova</u>}
        </div>
      )}

      {(source || result) && (
        <section className="res">
          <div className="res-head">
            <h2>{busy ? 'Traduzione in corso…' : 'Traduzione completata'}</h2>
            <div className="acts">
              <button className="ghost" onClick={() => navigator.clipboard.writeText(result)} disabled={!result}>Copia</button>
              <button onClick={() => downloadPdf()} disabled={!result}>⬇ Scarica PDF</button>
              <button className="ghost" onClick={() => downloadTxt()} disabled={!result}>⬇ .txt</button>
              <button className="ghost" onClick={reset} disabled={busy}>↺</button>
            </div>
          </div>
          <div className="panels">
            <div className="panel">
              <h3>Originale</h3>
              <pre ref={srcBox} className="mute">{source}</pre>
            </div>
            <div className="panel hl">
              <h3>{LANGUAGES[tgt]}</h3>
              <pre ref={outBox} className="serif">{result}{busy && <span className="caret" />}</pre>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
