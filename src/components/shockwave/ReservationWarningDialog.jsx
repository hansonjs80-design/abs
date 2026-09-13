import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import './ReservationWarningDialog.css';

export default function ReservationWarningDialog({ request, onAnswer }) {
  const dialogRef = useRef(null);
  const [selectedPrescription, setSelectedPrescription] = useState(request.prescription || '');
  const groups = [
    { key: 'shockwave', label: '충격파' },
    { key: 'shinjangSpray', label: '신장분사' },
    { key: 'manualTherapy', label: '도수치료' },
  ];
  const message = request.message.replace(/\s*그래도 예약하시겠습니까\?$/, '');
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
      aria-describedby="reservation-warning-message"
      onCancel={(event) => { event.preventDefault(); onAnswer(false); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onAnswer(false); }
      }}
    >
      <header className="reservation-warning-header">
        <span className="reservation-warning-icon"><AlertTriangle size={24} /></span>
        <div><h2 id="reservation-warning-title">예약 확인</h2><span>예약 조건을 확인해 주세요</span></div>
        <button type="button" className="reservation-warning-close" aria-label="닫기" onClick={() => onAnswer(false)}><X size={20} /></button>
      </header>
      <div className="reservation-warning-body">
        <p id="reservation-warning-message" className="reservation-warning-message">{message}</p>
        <p>그래도 예약하시겠습니까?</p>
        <div className="reservation-warning-prescriptions">
          <div className="reservation-warning-section-title">처방 선택</div>
          <div className="reservation-warning-selects">
            {groups.map(({ key, label }) => {
              const options = request.prescriptions?.[key] || [];
              return <label key={key} className={`reservation-warning-select reservation-warning-select--${key}`}>
                <span>{label}</span>
                <select aria-label={`${label} 처방 선택`} value={options.includes(selectedPrescription) ? selectedPrescription : ''}
                  onChange={(event) => { if (event.target.value) setSelectedPrescription(event.target.value); }}>
                  <option value="" disabled>처방 선택</option>
                  {options.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>;
            })}
          </div>
          <p className="reservation-warning-selection">선택한 처방: <strong>{selectedPrescription || '없음'}</strong></p>
        </div>
      </div>
      <div className="reservation-warning-actions">
        <button type="button" className="reservation-warning-yes" onClick={() => onAnswer(selectedPrescription && selectedPrescription !== request.prescription ? selectedPrescription : true)}>예</button>
        <button type="button" className="reservation-warning-no" autoFocus onClick={() => onAnswer(false)}>아니오</button>
        {request.type === 'shockwave-interval' && <button type="button" className="reservation-warning-replace" disabled={!request.replacement} onClick={() => onAnswer(request.replacement)}>
          {request.replacement ? `${request.replacement} 처방으로 변경` : '일치하는 신장분사 처방 없음'}
        </button>}
      </div>
    </dialog>,
    document.body
  );
}
