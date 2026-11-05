/* Local purchase-document reading. Files stay in this browser for extraction.
 * Usage: DocumentReader29.extract(file, progress => {}, {forceOCR:false})
 * Progress: {stage,progress,message,page?,pages?}; progress is between 0 and 1.
 * Result: {text,extraction:'pdf-text'|'ocr',pages,confidence?,warnings:[]}.
 * Recognition produces a review draft, never a payment or stock movement.
 */
(function (global) {
  'use strict';

  const MAX_BYTES = 15 * 1024 * 1024;
  const MAX_PAGES = 15;
  const MAX_CANVAS_PIXELS = 4_000_000;
  const MAX_CANVAS_SIDE = 4096;
  const PDF_PATH = '/erp/vendor/pdfjs/';
  const OCR_PATH = '/erp/vendor/tesseract/';
  let pdfModulePromise = null;
  let ocrScriptPromise = null;

  function readerError(message, code, cause) {
    const error = new Error(message);
    error.name = 'DocumentReaderError';
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function friendlyError(error) {
    if (error?.name === 'DocumentReaderError') return error;
    const name = String(error?.name || '');
    const detail = String(error?.message || error || '');
    if (name === 'PasswordException' || /password|encrypted/i.test(detail)) {
      return readerError('El PDF tiene contraseña. Guarda una copia sin contraseña y vuelve a cargarla.', 'PDF_PASSWORD', error);
    }
    if (/InvalidPDF|FormatError|MissingPDF|UnexpectedResponse/.test(name) || /invalid pdf|invalid xref|pdf structure/i.test(detail)) {
      return readerError('No se pudo abrir este PDF. Comprueba que el archivo esté completo y vuelve a exportarlo desde el proveedor.', 'PDF_INVALID', error);
    }
    if (/memory|allocation|canvas.*(?:area|size)|out of bounds/i.test(detail)) {
      return readerError('El navegador no tiene suficiente memoria para esta imagen. Divide el documento o guarda una copia con menor resolución.', 'DOCUMENT_MEMORY', error);
    }
    return readerError('No se pudo leer el documento. Intenta exportarlo de nuevo como PDF, PNG o JPG y revisa que el lector termine de cargar.', 'DOCUMENT_READ', error);
  }

  function timed(promise, milliseconds, message, code) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(readerError(message, code)), milliseconds); })
    ]).finally(() => clearTimeout(timer));
  }

  function progressReporter(callback) {
    let last = 0;
    return (stage, progress, message, extra = {}) => {
      last = Math.max(last, Math.min(1, Number(progress) || 0));
      if (typeof callback === 'function') {
        // An unmounted UI must not interrupt resource cleanup or recognition.
        try { callback({stage, progress:last, message, ...extra}); } catch (_) { /* UI callback only. */ }
      }
    };
  }

  async function loadPDF() {
    if (!pdfModulePromise) {
      pdfModulePromise = import('/erp/vendor/pdfjs/pdf.min.mjs').then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_PATH + 'pdf.worker.min.mjs';
        return pdfjs;
      }).catch(error => { pdfModulePromise = null; throw error; });
    }
    try {
      return await timed(pdfModulePromise, 45000, 'No terminó de cargar el lector PDF. Recarga la página y vuelve a intentarlo.', 'PDF_ENGINE_TIMEOUT');
    } catch (error) {
      throw error?.name === 'DocumentReaderError' ? error : readerError('No se pudo cargar el lector PDF local. Recarga la página e inténtalo de nuevo.', 'PDF_ENGINE_LOAD', error);
    }
  }

  async function loadOCR() {
    if (global.Tesseract?.createWorker) return global.Tesseract;
    if (!ocrScriptPromise) {
      ocrScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = OCR_PATH + 'tesseract.min.js';
        script.async = true;
        let timer;
        const finish = error => {
          clearTimeout(timer);
          script.onload = null;
          script.onerror = null;
          if (error) { script.remove(); reject(error); }
          else resolve(global.Tesseract);
        };
        script.onload = () => finish(global.Tesseract?.createWorker ? null : readerError('El motor OCR no se pudo inicializar. Recarga la página.', 'OCR_ENGINE_LOAD'));
        script.onerror = () => finish(readerError('No se pudo cargar el motor OCR local. Recarga la página e inténtalo de nuevo.', 'OCR_ENGINE_LOAD'));
        timer = setTimeout(() => finish(readerError('No terminó de cargar el motor OCR. Recarga la página e inténtalo de nuevo.', 'OCR_ENGINE_TIMEOUT')), 45000);
        document.head.appendChild(script);
      }).catch(error => { ocrScriptPromise = null; throw error; });
    }
    return ocrScriptPromise;
  }

  /** Preserve the row boundaries supplied by PDF.js instead of flattening them. */
  function extractPDFText(content, layout = false) {
    const items = Array.isArray(content) ? content : content?.items || [];
    if(layout && items.some(item=>item.transform)){
      const rows=[];
      for(const item of items.filter(item=>typeof item?.str==='string'&&item.transform).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])){
        let row=rows.find(row=>Math.abs(row.y-item.transform[5])<2.3);
        if(!row){row={y:item.transform[5],items:[]};rows.push(row);}row.items.push(item);
      }
      return rows.map(row=>{let line='';for(const item of row.items.sort((a,b)=>a.transform[4]-b.transform[4])){const start=Math.round(item.transform[4]/3);line+=' '.repeat(Math.max(line.length?1:0,start-line.length))+item.str;}return line;}).join('\n');
    }
    return items.filter(item => typeof item?.str === 'string')
      .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('')
      .replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  }

  async function readPDFText(page, layout = false) {
    if (typeof page.streamTextContent !== 'function') return extractPDFText(await page.getTextContent(),layout);
    const reader = page.streamTextContent().getReader();
    const items = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (Array.isArray(chunk.value?.items)) items.push(...chunk.value.items);
      }
      return extractPDFText(items,layout);
    } catch (error) {
      try { Promise.resolve(reader.cancel(error)).catch(() => {}); } catch (_) {}
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  function usableText(text) {
    const compact = text.replace(/\s/g, '');
    if (compact.length < 40) return false;
    const letters = (compact.match(/[\p{L}\p{N}]/gu) || []).length;
    const broken = (compact.match(/[\u0000\ufffd]/g) || []).length;
    return letters / compact.length >= 0.35 && broken / compact.length < 0.08;
  }

  function fittedSize(width, height, requestedScale = 1) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw readerError('La página o imagen no tiene dimensiones válidas.', 'IMAGE_DIMENSIONS');
    }
    const scale = Math.min(requestedScale, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)), MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
    return {width:Math.max(1, Math.floor(width * scale)), height:Math.max(1, Math.floor(height * scale)), scale};
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {alpha:false, willReadFrequently:true});
    if (!context) {
      canvas.width = canvas.height = 1;
      throw readerError('Este navegador no pudo preparar la imagen para OCR. Cierra otras pestañas y vuelve a intentarlo.', 'CANVAS_UNAVAILABLE');
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    return {canvas, context};
  }

  async function decodeImage(file) {
    if (typeof global.createImageBitmap === 'function') {
      try {
        const bitmap = await global.createImageBitmap(file);
        return {image:bitmap, width:bitmap.width, height:bitmap.height, close:() => bitmap.close()};
      } catch (_) { /* Safari may need the HTMLImageElement path. */ }
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      await timed(new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(readerError('La imagen no se pudo abrir. Guarda otra copia como PNG o JPG.', 'IMAGE_INVALID'));
        image.src = url;
      }), 30000, 'La imagen tardó demasiado en abrirse. Prueba una copia con menor resolución.', 'IMAGE_TIMEOUT');
      return {image, width:image.naturalWidth, height:image.naturalHeight, close:() => { image.src = ''; URL.revokeObjectURL(url); }};
    } catch (error) {
      image.src = '';
      URL.revokeObjectURL(url);
      throw error;
    } finally {
      image.onload = null;
      image.onerror = null;
    }
  }

  async function fileKind(file) {
    if (!file || typeof file.arrayBuffer !== 'function' || typeof file.slice !== 'function' || !Number.isFinite(file.size)) {
      throw readerError('Selecciona un archivo PDF, PNG o JPG de tu equipo.', 'FILE_REQUIRED');
    }
    if (file.size < 1) throw readerError('El archivo está vacío. Selecciona una copia completa.', 'FILE_EMPTY');
    if (file.size > MAX_BYTES) throw readerError('El archivo supera 15 MB. Divídelo o guarda una copia más ligera.', 'FILE_TOO_LARGE');
    const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const header = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    if (header.includes('%PDF-')) return 'pdf';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
    if (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf') throw readerError('El archivo no contiene un PDF válido. Vuelve a descargarlo o exportarlo desde el proveedor.', 'PDF_INVALID');
    throw readerError('Formato no compatible. Carga un PDF, PNG o JPG; convierte las fotos HEIC antes de importarlas.', 'FILE_TYPE');
  }

  async function extract(file, onProgress, options = {}) {
    const report = progressReporter(onProgress);
    const warnings = [], texts = [], confidences = [];
    let loadingTask = null, worker = null, pendingWorker = null;
    let abandonedWorker = false, initializingOCR = false;
    let pages = 1, ocrPages = 0, textPages = 0, currentPage = 1;
    const pageProgress = fraction => 0.1 + 0.86 * ((currentPage - 1 + fraction) / pages);
    const extra = () => ({page:currentPage, pages});

    async function ensureWorker() {
      if (worker) return worker;
      report('ocr-loading', pageProgress(0.05), 'Preparando reconocimiento local en español e inglés…', extra());
      const engine = await loadOCR();
      let initializationError;
      const failed = new Promise((_, reject) => { initializationError = reject; });
      initializingOCR = true;
      pendingWorker = engine.createWorker('spa+eng', 1, {
        workerPath:OCR_PATH + 'worker.min.js',
        corePath:OCR_PATH + 'core',
        langPath:OCR_PATH + 'lang',
        workerBlobURL:false,
        gzip:true,
        cacheMethod:'write',
        logger:message => {
          const value = Math.min(1, Math.max(0, Number(message?.progress) || 0));
          const recognizing = message?.status === 'recognizing text';
          report(recognizing ? 'ocr' : 'ocr-loading', pageProgress(recognizing ? 0.25 + 0.72 * value : 0.08),
            recognizing ? `Reconociendo página ${currentPage} de ${pages}…` : 'Cargando el motor OCR local…', extra());
        },
        // Tesseract's job promise rejects as well. Handle its callback to avoid
        // an uncaught worker error and reject failed initialization promptly.
        errorHandler:error => { if (initializingOCR) initializationError(readerError('No se pudo preparar el OCR local. Recarga la página y vuelve a intentar.', 'OCR_INITIALIZE', error)); }
      });
      pendingWorker.then(value => { if (abandonedWorker) return value.terminate(); }, () => {}).catch(() => {});
      try {
        worker = await timed(Promise.race([pendingWorker, failed]), 90000,
          'No terminó de prepararse el OCR. Recarga la página e inténtalo de nuevo.', 'OCR_INITIALIZE_TIMEOUT');
        await worker.setParameters({preserve_interword_spaces:'1', user_defined_dpi:'200', tessedit_pageseg_mode:'3'});
        return worker;
      } finally {
        initializingOCR = false;
      }
    }

    async function recognize(canvas) {
      const localWorker = await ensureWorker();
      report('ocr', pageProgress(0.25), `Reconociendo página ${currentPage} de ${pages}…`, extra());
      let output;
      try {
        output = await timed(localWorker.recognize(canvas, {}, {text:true}), 120000,
          'El reconocimiento tardó demasiado. Divide el documento o usa una imagen más nítida.', 'OCR_TIMEOUT');
      } catch (error) {
        throw error?.name === 'DocumentReaderError' ? error : readerError('El OCR no pudo leer esta imagen. Revisa que sea nítida, completa y esté orientada correctamente.', 'OCR_RECOGNIZE', error);
      }
      const text = String(output?.data?.text || '').trim();
      const confidence = Number(output?.data?.confidence);
      if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 100) confidences.push({value:confidence, weight:Math.max(1, text.length)});
      if (!text) warnings.push(`Página ${currentPage}: no se encontró texto legible; revisa si está en blanco o requiere una imagen más nítida.`);
      else if (Number.isFinite(confidence) && confidence < 75) warnings.push(`Página ${currentPage}: reconocimiento de baja confianza. Confirma números de artículo, cantidades e importes contra la imagen.`);
      ocrPages += 1;
      return text;
    }

    try {
      report('validating', 0.01, 'Revisando el archivo…');
      const kind = await fileKind(file);
      if (kind === 'pdf') {
        report('pdf-loading', 0.03, 'Abriendo el PDF localmente…');
        const pdfjs = await loadPDF();
        const data = new Uint8Array(await file.arrayBuffer());
        loadingTask = pdfjs.getDocument({
          data,
          cMapUrl:PDF_PATH + 'cmaps/', cMapPacked:true,
          standardFontDataUrl:PDF_PATH + 'standard_fonts/', wasmUrl:PDF_PATH + 'wasm/',
          isEvalSupported:false, useSystemFonts:false, stopAtErrors:true, verbosity:0
        });
        const pdf = await timed(loadingTask.promise, 45000, 'El PDF tardó demasiado en abrirse. Comprueba que no esté dañado o divídelo en archivos más pequeños.', 'PDF_OPEN_TIMEOUT');
        pages = pdf.numPages;
        if (!Number.isInteger(pages) || pages < 1) throw readerError('El PDF no contiene páginas legibles.', 'PDF_EMPTY');
        const pageLimit=options?.layout?60:MAX_PAGES;
        if (pages > pageLimit) throw readerError('El PDF supera '+pageLimit+' páginas. Divídelo para revisarlo completo.', 'PDF_TOO_MANY_PAGES');
        for (currentPage = 1; currentPage <= pages; currentPage++) {
          const page = await pdf.getPage(currentPage);
          let canvas = null;
          try {
            report('pdf-text', pageProgress(0.03), `Leyendo página ${currentPage} de ${pages}…`, extra());
            let text = '';
            if (!options?.forceOCR) {
              try { text = await timed(readPDFText(page,!!options?.layout), 45000, 'La capa de texto del PDF no respondió a tiempo.', 'PDF_TEXT_TIMEOUT'); }
              catch (_) { warnings.push(`Página ${currentPage}: no se pudo usar la capa de texto; se intentó OCR sobre su imagen.`); }
            }
            if (!options?.forceOCR && usableText(text)) {
              texts.push(text);
              textPages += 1;
            } else {
              const original = page.getViewport({scale:1});
              const size = fittedSize(original.width, original.height, 200 / 72);
              const viewport = page.getViewport({scale:size.scale});
              const prepared = makeCanvas(size.width, size.height);
              canvas = prepared.canvas;
              report('pdf-render', pageProgress(0.08), `Preparando imagen de la página ${currentPage}…`, extra());
              await timed(page.render({canvas, canvasContext:prepared.context, viewport, background:'rgb(255,255,255)'}).promise,
                45000, 'No se pudo preparar la imagen del PDF a tiempo. Divide el documento y vuelve a intentar.', 'PDF_RENDER_TIMEOUT');
              texts.push(await recognize(canvas));
            }
            report('page-complete', pageProgress(1), `Página ${currentPage} de ${pages} leída.`, extra());
          } finally {
            if (canvas) canvas.width = canvas.height = 1;
            page.cleanup();
          }
        }
      } else {
        report('image-loading', 0.05, 'Abriendo imagen para reconocimiento local…', extra());
        let decoded = null, canvas = null;
        try {
          decoded = await decodeImage(file);
          const size = fittedSize(decoded.width, decoded.height, Math.min(2, Math.max(1, 1800 / Math.max(decoded.width, decoded.height))));
          const prepared = makeCanvas(size.width, size.height);
          canvas = prepared.canvas;
          prepared.context.drawImage(decoded.image, 0, 0, size.width, size.height);
          decoded.close();
          decoded = null;
          texts.push(await recognize(canvas));
        } finally {
          if (decoded) decoded.close();
          if (canvas) canvas.width = canvas.height = 1;
        }
      }
      const text = texts.join('\n\n').trim();
      if (!text) throw readerError('No se encontró texto legible. Carga una imagen más nítida o captura los datos manualmente para revisarlos.', 'DOCUMENT_NO_TEXT');
      if (ocrPages) warnings.push('Se utilizó OCR local. Revisa los artículos, cantidades, fechas e importes antes de registrar la compra.');
      if (ocrPages && textPages) warnings.push('Este PDF combina páginas con texto digital y páginas reconocidas por OCR.');
      const result = {text, extraction:ocrPages ? 'ocr' : 'pdf-text', pages, warnings:[...new Set(warnings)]};
      if (confidences.length) {
        const weight = confidences.reduce((sum, entry) => sum + entry.weight, 0);
        result.confidence = Math.round(confidences.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight * 100) / 100;
      }
      report('complete', 1, ocrPages ? 'Lectura OCR terminada. Revisa los datos extraídos.' : 'Texto del PDF leído. Revisa los datos extraídos.', {pages});
      return result;
    } catch (error) {
      throw friendlyError(error);
    } finally {
      abandonedWorker = true;
      if (worker) { try { Promise.resolve(worker.terminate()).catch(() => {}); } catch (_) {} }
      if (loadingTask) { try { Promise.resolve(loadingTask.destroy()).catch(() => {}); } catch (_) {} }
    }
  }

  global.DocumentReader29 = Object.freeze({extract, extractPDFText, readPDFText});
})(window);
