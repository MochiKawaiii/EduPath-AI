/**
 * The factor the page is painted at, as CSS `zoom` on the element's ancestors.
 *
 * The page is scaled down with `zoom` on desktop widths, so measured geometry
 * (`getBoundingClientRect`) is smaller than the numbers the stylesheet works
 * in. Dividing a measurement by this factor hands layout code back a value it
 * can compare with — or feed back into — px written in CSS.
 */
export function layoutZoom(element: Element): number {
  const zoom = (element as Element & { currentCSSZoom?: number }).currentCSSZoom;
  return zoom && zoom > 0 ? zoom : 1;
}

/**
 * Height the element occupies in the coordinates its own stylesheet works in.
 *
 * getBoundingClientRect reports the painted size, so a measured header is
 * shorter than the value CSS calculates with.
 */
export function layoutHeight(element: Element): number {
  return element.getBoundingClientRect().height / layoutZoom(element);
}
