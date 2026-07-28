export function getResizePointerClient(event) {
  const touch = event?.touches?.[0] || event?.changedTouches?.[0];
  return {
    x: touch?.clientX ?? event?.clientX ?? 0,
    y: touch?.clientY ?? event?.clientY ?? 0,
  };
}

export function isTouchResizeEvent(event) {
  return Boolean(event?.touches?.length || event?.changedTouches?.length);
}
