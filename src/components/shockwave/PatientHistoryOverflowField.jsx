import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getPatientHistoryOverflowTooltipPosition,
  isPatientHistoryFieldOverflowing,
} from '../../lib/patientHistoryOverflowTooltipUtils';

function captureRect(rect) {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export default function PatientHistoryOverflowField({ value, children }) {
  const wrapperRef = useRef(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const text = String(value || '').trim();

  const hideTooltip = useCallback(() => {
    setAnchorRect(null);
  }, []);

  const showTooltipIfNeeded = useCallback(() => {
    const field = wrapperRef.current?.querySelector('input, textarea');
    if (!field || !text || !isPatientHistoryFieldOverflowing(field)) {
      hideTooltip();
      return;
    }

    setAnchorRect(captureRect(field.getBoundingClientRect()));
  }, [hideTooltip, text]);

  useEffect(() => {
    if (!anchorRect) return undefined;

    window.addEventListener('resize', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
    return () => {
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('scroll', hideTooltip, true);
    };
  }, [anchorRect, hideTooltip]);

  const positionTooltip = useCallback((node) => {
    if (!node || !anchorRect) return;

    const position = getPatientHistoryOverflowTooltipPosition({
      anchorRect,
      tooltipRect: node.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    node.style.left = `${position.left}px`;
    node.style.top = `${position.top}px`;
    node.style.visibility = 'visible';
  }, [anchorRect]);

  return (
    <div
      ref={wrapperRef}
      className="patient-history-overflow-field"
      title=""
      onMouseEnter={showTooltipIfNeeded}
      onMouseLeave={hideTooltip}
      onFocusCapture={hideTooltip}
    >
      {children}
      {anchorRect && typeof document !== 'undefined' && createPortal(
        <div
          ref={positionTooltip}
          className="patient-history-overflow-tooltip"
          role="tooltip"
        >
          {text}
        </div>,
        document.body,
      )}
    </div>
  );
}
