import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONTEXT_MENU_DISMISS_GRACE_MS,
  isSchedulerCellContextMenuTarget,
  shouldIgnoreContextMenuDismissEvent,
} from '../contextMenuDismissUtils.js';

describe('context menu dismiss guard', () => {
  it('ignores the click sequence that can arrive right after opening a context menu', () => {
    assert.equal(
      shouldIgnoreContextMenuDismissEvent(
        { openedAt: 1000 },
        { button: 0 },
        1000 + CONTEXT_MENU_DISMISS_GRACE_MS - 1
      ),
      true
    );
  });

  it('allows normal outside clicks after the opening grace window', () => {
    assert.equal(
      shouldIgnoreContextMenuDismissEvent(
        { openedAt: 1000 },
        { button: 0 },
        1000 + CONTEXT_MENU_DISMISS_GRACE_MS
      ),
      false
    );
  });

  it('keeps secondary-button events from closing before a replacement context menu opens', () => {
    assert.equal(
      shouldIgnoreContextMenuDismissEvent(
        { openedAt: 1000 },
        { button: 2 },
        1000 + CONTEXT_MENU_DISMISS_GRACE_MS + 1000
      ),
      true
    );
  });
});

describe('scheduler cell context menu target detection', () => {
  it('detects events that came from a scheduler cell descendant', () => {
    const target = {
      closest: (selector) => (selector === '.sw-cell' ? { id: 'cell-0-0-0-0' } : null),
    };

    assert.equal(isSchedulerCellContextMenuTarget(target), true);
  });

  it('ignores targets outside scheduler cells', () => {
    const target = {
      closest: () => null,
    };

    assert.equal(isSchedulerCellContextMenuTarget(target), false);
    assert.equal(isSchedulerCellContextMenuTarget(null), false);
  });
});
