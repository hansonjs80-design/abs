import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ReservationWarningDialog.css';
import InsuranceUsageBadge from './InsuranceUsageBadge';
import { getNextReservationActionIndex, getReservationWarningReplacement } from '../../lib/scheduleReservationWarningUtils';

export default function ReservationWarningDialog({ request, onAnswer }) {
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const replacementButtonRef = useRef(null);
  const [dropdownPrescription, setDropdownPrescription] = useState('');
  const selectedPrescription = dropdownPrescription || request.prescription || '';
  const replacement = getReservationWarningReplacement(request, dropdownPrescription);
  const isDefaultManualReplacement = !dropdownPrescription
    && (request.type === 'manual-week-limit' || request.type === 'manual-visit-limit');
  const groups = [
    { key: 'shockwave', label: '충격파' },
    { key: 'shinjangSpray', label: '신장분사' },
    { key: 'manualTherapy', label: '도수치료' },
  ];
  const message = request.message.replace(/\s*그래도 예약하시겠습니까\?$/, '');
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    const initialButton = replacementButtonRef.current?.disabled
      ? cancelButtonRef.current
      : replacementButtonRef.current;
    initialButton?.focus();
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="reservation-warning-dialog"
      aria-labelledby="reservation-warning-message"
      onCancel={(event) => { event.preventDefault(); onAnswer(false); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onAnswer(false); }
      }}
    >
      <div className="reservation-warning-body">
        <p id="reservation-warning-message" className="reservation-warning-message">{message}</p>
        <p>그래도 예약하시겠습니까?</p>
        {request.insuranceUsage && <p>실비 소진: <InsuranceUsageBadge usage={request.insuranceUsage} showLabel /></p>}
        <div className="reservation-warning-prescriptions">
          <div className="reservation-warning-selects">
            {groups.map(({ key, label }) => {
              const options = request.prescriptions?.[key] || [];
              return <label key={key} className={`reservation-warning-select reservation-warning-select--${key}`}>
                <span>{label}</span>
                <select aria-label={`${label} 처방 선택`} value={options.includes(selectedPrescription) ? selectedPrescription : ''}
                  onChange={(event) => { if (event.target.value) setDropdownPrescription(event.target.value); }}>
                  <option value="" disabled>처방 선택</option>
                  {options.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>;
            })}
          </div>
        </div>
      </div>
      <div className="reservation-warning-actions" role="group" aria-label="예약 확인 선택" onKeyDown={(event) => {
        const buttons = [...event.currentTarget.querySelectorAll('button')];
        const nextIndex = getNextReservationActionIndex(buttons.map((button) => button.disabled), buttons.indexOf(document.activeElement), event.key);
        if (nextIndex < 0) return;
        event.preventDefault();
        buttons[nextIndex].focus();
      }}>
        <button type="button" className="reservation-warning-yes" onClick={() => onAnswer(true)}>예</button>
        <button ref={cancelButtonRef} type="button" className="reservation-warning-no" onClick={() => onAnswer(false)}>아니오</button>
        <button ref={replacementButtonRef} type="button" className="reservation-warning-replace" disabled={!replacement} onClick={() => onAnswer(replacement)}>
          {replacement ? (isDefaultManualReplacement ? '신장분사 1로 변경' : `${replacement} 처방으로 변경`) : '일치하는 신장분사 처방 없음'}
        </button>
      </div>
    </dialog>,
    document.body
  );
}
