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

export const MOBILE_TOUCH_RESIZE_ARM_MS = 30000;

export function resolveTouchResizeStart(event, armedUntil = 0, {
  now = Date.now(),
  confirmResize = () => false,
  armDurationMs = MOBILE_TOUCH_RESIZE_ARM_MS,
} = {}) {
  if (!isTouchResizeEvent(event)) {
    if (Number(armedUntil) > Number(now)) {
      return {
        shouldStart: false,
        armedUntil: Number(armedUntil),
        confirmed: false,
      };
    }
    return { shouldStart: true, armedUntil: 0, confirmed: false };
  }

  if (Number(armedUntil) > Number(now)) {
    return { shouldStart: true, armedUntil: 0, confirmed: false };
  }

  const confirmed = Boolean(confirmResize());
  return {
    shouldStart: false,
    armedUntil: confirmed ? Number(now) + armDurationMs : 0,
    confirmed,
  };
}
