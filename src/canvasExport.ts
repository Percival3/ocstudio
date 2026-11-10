export type CanvasFormat = 'png' | 'pdf';

export function safeCanvasName(title: string) {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '画布';
}

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function renderCanvas(viewport: HTMLElement, zoom: number): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image');
  const origin = viewport.getBoundingClientRect();
  const items = viewport.querySelectorAll('.world-card, .timeline-card, .edge-label, .react-flow__edge-path');
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    left = Math.min(left, (rect.left - origin.left) / zoom);
    top = Math.min(top, (rect.top - origin.top) / zoom);
    right = Math.max(right, (rect.right - origin.left) / zoom);
    bottom = Math.max(bottom, (rect.bottom - origin.top) / zoom);
  }
  const padding = 32;
  const width = Math.ceil(right - left + padding * 2);
  const height = Math.ceil(bottom - top + padding * 2);
  // Limit output memory without cutting off distant parts of a large canvas.
  const scale = Math.min(1, 8000 / Math.max(width, height), Math.sqrt(24000000 / (width * height)));
  const pixelRatio = Math.min(2, 8000 / (Math.max(width, height) * scale), Math.sqrt(24000000 / (width * height * scale * scale)));
  return toCanvas(viewport, {
    width: Math.ceil(width * scale), height: Math.ceil(height * scale), pixelRatio,
    backgroundColor: '#fcfdfe', skipFonts: true, skipAutoScale: true,
    style: { transform: `scale(${scale}) translate(${padding - left}px, ${padding - top}px)`, transformOrigin: '0 0' },
    filter: node => !(node instanceof Element && node.matches('.react-flow__handle, .react-flow__resize-control, .edge-bend-handle, .react-flow__nodesselection')),
  });
}

export async function downloadCanvas(canvas: HTMLCanvasElement, title: string, format: CanvasFormat) {
  const filename = safeCanvasName(title);
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成画布图片。')), 'image/png');
  });
  if (format === 'png') {
    downloadFile(png, `${filename}.png`);
    return;
  }
  const { jsPDF } = await import('jspdf');
  const width = canvas.width * 0.75;
  const height = canvas.height * 0.75;
  const pdf = new jsPDF({ unit: 'pt', format: [width, height], orientation: width >= height ? 'landscape' : 'portrait', compress: true });
  pdf.addImage(new Uint8Array(await png.arrayBuffer()), 'PNG', 0, 0, width, height);
  downloadFile(pdf.output('blob'), `${filename}.pdf`);
}
