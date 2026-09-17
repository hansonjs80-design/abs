import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateTooltipCoordinates } from '../useShockwaveTooltipPositioning.js';

describe('useShockwaveTooltipPositioning calculateTooltipCoordinates', () => {
  const tooltipWidth = 260;
  const tooltipHeight = 140;
  const viewportWidth = 1920;
  const viewportHeight = 1080;
  const edgePadding = 8;
  const offset = 14;

  it('places tooltip at bottom-right of mouse in normal state (no context menu)', () => {
    const coords = calculateTooltipCoordinates({
      clientX: 500,
      clientY: 300,
      tooltipWidth,
      tooltipHeight,
      viewportWidth,
      viewportHeight,
      contextMenu: null,
      edgePadding,
      offset,
    });

    assert.equal(coords.left, 500 + offset);
    assert.equal(coords.top, 300 + offset);
  });

  it('flips to left and top when nearing screen boundaries in normal state', () => {
    const coords = calculateTooltipCoordinates({
      clientX: 1800,
      clientY: 1000,
      tooltipWidth,
      tooltipHeight,
      viewportWidth,
      viewportHeight,
      contextMenu: null,
      edgePadding,
      offset,
    });

    assert.equal(coords.left, 1800 - tooltipWidth - offset);
    assert.equal(coords.top, 1000 - tooltipHeight - offset);
  });

  it('avoids covering both cell and menu by placing to the left of the cell when left space is sufficient', () => {
    // 셀: 500 ~ 650, 메뉴: 650 ~ 900
    const cellRect = { left: 500, right: 650, top: 300, bottom: 350, width: 150, height: 50 };
    const menuRect = { left: 650, right: 900, top: 300, bottom: 600, width: 250, height: 300 };

    const coords = calculateTooltipCoordinates({
      clientX: 550,
      clientY: 320,
      tooltipWidth,
      tooltipHeight,
      viewportWidth,
      viewportHeight,
      contextMenu: { active: true },
      cellRect,
      menuRect,
      edgePadding,
      offset,
    });

    // 툴팁의 오른쪽 끝이 셀의 왼쪽 시작점보다 offset만큼 왼쪽에 있어야 함 (셀을 1px도 덮지 않음)
    assert.ok(coords.left + tooltipWidth <= cellRect.left);
    assert.equal(coords.left, cellRect.left - tooltipWidth - offset);
  });

  it('places tooltip to the right of the menu when cell is at the left edge and left space is tight', () => {
    // 셀: 50 ~ 200 (좌측 여백이 50px로 툴팁 260px보다 작음), 메뉴: 200 ~ 450
    const cellRect = { left: 50, right: 200, top: 300, bottom: 350, width: 150, height: 50 };
    const menuRect = { left: 200, right: 450, top: 300, bottom: 600, width: 250, height: 300 };

    const coords = calculateTooltipCoordinates({
      clientX: 100,
      clientY: 320,
      tooltipWidth,
      tooltipHeight,
      viewportWidth,
      viewportHeight,
      contextMenu: { active: true },
      cellRect,
      menuRect,
      edgePadding,
      offset,
    });

    // 툴팁의 시작점이 메뉴의 오른쪽보다 크거나 같아야 함 (메뉴와 셀 모두 덮지 않음)
    assert.ok(coords.left >= menuRect.right + offset);
    assert.equal(coords.left, menuRect.right + offset);
  });

  it('places tooltip above the cell and menu when both left and right spaces are insufficient', () => {
    // 좁은 뷰포트 600x800
    // 셀: 100 ~ 250, 메뉴: 250 ~ 550 (좌측 100px 부족, 우측 50px 부족)
    const customViewportWidth = 600;
    const customViewportHeight = 800;
    const cellRect = { left: 100, right: 250, top: 400, bottom: 450, width: 150, height: 50 };
    const menuRect = { left: 250, right: 550, top: 400, bottom: 700, width: 300, height: 300 };

    const coords = calculateTooltipCoordinates({
      clientX: 150,
      clientY: 420,
      tooltipWidth,
      tooltipHeight,
      viewportWidth: customViewportWidth,
      viewportHeight: customViewportHeight,
      contextMenu: { active: true },
      cellRect,
      menuRect,
      edgePadding,
      offset,
    });

    // 툴팁의 하단이 셀/메뉴의 상단(400)보다 위에 있어야 함 (셀 내용을 덮지 않음)
    assert.ok(coords.top + tooltipHeight <= Math.min(cellRect.top, menuRect.top));
  });

  it('places tooltip below the cell and menu when horizontal space and top space are both insufficient', () => {
    const customViewportWidth = 600;
    const customViewportHeight = 800;
    // 셀과 메뉴가 상단(50px)에 위치하여 위쪽 공간 부족
    const cellRect = { left: 100, right: 250, top: 50, bottom: 100, width: 150, height: 50 };
    const menuRect = { left: 250, right: 550, top: 50, bottom: 350, width: 300, height: 300 };

    const coords = calculateTooltipCoordinates({
      clientX: 150,
      clientY: 70,
      tooltipWidth,
      tooltipHeight,
      viewportWidth: customViewportWidth,
      viewportHeight: customViewportHeight,
      contextMenu: { active: true },
      cellRect,
      menuRect,
      edgePadding,
      offset,
    });

    // 툴팁의 상단이 메뉴/셀의 하단(350)보다 아래에 있어야 함 (셀 내용을 덮지 않음)
    assert.ok(coords.top >= Math.max(cellRect.bottom, menuRect.bottom) + offset);
  });
});
