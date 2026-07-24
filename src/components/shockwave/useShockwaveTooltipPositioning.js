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
    let top = contextMenu ? clientY - height - offset : clientY + offset;

    if (left + width + edgePadding > viewportWidth) {
      left = clientX - width - offset;
    }
    if (top + height + edgePadding > viewportHeight) {
      top = clientY - height - offset;
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
