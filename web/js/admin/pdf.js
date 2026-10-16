/**
 * Ticket PDFs (admin mode). The phones show a ticket as an image, and a browser can't turn a PDF into
 * one by itself, so pdf.js (Mozilla, Apache-2.0, in web/vendor/) draws each page, the white margins are
 * trimmed off, and the pages are stacked into one image. The family's phones never see the PDF.
 *
 * pdf.js is loaded only when the admin picks a PDF. It isn't in the app snapshot the phones download;
 * the offline worker keeps it after the first use (see web/sw.js).
 *
 * @import { PdfJs } from '../../../types/pdfjs'
 */

/** pdf.js, relative to the page. A new version goes into a new folder: the offline worker caches by URL. */
const PDFJS = 'vendor/pdfjs-6.3.289/';
/** Pages after these are rarely tickets (terms, adverts), and the image would get too big. */
const MAX_PAGES = 6;
/** The widest page is drawn this wide: sharp on any phone, and a QR code stays readable when zoomed. */
const WIDTH = 1240;
/** Phones refuse to draw bigger images. */
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_000;
/** Space around each page's content, in pixels of the image. */
const PAD = 24;
/** A PNG bigger than this is also tried as a JPEG, and the smaller one is kept. */
const PNG_BYTES = 1_000_000;

/** @type {Promise<PdfJs> | null} */
let library = null;

/** Load pdf.js once; a failed download (offline the first time) is tried again next time. */
function pdfjs() {
  if (!library) {
    const base = new URL(PDFJS, document.baseURI);
    library = import(new URL('pdf.min.mjs', base).href).then((/** @type {PdfJs} */ lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
      return lib;
    });
    library.catch(() => (library = null));
  }
  return library;
}

/** @param {File} file */
export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * The part of a drawn page that isn't (nearly) white, or null for an empty page.
 * @param {HTMLCanvasElement} canvas
 */
function contentBox(canvas) {
  const { width, height } = canvas;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const px = ctx.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
      if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} type
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be made'))), type, quality),
  );

/**
 * One image of a PDF's pages (the first MAX_PAGES), each trimmed to its content, one under another.
 * Throws if the PDF can't be read (damaged, or locked with a password).
 * @param {File} file
 * @returns {Promise<{ blob: Blob, kept: number, total: number }>}
 */
export async function pdfToImage(file) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
  try {
    const doc = await task.promise;
    const total = doc.numPages;
    const pages = await Promise.all(Array.from({ length: Math.min(total, MAX_PAGES) }, (_, i) => doc.getPage(i + 1)));
    const sizes = pages.map((page) => page.getViewport({ scale: 1 }));
    const widest = Math.max(...sizes.map((s) => s.width));
    const tall = sizes.reduce((sum, s) => sum + s.height, 0);
    const scale = Math.min(WIDTH / widest, Math.sqrt(MAX_PIXELS / (widest * tall)), MAX_SIDE / tall);

    // draw each page and cut out its content
    /** @type {{ canvas: HTMLCanvasElement, box: { x: number, y: number, w: number, h: number } }[]} */
    const drawn = [];
    for (const page of pages) {
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      // as printed: that's how a ticket is meant to look, and it doesn't wait for screen frames
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      page.cleanup();
      const box = contentBox(canvas);
      if (box) drawn.push({ canvas, box });
    }
    if (!drawn.length) throw new Error('The PDF has no visible content');

    // stack them, centred, with a thin line between pages
    const out = document.createElement('canvas');
    out.width = Math.max(...drawn.map((d) => d.box.w)) + 2 * PAD;
    out.height = drawn.reduce((sum, d) => sum + d.box.h + PAD, PAD);
    const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = '#bbb';
    let y = PAD;
    drawn.forEach(({ canvas, box }, i) => {
      if (i) ctx.fillRect(PAD, y - PAD / 2 - 1, out.width - 2 * PAD, 2);
      ctx.drawImage(canvas, box.x, box.y, box.w, box.h, Math.round((out.width - box.w) / 2), y, box.w, box.h);
      y += box.h + PAD;
      canvas.width = canvas.height = 0; // free the page's memory now
    });

    let blob = await toBlob(out, 'image/png');
    if (blob.size > PNG_BYTES) {
      const jpeg = await toBlob(out, 'image/jpeg', 0.9);
      if (jpeg.size < blob.size) blob = jpeg;
    }
    return { blob, kept: pages.length, total };
  } finally {
    await task.destroy();
  }
}
