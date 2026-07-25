export default function ShockwaveDataGridCountTooltip({ tooltip }) {
  if (!tooltip) return null;

  return (
    <div
      className={[
        'sw-grid-count-tooltip',
        'sw-grid-count-tooltip--fixed',
        `sw-grid-count-tooltip--${tooltip.placement}`,
        tooltip.layout === 'list' ? 'sw-grid-count-tooltip--list' : '',
        tooltip.layout === 'prescription-patients'
          ? 'sw-grid-count-tooltip--prescription-patients'
          : '',
        tooltip.layout === 'therapist-patients'
          ? 'sw-grid-count-tooltip--therapist-patients'
          : '',
      ].filter(Boolean).join(' ')}
      role="tooltip"
      style={{
        left: `${tooltip.x}px`,
        top: `${tooltip.y}px`,
        width: `${tooltip.width}px`,
        backgroundColor: tooltip.backgroundColor || tooltip.therapistColor,
        '--tooltip-accent-color': tooltip.tooltipAccentColor,
      }}
    >
      <div className="sw-grid-count-tooltip-header">
        <div className="sw-grid-count-tooltip-date">{tooltip.date}</div>
        <div className="sw-grid-count-tooltip-name">
          {tooltip.summaryLabel || `${tooltip.therapistName} ${tooltip.totalCount}건`}
        </div>
      </div>
      <div className="sw-grid-count-tooltip-line">
        {tooltip.items.map(({
          label,
          count,
          patientNames = [],
          patientItems = [],
          prescriptionColor,
          therapistColor,
          therapistAccentColor,
        }) => {
          const patients = patientItems.length > 0
            ? patientItems
            : patientNames.map((name) => ({ name }));

          return (
            <span
              className={[
                'sw-grid-count-tooltip-item',
                'sw-grid-count-tooltip-item--counted',
                patients.length > 0 ? 'sw-grid-count-tooltip-item--with-patients' : '',
                prescriptionColor
                  ? 'sw-grid-count-tooltip-item--prescription-color'
                  : '',
              ].filter(Boolean).join(' ')}
              key={label}
              style={
                therapistColor
                  ? {
                    '--therapist-cell-color': therapistColor,
                    '--therapist-cell-accent-color': therapistAccentColor,
                    '--tooltip-accent-color': therapistAccentColor,
                  }
                  : prescriptionColor
                    ? { '--prescription-cell-color': prescriptionColor }
                    : undefined
              }
            >
              <span className="sw-grid-count-tooltip-item-summary">
                <span className="sw-grid-count-tooltip-prescription">{label}</span>
                <span className="sw-grid-count-tooltip-count">{count}{tooltip.unit || '건'}</span>
              </span>
              {patients.length > 0 && (
                <span className="sw-grid-count-tooltip-patients">
                  {patients.map((patient, patientIndex) => (
                    <span
                      className="sw-grid-count-tooltip-patient"
                      key={`${patient.name}-${patient.therapistName || ''}-${patientIndex}`}
                      style={patient.indicatorColor
                        ? { '--patient-indicator-color': patient.indicatorColor }
                        : undefined}
                      title={patient.therapistName
                        ? `담당 치료사: ${patient.therapistName}`
                        : undefined}
                    >
                      {patient.name}
                    </span>
                  ))}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
