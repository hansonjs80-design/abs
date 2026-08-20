const ALL_FILTER_KEY = '__all__';

function PatientHistoryFilterSection({
  activeFilters,
  ariaLabel,
  label,
  onToggle,
  options,
  tone,
}) {
  return (
    <div
      className={`patient-history-filter-section patient-history-filter-section--${tone}`}
      role="group"
      aria-label={`${ariaLabel} 필터`}
    >
      <span className="patient-history-filter-title">{label}</span>
      <div className="patient-history-filter-options">
        {options.map((option) => {
          const isChecked = option.key === ALL_FILTER_KEY
            ? activeFilters.length === 0
            : activeFilters.includes(option.key);
          const isDisabled = option.count === 0 && !isChecked;
          return (
            <label
              key={option.key}
              className={`patient-history-filter-option${isChecked ? ' is-checked' : ''}${isDisabled ? ' is-disabled' : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={isDisabled}
                onChange={() => onToggle(option.key)}
              />
              <span>{option.label}</span>
              <span className="patient-history-filter-count">{option.count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function PatientHistoryFilters({
  group,
  onBodyFilterToggle,
  onPrescriptionFilterToggle,
}) {
  return (
    <div className="patient-history-filter-sections">
      <PatientHistoryFilterSection
        activeFilters={group.activeBodyFilters}
        ariaLabel={`${group.label} 부위`}
        label="부위"
        onToggle={onBodyFilterToggle}
        options={group.bodyFilterOptions}
        tone="body"
      />
      <PatientHistoryFilterSection
        activeFilters={group.activePrescriptionFilters}
        ariaLabel={`${group.label} 처방`}
        label="처방"
        onToggle={onPrescriptionFilterToggle}
        options={group.prescriptionFilterOptions}
        tone="prescription"
      />
    </div>
  );
}
