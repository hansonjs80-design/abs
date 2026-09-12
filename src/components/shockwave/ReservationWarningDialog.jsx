import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ReservationWarningDialog.css';

export default function ReservationWarningDialog({ request, onAnswer }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="reservation-warning-dialog"
      aria-labelledby="reservation-warning-title"
      onCancel={(event) => { event.preventDefault(); onAnswer(false); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onAnswer(false); }
      }}
    >
      <h2 id="reservation-warning-title">{request.message}</h2>
      <p>그래도 예약하시겠습니까?</p>
      <div className="reservation-warning-actions">
        <button type="button" onClick={() => onAnswer(true)}>예</button>
        <button type="button" autoFocus onClick={() => onAnswer(false)}>아니오</button>
        <button type="button" disabled={!request.replacement} onClick={() => onAnswer(request.replacement)}>
          {request.replacement ? `${request.replacement} 처방으로 변경` : '일치하는 신장분사 처방 없음'}
        </button>
      </div>
    </dialog>,
    document.body
  );
}
