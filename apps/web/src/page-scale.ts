/**
 * Height the element occupies in the coordinates its own stylesheet works in.
 *
 * The page is scaled down with `zoom` on desktop widths, and
 * getBoundingClientRect reports the painted size, so a measured header is
 * shorter than the value CSS calculates with. Dividing by the element's
 * effective zoom hands layout code back a number it can compare with px.
 */
export function layoutHeight(element: Element): number {
  const zoom = (element as Element & { currentCSSZoom?: number }).currentCSSZoom;
  return element.getBoundingClientRect().height / (zoom && zoom > 0 ? zoom : 1);
}
