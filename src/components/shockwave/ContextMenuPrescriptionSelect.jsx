import { useEffect, useId, useRef, useState } from 'react';

import { formatScheduleShortcutLabel } from '../../lib/scheduleKeyboardUtils';

export default function ContextMenuPrescriptionSelect({
  ariaLabel,
  value,
  options = [],
  shortcuts = {},
  shortcutModifier,
  align = 'start',
  onChange,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [opensUpward, setOpensUpward] = useState(false);
  const rootRef = useRef(null);
  const listboxId = useId();
  const selectedLabel = options.includes(value) ? value : '처방 없음';

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeWhenOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeWhenOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeWhenOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    if (!isOpen && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const estimatedListHeight = (options.length + 1) * 33 + 8;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      setOpensUpward(spaceBelow < estimatedListHeight && rect.top > spaceBelow);
    }
    setIsOpen((open) => !open);
  };

  const selectPrescription = (prescription) => {
    setIsOpen(false);
    onChange(prescription);
  };

  return (
    <div
      ref={rootRef}
      className={`context-menu-prescription-dropdown context-menu-prescription-dropdown--${align}`}
    >
      <button
        type="button"
        className="context-menu-prescription-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={toggleDropdown}
      >
        <span className="context-menu-prescription-trigger-text">{selectedLabel}</span>
        <span className="context-menu-prescription-trigger-arrow" aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          id={listboxId}
          className={`context-menu-prescription-dropdown-list${opensUpward ? ' opens-upward' : ''}`}
          role="listbox"
          aria-label={`${ariaLabel} 목록`}
        >
          <button
            type="button"
            className={`context-menu-prescription-dropdown-option${value ? '' : ' is-selected'}`}
            role="option"
            aria-selected={!value}
            onClick={() => selectPrescription('')}
          >
            <span className="context-menu-prescription-option-name">처방 없음</span>
          </button>
          {options.map((prescription) => {
            const shortcutLabel = formatScheduleShortcutLabel(
              shortcuts[prescription],
              shortcutModifier
            );
            const isSelected = value === prescription;
            return (
              <button
                type="button"
                key={prescription}
                className={`context-menu-prescription-dropdown-option${isSelected ? ' is-selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => selectPrescription(prescription)}
              >
                <span className="context-menu-prescription-option-name">{prescription}</span>
                {shortcutLabel && (
                  <span className="context-menu-prescription-option-shortcut">{shortcutLabel}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
