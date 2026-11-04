/** Persist in the unrotated PDF coordinate system, independent of zoom and CSS pixels. */
export function toPdfRect(
  rect: { left: number; top: number; right: number; bottom: number },
  origin: { left: number; top: number },
  view: number[],
  viewport: { convertToPdfPoint: (x: number, y: number) => number[] },
) {
  const a = viewport.convertToPdfPoint(
      rect.left - origin.left,
      rect.top - origin.top,
    ),
    b = viewport.convertToPdfPoint(
      rect.right - origin.left,
      rect.bottom - origin.top,
    );
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ].map((value, i) =>
    Math.max(
      0,
      Math.min(
        1,
        (value - view[i % 2]) /
          (i % 2 === 0 ? view[2] - view[0] : view[3] - view[1]),
      ),
    ),
  );
}
export function toViewportRect(
  rect: number[],
  view: number[],
  viewport: { convertToViewportRectangle: (rect: number[]) => number[] },
) {
  const coords = viewport.convertToViewportRectangle([
    view[0] + rect[0] * (view[2] - view[0]),
    view[1] + rect[1] * (view[3] - view[1]),
    view[0] + rect[2] * (view[2] - view[0]),
    view[1] + rect[3] * (view[3] - view[1]),
  ]);
  return [
    Math.min(coords[0], coords[2]),
    Math.min(coords[1], coords[3]),
    Math.abs(coords[2] - coords[0]),
    Math.abs(coords[3] - coords[1]),
  ];
}
