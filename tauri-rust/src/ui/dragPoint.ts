// The native drag events say where the pointer is, in page coordinates, and nothing about
// what is under it - each drop target answers that for itself.

/** Whether a page point is over an element's box. */
export function isInside(element: Element, x: number, y: number): boolean {
  const box = element.getBoundingClientRect()
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom
}
