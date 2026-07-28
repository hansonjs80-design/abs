export const MOBILE_CONTENT_ZOOM_MIN = 0.5;
export const MOBILE_CONTENT_ZOOM_MAX = 1;
export const MOBILE_CONTENT_ZOOM_EPSILON = 0.015;

export function clampMobileContentZoom(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return MOBILE_CONTENT_ZOOM_MAX;
  return Math.min(
    MOBILE_CONTENT_ZOOM_MAX,
    Math.max(MOBILE_CONTENT_ZOOM_MIN, numericValue)
  );
}

export function getTouchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const firstTouch = touches[0];
  const secondTouch = touches[1];
  return Math.hypot(
    Number(secondTouch?.clientX || 0) - Number(firstTouch?.clientX || 0),
    Number(secondTouch?.clientY || 0) - Number(firstTouch?.clientY || 0)
  );
}

export function getMobileContentZoom({
  startZoom,
  startDistance,
  currentDistance,
}) {
  const normalizedStartDistance = Number(startDistance);
  const normalizedCurrentDistance = Number(currentDistance);
  if (
    !Number.isFinite(normalizedStartDistance) ||
    normalizedStartDistance <= 0 ||
    !Number.isFinite(normalizedCurrentDistance) ||
    normalizedCurrentDistance <= 0
  ) {
    return clampMobileContentZoom(startZoom);
  }

  return clampMobileContentZoom(
    Number(startZoom) * (normalizedCurrentDistance / normalizedStartDistance)
  );
}

export function getMobilePinchMode({
  currentZoom,
  nativeViewportScale,
  distanceRatio,
}) {
  const normalizedZoom = clampMobileContentZoom(currentZoom);
  const normalizedNativeScale = Number(nativeViewportScale) || 1;
  const normalizedDistanceRatio = Number(distanceRatio) || 1;

  if (normalizedNativeScale > 1 + MOBILE_CONTENT_ZOOM_EPSILON) {
    return 'native';
  }
  if (normalizedZoom < 1 - MOBILE_CONTENT_ZOOM_EPSILON) {
    return 'custom';
  }
  if (normalizedDistanceRatio < 1 - MOBILE_CONTENT_ZOOM_EPSILON) {
    return 'custom';
  }
  if (normalizedDistanceRatio > 1 + MOBILE_CONTENT_ZOOM_EPSILON) {
    return 'native';
  }
  return 'pending';
}
