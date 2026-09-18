// Pure, DOM-free zoom/pan math for the image viewer. A point (ix, iy) in image pixels maps
// to screen coords (tx + ix*scale, ty + iy*scale); the ImageViewer applies the result as a
// CSS transform.

export interface Size { width: number; height: number; }
export interface Point { x: number; y: number; }
export interface Transform { scale: number; tx: number; ty: number; }
export interface ViewContext { container: Size; image: Size; minScale: number; maxScale: number; }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// The contain scale — the largest scale at which the whole image fits the container. May be
// >1 for an image smaller than the container.
export function fitScale(container: Size, image: Size): number {
  if (image.width === 0 || image.height === 0) return 1;
  return Math.min(container.width / image.width, container.height / image.height);
}

// The initial (and minimum) scale: contain, but never upscale past natural size — a small
// image shows at 100% centered rather than being blown up to fill the frame.
export function baseScale(container: Size, image: Size): number {
  return Math.min(fitScale(container, image), 1);
}

export function centeredAt(container: Size, image: Size, scale: number): Transform {
  return {
    scale,
    tx: (container.width - image.width * scale) / 2,
    ty: (container.height - image.height * scale) / 2,
  };
}

export function fit(container: Size, image: Size): Transform {
  return centeredAt(container, image, baseScale(container, image));
}

// Center when the content is smaller than the container; otherwise clamp so the content's
// edge can't be dragged inside the container (no blank gutters when zoomed in).
function axis(pos: number, container: number, content: number): number {
  if (content <= container) return (container - content) / 2;
  return clamp(pos, container - content, 0);
}

function constrain(t: Transform, ctx: ViewContext): Transform {
  return {
    scale: t.scale,
    tx: axis(t.tx, ctx.container.width, ctx.image.width * t.scale),
    ty: axis(t.ty, ctx.container.height, ctx.image.height * t.scale),
  };
}

export function zoomAt(t: Transform, focal: Point, factor: number, ctx: ViewContext): Transform {
  const scale = clamp(t.scale * factor, ctx.minScale, ctx.maxScale);
  const ix = (focal.x - t.tx) / t.scale;
  const iy = (focal.y - t.ty) / t.scale;
  return constrain({ scale, tx: focal.x - ix * scale, ty: focal.y - iy * scale }, ctx);
}

export function panBy(t: Transform, dx: number, dy: number, ctx: ViewContext): Transform {
  return constrain({ scale: t.scale, tx: t.tx + dx, ty: t.ty + dy }, ctx);
}
