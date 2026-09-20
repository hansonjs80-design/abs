import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ReservationWarningDialog.css';
import InsuranceUsageBadge from './InsuranceUsageBadge';

export default function ReservationWarningDialog({ request, onAnswer }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event) => {
      const isCloseEnter = event.key === 'Enter' && event.target === closeButtonRef.current;
      if (event.key !== 'Escape' && !isCloseEnter) return;
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onAnswer();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [onAnswer]);

  return createPortal(
    <section className="reservation-warning-dialog" role="alert" aria-label="예약 알림">
      <div className="reservation-warning-body">
        {(request.warnings || [request]).map((warning, index) => <div key={index}>
          <p className="reservation-warning-message">{warning.message.replace(/\s*그래도 예약하시겠습니까\?$/, '')}</p>
          {warning.insuranceUsage && <p>실비소진: <InsuranceUsageBadge usage={warning.insuranceUsage} showLabel /></p>}
        </div>)}
      </div>
      <div className="reservation-warning-actions">
        <button ref={closeButtonRef} type="button" onClick={() => onAnswer()}>닫기 <small>Enter / Esc</small></button>
      </div>
    </section>, document.body
  );
}
