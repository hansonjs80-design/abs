import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOBILE_CONTENT_ZOOM_MAX,
  MOBILE_CONTENT_ZOOM_MIN,
  clampMobileContentZoom,
  getMobileContentZoom,
  getMobilePinchMode,
  getTouchDistance,
} from './mobilePinchZoomUtils.js';

test('mobile pinch distance uses the first two touches', () => {
  assert.equal(
    getTouchDistance([
      { clientX: 0, clientY: 0 },
      { clientX: 30, clientY: 40 },
    ]),
    50
  );
});

test('mobile content zoom follows pinch-in distance below the native minimum', () => {
  assert.equal(
    getMobileContentZoom({
      startZoom: 1,
      startDistance: 200,
      currentDistance: 150,
    }),
    0.75
  );
  assert.equal(
    getMobileContentZoom({
      startZoom: 0.75,
      startDistance: 150,
      currentDistance: 250,
    }),
    MOBILE_CONTENT_ZOOM_MAX
  );
});

test('mobile content zoom remains within the readable range', () => {
  assert.equal(clampMobileContentZoom(0.1), MOBILE_CONTENT_ZOOM_MIN);
  assert.equal(clampMobileContentZoom(3), MOBILE_CONTENT_ZOOM_MAX);
});

test('mobile pinch uses custom zoom only below native page scale', () => {
  assert.equal(
    getMobilePinchMode({
      currentZoom: 1,
      nativeViewportScale: 1,
      distanceRatio: 0.8,
    }),
    'custom'
  );
  assert.equal(
    getMobilePinchMode({
      currentZoom: 1,
      nativeViewportScale: 1,
      distanceRatio: 1.2,
    }),
    'native'
  );
  assert.equal(
    getMobilePinchMode({
      currentZoom: 1,
      nativeViewportScale: 2,
      distanceRatio: 0.8,
    }),
    'native'
  );
  assert.equal(
    getMobilePinchMode({
      currentZoom: 0.75,
      nativeViewportScale: 1,
      distanceRatio: 1.2,
    }),
    'custom'
  );
});
