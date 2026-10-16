/* The few parts of pdf.js (web/vendor/pdfjs-*) that web/js/admin/pdf.js uses. The full types are in the
   pdfjs-dist npm package; the app loads the library by URL, so the type checker never sees it. */

export interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: { data: Uint8Array; useSystemFonts?: boolean }): PdfLoadingTask;
}

export interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  /** Stops loading, or frees the document and its worker once loaded. */
  destroy(): Promise<void>;
}

export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

export interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvas: HTMLCanvasElement; viewport: PdfViewport; intent?: 'display' | 'print' }): {
    promise: Promise<void>;
  };
  cleanup(): boolean;
}

export interface PdfViewport {
  width: number;
  height: number;
}
