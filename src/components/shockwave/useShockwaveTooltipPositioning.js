import { useCallback } from 'react';

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

    let left = clientX + offset;
    let top = clientY + offset;

    // 컨텍스트 메뉴 또는 부위 팝업 창(standaloneSubmenu)이 열려 있는 상황에서는
    // 팝업 창 내용을 가리지 않도록 팝업 창의 반대편(좌측 등)으로 피해서 배치
    if (contextMenu) {
      const menuEl = document.querySelector('.shockwave-context-menu');
      if (menuEl) {
        const menuRect = menuEl.getBoundingClientRect();
        // 메뉴가 마우스(또는 셀) 우측에 위치해 있는 경우: 호버창을 마우스/메뉴 좌측으로 이동
        if (menuRect.left >= clientX - 20 || menuRect.right > clientX) {
          if (menuRect.left - width - offset >= edgePadding) {
            left = menuRect.left - width - offset;
          } else if (clientX - width - offset >= edgePadding) {
            left = clientX - width - offset;
          } else if (menuRect.right + width + offset <= viewportWidth - edgePadding) {
            left = menuRect.right + offset;
          } else {
            left = clientX - width - offset;
          }
        } else {
          // 메뉴가 좌측에 있는 경우: 호버창을 메뉴 오른쪽 또는 마우스 우측으로 이동
          if (menuRect.right + offset + width <= viewportWidth - edgePadding) {
            left = menuRect.right + offset;
          } else {
            left = clientX + offset;
          }
        }

        // Y축도 자연스럽게 마우스 높이에 맞춤
        top = clientY - height / 2;
      } else {
        // 메뉴 DOM 요소를 찾기 전이라도 contextMenu가 활성화되면 좌측 우선 배치
        if (clientX - width - offset >= edgePadding) {
          left = clientX - width - offset;
        } else {
          left = clientX + offset;
        }
        top = clientY - height / 2;
      }
    } else {
      // 일반적인 상황: 기존 위치 및 동작 100% 유지
      if (left + width + edgePadding > viewportWidth) {
        left = clientX - width - offset;
      }
      if (top + height + edgePadding > viewportHeight) {
        top = clientY - height - offset;
      }
    }

    if (top + height + edgePadding > viewportHeight) {
      top = viewportHeight - height - edgePadding;
    }
    if (top < edgePadding) top = edgePadding;

    left = Math.min(
      Math.max(edgePadding, left),
      Math.max(edgePadding, viewportWidth - width - edgePadding)
    );
    top = Math.min(
      Math.max(edgePadding, top),
      Math.max(edgePadding, viewportHeight - height - edgePadding)
    );

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
