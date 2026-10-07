'use client';

import { useRef, useState } from 'react';
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
  const input = useRef<HTMLInputElement>(null);

  const pick = (f?: File) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.pdf')) return setError('Serve un file PDF.');
    setError('');
    setFile(f);
  };

  const changeSrc = (v: LangCode) => {
    setSrc(v);
    if (!targetsFor(v).includes(tgt)) setTgt(targetsFor(v)[0]);
  };

  const run = async () => {
    if (!file) return input.current?.click();
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      setStatus('Preparo il traduttore (la prima volta scarica ~90 MB)…');
      await preloadTranslationModel(src, tgt, (i) => {
        if (i.total && i.loaded) setProgress((i.loaded / i.total) * 0.3);
      });

      setStatus('Leggo il PDF…');
      const chunks = await extractPdfChunks(file, (done, total) =>
        setProgress(0.3 + (done / total) * 0.1)
      );
      if (!chunks.length) throw new Error('Nessun testo trovato: il PDF potrebbe essere una scansione.');

      const out: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        setStatus(`Traduco… ${i + 1} / ${chunks.length}`);
        out.push(await translateChunkLocally(chunks[i], src, tgt));
        setProgress(0.4 + ((i + 1) / chunks.length) * 0.6);
      }

      const url = URL.createObjectURL(new Blob([out.join('\n\n')], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.name.replace(/\.pdf$/i, '')}-${tgt}.md`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Fatto, il file è stato scaricato.');
    } catch (e: any) {
      setError(e?.message || 'Qualcosa è andato storto.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Traduttore PDF</h1>

      <div className="langs">
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

      <div
        className="drop"
        onClick={() => !busy && input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!busy) pick(e.dataTransfer.files[0]); }}
      >
        {file ? file.name : 'Trascina qui un PDF o clicca per sceglierlo'}
        <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      <button onClick={run} disabled={busy}>
        {busy ? 'Un attimo…' : file ? 'Traduci e scarica' : 'Scegli un PDF'}
      </button>

      {busy && <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>}
      {status && <p className="note">{status}</p>}
      {error && <p className="note err">{error}</p>}
    </main>
  );
}
