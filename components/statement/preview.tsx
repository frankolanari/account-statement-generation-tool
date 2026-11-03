'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Shows the generated PDF itself, so the preview is exactly what downloads.
// pdf.js draws each page onto a canvas: the same in every browser, unlike built-in PDF viewers.
export function PdfPreview({ pdf }: { pdf: Blob }) {
  const box = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false, task: { destroy(): Promise<void> } | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const loading = pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) });
      task = loading;
      const loaded = await loading.promise;
      if (!cancelled) setDoc(loaded);
    })().catch(() => { if (!cancelled) setFailed(true); });
    // pdf.js 6: cleanup lives on the loading task.
    return () => { cancelled = true; void task?.destroy(); };
  }, [pdf]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = pages.current;
    if (!doc || !host || width < 50) return;
    let cancelled = false;
    (async () => {
      const sheets: HTMLCanvasElement[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const cssWidth = Math.min(width - 32, 820);
        const viewport = page.getViewport({ scale: (cssWidth / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.className = 'mx-auto block bg-white shadow-[0_1px_3px_rgb(0_0_0/.12),0_8px_24px_-8px_rgb(0_0_0/.18)]';
        canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
        await page.render({ canvas, viewport }).promise;
        if (cancelled) return;
        sheets.push(canvas);
      }
      host.replaceChildren(...sheets);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [doc, width]);

  return (
    <div ref={box} className="h-[75vh] overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-300">
      {failed
        ? <p className="p-6 text-center text-sm text-zinc-600">The preview couldn’t be shown here, but the PDF is ready to download.</p>
        : <div ref={pages} className="grid gap-4 p-4" aria-label="Statement preview" />}
    </div>
  );
}
