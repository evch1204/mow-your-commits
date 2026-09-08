// Browser-only half of the exporter: rasterise an SVG string and hand it to the
// user as a file. The SVG carries its font as a data: URI, which is what makes
// this work at all - an <img> cannot see the page's web fonts.

/** Pull the root width/height out of the document we just generated. */
function size(svg) {
  const head = svg.slice(0, 400);
  const w = /\swidth="(\d+)"/.exec(head);
  const h = /\sheight="(\d+)"/.exec(head);
  return [w ? Number(w[1]) : 1058, h ? Number(h[1]) : 257];
}

/**
 * SVG string -> PNG Blob at `scale`x the natural size.
 * @returns {Promise<Blob>}
 */
export function svgToPngBlob(svg, scale = 2) {
  const [w, h] = size(svg);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error('the canvas would not give up a png'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not rasterise the svg'));
    };
    img.src = url;
  });
}

/** Save a Blob under `name`. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Convenience: an SVG string straight to a .svg download. */
export function downloadSvg(svg, name) {
  download(new Blob([svg], { type: 'image/svg+xml' }), name);
}
