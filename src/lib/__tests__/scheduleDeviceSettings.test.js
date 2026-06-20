import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyScheduleDeviceSettings,
  normalizeScheduleDeviceSettings,
  SCHEDULE_DEVICE_SETTINGS_STORAGE_KEY,
} from '../scheduleDeviceSettings.js';

describe('schedule device settings', () => {
  it('keeps the shared scheduler interval and applies only the per-device time label interval', () => {
    const originalWindow = global.window;
    try {
      global.window = {
        localStorage: {
          getItem: (key) => key === SCHEDULE_DEVICE_SETTINGS_STORAGE_KEY
            ? JSON.stringify({ interval_minutes: 20, time_label_interval_minutes: 20 })
            : null,
        },
      };

      const settings = applyScheduleDeviceSettings({
        start_time: '09:00',
        interval_minutes: 10,
        time_label_interval_minutes: 30,
      });

      assert.equal(settings.start_time, '09:00');
      assert.equal(settings.interval_minutes, 10);
      assert.equal(settings.time_label_interval_minutes, 20);
    } finally {
      global.window = originalWindow;
    }
  });

  it('normalizes unsupported device time label interval values to the fallback', () => {
    const normalized = normalizeScheduleDeviceSettings(
      { interval_minutes: 7, time_label_interval_minutes: 45 },
      { interval_minutes: 30, time_label_interval_minutes: 60 }
    );

    assert.deepEqual(normalized, {
      time_label_interval_minutes: 60,
    });
  });
});
