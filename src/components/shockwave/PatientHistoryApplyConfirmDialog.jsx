export default function PatientHistoryApplyConfirmDialog({
  open,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="patient-history-apply-confirm-title"
      data-preserve-schedule-selection="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.28)',
        zIndex: 1000001,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        style={{
          width: 'min(420px, calc(100vw - 40px))',
          background: 'var(--bg-primary, #fff)',
          borderRadius: '12px',
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.22)',
          border: '1px solid var(--border-color, #d7dde5)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '18px 20px 10px' }}>
          <h4
            id="patient-history-apply-confirm-title"
            style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary, #111827)' }}
          >
            내역 적용 확인
          </h4>
          <p style={{ margin: '10px 0 0', fontSize: '0.95rem', lineHeight: 1.5, color: 'var(--text-secondary, #4b5563)' }}>
            선택한 셀에 해당 내용을 적용하시겠습니까?
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            padding: '14px 20px 18px',
            background: 'var(--bg-secondary, #f8fafc)',
            borderTop: '1px solid var(--border-color, #e5e7eb)',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              border: '1px solid var(--border-color, #d1d5db)',
              background: 'var(--bg-primary, #fff)',
              color: 'var(--text-primary, #111827)',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '0.9rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            아니요
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              border: '1px solid var(--brand-primary, #4f46e5)',
              background: 'var(--brand-primary, #4f46e5)',
              color: '#fff',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '0.9rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            예
          </button>
        </div>
      </div>
    </div>
  );
}
