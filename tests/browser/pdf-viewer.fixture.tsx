import React from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfViewerDriver } from '@/components/projects/v2/preview/drivers/PdfViewerDriver';

// The real PDF preview driver with pdf.js 6: the worker is served beside the page, the document from /sample.pdf.
GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
const node = { id: 'n1', projectId: 'p1', name: 'sample.pdf', currentVersion: 1 } as never;

createRoot(document.getElementById('root')!).render(
    <div style={{ height: 800 }}><PdfViewerDriver node={node} signedUrl="/sample.pdf" projectId="p1" /></div>,
);
