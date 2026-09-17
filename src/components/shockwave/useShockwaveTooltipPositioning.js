import { useCallback } from 'react';

export function calculateTooltipCoordinates({
  clientX,
  clientY,
  tooltipWidth,
  tooltipHeight,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080,
  contextMenu = null,
  cellRect = null,
  menuRect = null,
  edgePadding = 8,
  offset = 14,
}) {
  let left = clientX + offset;
  let top = clientY + offset;

  // 컨텍스트 메뉴 또는 부위 팝업 창(standaloneSubmenu)이 열려 있는 상황에서는
  // 팝업 창 내용 및 해당 내용이 있는 셀을 가리지 않도록 피해서 배치
  if (contextMenu) {
    if (menuRect || cellRect) {
      const minLeft = Math.min(
        cellRect ? cellRect.left : (menuRect ? menuRect.left : clientX),
        menuRect ? menuRect.left : (cellRect ? cellRect.left : clientX)
      );
      const maxRight = Math.max(
        cellRect ? cellRect.right : (menuRect ? menuRect.right : clientX),
        menuRect ? menuRect.right : (cellRect ? cellRect.right : clientX)
      );
      const minTop = Math.min(
        cellRect ? cellRect.top : (menuRect ? menuRect.top : clientY),
        menuRect ? menuRect.top : (cellRect ? cellRect.top : clientY)
      );
      const maxBottom = Math.max(
        cellRect ? cellRect.bottom : (menuRect ? menuRect.bottom : clientY),
        menuRect ? menuRect.bottom : (cellRect ? cellRect.bottom : clientY)
      );

      const canPlaceLeft = minLeft - tooltipWidth - offset >= edgePadding;
      const canPlaceRight = maxRight + offset + tooltipWidth <= viewportWidth - edgePadding;
      const canPlaceTop = minTop - tooltipHeight - offset >= edgePadding;
      const canPlaceBottom = maxBottom + offset + tooltipHeight <= viewportHeight - edgePadding;

      // 1) 좌측 공간 충분: 셀과 메뉴의 왼쪽 바깥으로 배치 (셀 내용과 메뉴 모두 가리지 않음)
      if (canPlaceLeft) {
        left = minLeft - tooltipWidth - offset;
        top = cellRect ? (cellRect.top + cellRect.height / 2 - tooltipHeight / 2) : (clientY - tooltipHeight / 2);
      }
      // 2) 우측 공간 충분: 셀과 메뉴의 오른쪽 바깥으로 배치 (셀 내용과 메뉴 모두 가리지 않음)
      else if (canPlaceRight) {
        left = maxRight + offset;
        top = cellRect ? (cellRect.top + cellRect.height / 2 - tooltipHeight / 2) : (clientY - tooltipHeight / 2);
      }
      // 3) 좌우 모두 좁을 때: 상단 또는 하단으로 배치하여 셀과 메뉴를 덮지 않도록 함
      else if (canPlaceTop) {
        top = minTop - tooltipHeight - offset;
        left = cellRect ? (cellRect.left + cellRect.width / 2 - tooltipWidth / 2) : (clientX - tooltipWidth / 2);
      } else if (canPlaceBottom) {
        top = maxBottom + offset;
        left = cellRect ? (cellRect.left + cellRect.width / 2 - tooltipWidth / 2) : (clientX - tooltipWidth / 2);
      } else {
        // 화면 공간이 매우 좁을 때: 좌우 중 더 여유 있는 공간으로 배치
        const leftSpace = minLeft;
        const rightSpace = viewportWidth - maxRight;
        if (leftSpace >= rightSpace) {
          left = minLeft - tooltipWidth - offset;
        } else {
          left = maxRight + offset;
        }
        top = clientY - tooltipHeight / 2;
      }
    } else {
      // DOM 요소를 찾기 전이라도 contextMenu 활성화 시 좌측 우선 회피
      if (clientX - tooltipWidth - offset >= edgePadding) {
        left = clientX - tooltipWidth - offset;
      } else {
        left = clientX + offset;
      }
      top = clientY - tooltipHeight / 2;
    }
  } else {
    // 일반적인 상황: 기존 위치 및 동작 100% 유지
    if (left + tooltipWidth + edgePadding > viewportWidth) {
      left = clientX - tooltipWidth - offset;
    }
    if (top + tooltipHeight + edgePadding > viewportHeight) {
      top = clientY - tooltipHeight - offset;
    }
  }

  if (top + tooltipHeight + edgePadding > viewportHeight) {
    top = viewportHeight - tooltipHeight - edgePadding;
  }
  if (top < edgePadding) top = edgePadding;

  left = Math.min(
    Math.max(edgePadding, left),
    Math.max(edgePadding, viewportWidth - tooltipWidth - edgePadding)
  );
  top = Math.min(
    Math.max(edgePadding, top),
    Math.max(edgePadding, viewportHeight - tooltipHeight - edgePadding)
  );

  return { left, top };
}

export default function useShockwaveTooltipPositioning({
  contextMenu,
  hoverCell,
  setHoverCell,
  tooltipMousePosRef,
  tooltipRef,
}) {
  const positionTooltip = useCallback((clientX, clientY) => {
    const tooltipElement = tooltipRef.current;
    if (!tooltipElement) return;

    const offset = 14;
    const edgePadding = 8;
    const { width, height } = tooltipElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 해당 셀 DOM 요소 탐색 (hoverCell, contextMenu, 마우스 좌표 등 다단계 탐색)
    let cellEl = null;
    if (
      hoverCell &&
      typeof hoverCell.weekIdx === 'number' &&
      typeof hoverCell.dayIdx === 'number' &&
      typeof hoverCell.rowIdx === 'number' &&
      typeof hoverCell.colIdx === 'number' &&
      hoverCell.colIdx >= 0
    ) {
      cellEl = document.getElementById(
        `cell-${hoverCell.weekIdx}-${hoverCell.dayIdx}-${hoverCell.rowIdx}-${hoverCell.colIdx}`
      );
    }
    if (
      !cellEl &&
      contextMenu &&
      typeof contextMenu.weekIdx === 'number' &&
      typeof contextMenu.dayIdx === 'number' &&
      typeof contextMenu.rowIdx === 'number' &&
      typeof contextMenu.colIdx === 'number' &&
      contextMenu.colIdx >= 0
    ) {
      cellEl = document.getElementById(
        `cell-${contextMenu.weekIdx}-${contextMenu.dayIdx}-${contextMenu.rowIdx}-${contextMenu.colIdx}`
      );
    }
    if (!cellEl && typeof document !== 'undefined') {
      const elAtPoint = document.elementFromPoint ? document.elementFromPoint(clientX, clientY) : null;
      if (elAtPoint) {
        cellEl = elAtPoint.closest?.('.sw-cell') || elAtPoint.closest?.('.shockwave-time-label-cell');
      }
      if (!cellEl) {
        cellEl = document.querySelector('.sw-cell.selected') || document.querySelector('.sw-cell:hover');
      }
    }

    const cellRect = cellEl ? cellEl.getBoundingClientRect() : null;
    const menuEl = document.querySelector('.shockwave-context-menu');
    const menuRect = menuEl ? menuEl.getBoundingClientRect() : null;

    const { left, top } = calculateTooltipCoordinates({
      clientX,
      clientY,
      tooltipWidth: width,
      tooltipHeight: height,
      viewportWidth,
      viewportHeight,
      contextMenu,
      cellRect,
      menuRect,
      edgePadding,
      offset,
    });

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
    tooltipElement.style.opacity = hoverCell ? '1' : '0';
  }, [contextMenu, hoverCell, tooltipRef]);

  const handleTimeLabelMouseMove = useCallback((
    event,
    weekIdx,
    dayIdx,
    startSlotRenderIndex,
    labelSpan,
    daySlots
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const slotHeight = rect.height / labelSpan;
    const offset = Math.floor(relativeY / slotHeight);
    const targetIndex = Math.min(
      startSlotRenderIndex + offset,
      startSlotRenderIndex + labelSpan - 1
    );
    const slotInfo = daySlots[targetIndex];
    if (!slotInfo) return;

    setHoverCell({
      weekIdx,
      dayIdx,
      rowIdx: slotInfo.idx,
      colIdx: -1,
      staffBlockRule: null,
      slotInfo,
      selectionInfo: null,
    });
    tooltipMousePosRef.current = { x: event.clientX, y: event.clientY };
    if (tooltipRef.current) positionTooltip(event.clientX, event.clientY);
  }, [positionTooltip, setHoverCell, tooltipMousePosRef, tooltipRef]);

  const handleTimeLabelMouseLeave = useCallback(() => {
    setHoverCell(null);
  }, [setHoverCell]);

  return {
    handleTimeLabelMouseLeave,
    handleTimeLabelMouseMove,
    positionTooltip,
  };
}
