// Keep the autofill decision identical for preloading and applying history.
// A complete copied reservation can render without an unused history round trip.
export function needsSchedulePasteHistory(item) {
  return Boolean(item?.content && (!item.prescription || !item.body_part));
}
