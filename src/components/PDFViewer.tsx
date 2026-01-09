import { useEffect, useRef, useState } from 'preact/hooks';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFCache } from '../utils/PDFCache';

// Use the local worker with dynamic base path
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

interface PDFViewerProps {
    url: string;
    page: number;
    onLoad: (totalPages: number) => void;
    onRender: (viewport: any) => void;
    children?: any;
}

export function PDFViewer({ url, page, onLoad, onRender, children }: PDFViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [loading, setLoading] = useState(false);
    const [rendering, setRendering] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!url) return;

        setLoading(true);
        setError(null);

        const loadPDF = async () => {
            // Handle ArXiv CORS:
            // ArXiv allows "Simple Requests" (standard GET) with Access-Control-Allow-Origin: *
            // But it BLOCKS "Preflighted Requests" (OPTIONS requests).
            // PDF.js by default uses Range headers for chunked downloads, which triggers preflight.
            // Fix: Disable range/stream requests to keep it as a "Simple Request".
            let finalUrl = url;
            const isArxiv = url.toLowerCase().includes('arxiv.org');

            if (isArxiv) {
                // Remove trailing .pdf if present (ArXiv CORS works on /pdf/ID without extension)
                let cleanUrl = url.replace(/\.pdf$/i, '');
                // Convert /abs/ to /pdf/ if present
                cleanUrl = cleanUrl.replace(/\/abs\//i, '/pdf/');
                finalUrl = cleanUrl;
                console.log('[PDFViewer] Using direct ArXiv CORS endpoint:', finalUrl);
            }

            try {
                // Check cache first
                const cachedData = await PDFCache.get(url);
                let loadingTask;

                if (cachedData) {
                    loadingTask = pdfjsLib.getDocument({ data: cachedData });
                } else {
                    // Configure PDF.js options
                    const pdfOptions: any = { url: finalUrl };

                    if (isArxiv) {
                        // Disable Range/Stream requests to avoid OPTIONS preflight
                        // This makes ArXiv serve the file as a simple GET request
                        pdfOptions.disableRange = true;
                        pdfOptions.disableStream = true;
                        console.log('[PDFViewer] Disabled Range/Stream for ArXiv (avoiding CORS preflight)');
                    }

                    loadingTask = pdfjsLib.getDocument(pdfOptions);
                }

                const pdfDoc = await loadingTask.promise;

                // If we fetched it (not from cache), store it
                if (!cachedData) {
                    const data = await pdfDoc.getData();
                    await PDFCache.set(url, data);
                }

                setPdf(pdfDoc);
                onLoad(pdfDoc.numPages);
                setLoading(false);
            } catch (reason: any) {
                console.error('Error loading PDF:', reason);
                setError(`Failed to load PDF: ${reason.message || reason}`);
                setLoading(false);
            }
        };

        loadPDF();

        return () => {
            // Cleanup if needed (pdfjs-dist handles most things)
        };
    }, [url]);

    useEffect(() => {
        if (!pdf || !canvasRef.current || !containerRef.current) return;

        setRendering(true);

        const renderPage = () => {
            pdf.getPage(page).then((pdfPage) => {
                const canvas = canvasRef.current!;
                const container = containerRef.current!;
                const context = canvas.getContext('2d')!;

                const viewport = pdfPage.getViewport({ scale: 1 });
                // Fill the available width
                const containerWidth = container.clientWidth;
                const scale = containerWidth / viewport.width;
                const scaledViewport = pdfPage.getViewport({ scale });

                const outputScale = window.devicePixelRatio || 1;
                canvas.width = Math.floor(scaledViewport.width * outputScale);
                canvas.height = Math.floor(scaledViewport.height * outputScale);
                canvas.style.width = Math.floor(scaledViewport.width) + "px";
                canvas.style.height = Math.floor(scaledViewport.height) + "px";

                const renderContext = {
                    canvasContext: context,
                    canvas: canvas,
                    viewport: scaledViewport,
                    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
                };

                pdfPage.render(renderContext).promise.then(() => {
                    setRendering(false);
                    onRender(scaledViewport);
                });
            });
        };

        renderPage();

        window.addEventListener('resize', renderPage);
        return () => window.removeEventListener('resize', renderPage);
    }, [pdf, page]);

    if (error) {
        return (
            <div className="premium-card" style={{ padding: '2rem', color: '#ef4444', margin: '2rem' }}>
                {error}
            </div>
        );
    }

    return (
        <div ref={containerRef} className="pdf-viewer-container">
            {loading && (
                <div className="loading-overlay">
                    <div className="spinner"></div>
                    <span>Loading PDF...</span>
                </div>
            )}
            {!loading && rendering && (
                <div className="loading-overlay">
                    <div className="spinner"></div>
                    <span>Rendering page...</span>
                </div>
            )}
            <div style={{ position: 'relative', display: 'inline-block' }}>
                <canvas ref={canvasRef} style={{ display: 'block' }} />
                {children}
            </div>
        </div>
    );
}
