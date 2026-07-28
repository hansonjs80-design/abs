import { useEffect, useRef } from 'react';

import {
  MOBILE_CONTENT_ZOOM_EPSILON,
  clampMobileContentZoom,
  getMobileContentZoom,
  getMobilePinchMode,
  getTouchDistance,
} from '../lib/mobilePinchZoomUtils';

const MOBILE_PINCH_MEDIA_QUERY =
  '(max-width: 768px), ((hover: none) and (pointer: coarse) and (orientation: landscape))';

function applyMobileContentZoom(element, zoom) {
  if (!element) return;
  const normalizedZoom = clampMobileContentZoom(zoom);

  if (normalizedZoom >= 1 - MOBILE_CONTENT_ZOOM_EPSILON) {
    element.style.removeProperty('--mobile-content-zoom');
    delete element.dataset.mobilePinchZoom;
    return;
  }

  element.style.setProperty('--mobile-content-zoom', String(normalizedZoom));
  element.dataset.mobilePinchZoom = String(normalizedZoom);
}

export default function useMobilePinchZoom(contentRef) {
  const currentZoomRef = useRef(1);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof window === 'undefined') return undefined;

    const mobileQuery = window.matchMedia(MOBILE_PINCH_MEDIA_QUERY);
    let pinchState = null;
    let gestureState = null;

    const resetPinchState = () => {
      pinchState = null;
      gestureState = null;
    };

    const resetContentZoom = () => {
      currentZoomRef.current = 1;
      applyMobileContentZoom(content, 1);
      resetPinchState();
    };

    const handleTouchStart = (event) => {
      if (!mobileQuery.matches || event.touches?.length !== 2) {
        resetPinchState();
        return;
      }

      const startDistance = getTouchDistance(event.touches);
      if (startDistance <= 0) return;

      pinchState = {
        mode: 'pending',
        startDistance,
        startZoom: currentZoomRef.current,
        nativeViewportScale: Number(window.visualViewport?.scale) || 1,
      };
    };

    const handleTouchMove = (event) => {
      if (!pinchState || event.touches?.length !== 2 || !mobileQuery.matches) return;

      const currentDistance = getTouchDistance(event.touches);
      if (currentDistance <= 0) return;

      if (pinchState.mode === 'pending') {
        pinchState.mode = getMobilePinchMode({
          currentZoom: pinchState.startZoom,
          nativeViewportScale: pinchState.nativeViewportScale,
          distanceRatio: currentDistance / pinchState.startDistance,
        });
      }

      if (pinchState.mode !== 'custom') return;

      event.preventDefault();
      const nextZoom = getMobileContentZoom({
        startZoom: pinchState.startZoom,
        startDistance: pinchState.startDistance,
        currentDistance,
      });
      currentZoomRef.current = nextZoom;
      applyMobileContentZoom(content, nextZoom);
    };

    const handleTouchEnd = (event) => {
      if ((event.touches?.length || 0) < 2) resetPinchState();
    };

    const handleGestureStart = (event) => {
      if (!mobileQuery.matches) {
        gestureState = null;
        return;
      }

      const startZoom = currentZoomRef.current;
      gestureState = {
        mode: startZoom < 1 - MOBILE_CONTENT_ZOOM_EPSILON ? 'custom' : 'pending',
        startZoom,
        nativeViewportScale: Number(window.visualViewport?.scale) || 1,
      };

      if (gestureState.mode === 'custom') event.preventDefault();
    };

    const handleGestureChange = (event) => {
      if (!gestureState || !mobileQuery.matches) return;
      const gestureScale = Number(event.scale) || 1;

      if (gestureState.mode === 'pending') {
        gestureState.mode = getMobilePinchMode({
          currentZoom: gestureState.startZoom,
          nativeViewportScale: gestureState.nativeViewportScale,
          distanceRatio: gestureScale,
        });
      }

      if (gestureState.mode !== 'custom') return;

      event.preventDefault();
      const nextZoom = clampMobileContentZoom(
        gestureState.startZoom * gestureScale
      );
      currentZoomRef.current = nextZoom;
      applyMobileContentZoom(content, nextZoom);
    };

    const handleMediaChange = () => {
      if (!mobileQuery.matches) resetContentZoom();
    };

    content.addEventListener('touchstart', handleTouchStart, {
      capture: true,
      passive: true,
    });
    content.addEventListener('touchmove', handleTouchMove, {
      capture: true,
      passive: false,
    });
    content.addEventListener('touchend', handleTouchEnd, {
      capture: true,
      passive: true,
    });
    content.addEventListener('touchcancel', resetPinchState, {
      capture: true,
      passive: true,
    });
    content.addEventListener('gesturestart', handleGestureStart, {
      capture: true,
      passive: false,
    });
    content.addEventListener('gesturechange', handleGestureChange, {
      capture: true,
      passive: false,
    });
    content.addEventListener('gestureend', resetPinchState, {
      capture: true,
      passive: true,
    });
    mobileQuery.addEventListener?.('change', handleMediaChange);

    return () => {
      content.removeEventListener('touchstart', handleTouchStart, true);
      content.removeEventListener('touchmove', handleTouchMove, true);
      content.removeEventListener('touchend', handleTouchEnd, true);
      content.removeEventListener('touchcancel', resetPinchState, true);
      content.removeEventListener('gesturestart', handleGestureStart, true);
      content.removeEventListener('gesturechange', handleGestureChange, true);
      content.removeEventListener('gestureend', resetPinchState, true);
      mobileQuery.removeEventListener?.('change', handleMediaChange);
      resetContentZoom();
    };
  }, [contentRef]);
}
