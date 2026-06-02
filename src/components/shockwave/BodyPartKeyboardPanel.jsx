import { useEffect, useRef, useState } from 'react';
import { normalizeBodyPartKey } from '../../lib/schedulerUtils';

export default function BodyPartKeyboardPanel({
  availableParts,
  currentParts,
  onAdd,
  onDelete,
  onToggle,
  imeOpenRef,
  autoFocus = false,
}) {
  const [inputValue, setInputValue] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!autoFocus) return undefined;
    let cancelled = false;
    const focusInput = () => {
      if (cancelled || !inputRef.current) return;
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.select();
      setFocusIndex(0);
    };

    focusInput();
    let nestedFrameId = null;
    const frameId = requestAnimationFrame(() => {
      focusInput();
      nestedFrameId = requestAnimationFrame(focusInput);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      if (nestedFrameId !== null) {
        cancelAnimationFrame(nestedFrameId);
      }
    };
  }, [autoFocus]);

  const focusTarget = (nextIndex) => {
    const maxIndex = availableParts.length;
    const boundedIndex = Math.max(0, Math.min(maxIndex, nextIndex));
    setFocusIndex(boundedIndex);
    if (boundedIndex === 0) {
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    itemRefs.current[boundedIndex - 1]?.focus({ preventScroll: true });
  };

  const submitInput = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInputValue('');
    focusTarget(0);
  };

  const handleInputKeyDown = (event) => {
    event.stopPropagation();
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      submitInput();
      return;
    }
    if (event.key === 'ArrowDown' && availableParts.length > 0) {
      event.preventDefault();
      focusTarget(1);
      return;
    }
    if (event.key === 'ArrowUp' && availableParts.length > 0) {
      event.preventDefault();
      focusTarget(availableParts.length);
    }
  };

  const handleItemKeyDown = (event, part, index) => {
    event.stopPropagation();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusTarget(index === availableParts.length - 1 ? 0 : index + 2);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusTarget(index);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      onDelete(part);
      focusTarget(Math.min(index + 1, Math.max(0, availableParts.length - 1)));
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
      event.preventDefault();
      onToggle(part);
    }
  };

  return (
    <div
      className="context-menu-body-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {availableParts.length > 0 ? (
        <div className="context-menu-checklist">
          {availableParts.map((part, index) => {
            const partKey = normalizeBodyPartKey(part);
            const isChecked = currentParts.some((item) => normalizeBodyPartKey(item) === partKey);
            return (
              <div
                key={`${partKey}-${index}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={`context-menu-check-item${isChecked ? ' is-checked' : ''}${focusIndex === index + 1 ? ' is-keyboard-focused' : ''}`}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onFocus={() => setFocusIndex(index + 1)}
                onKeyDown={(event) => handleItemKeyDown(event, part, index)}
              >
                <label className="context-menu-check-label">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(event) => {
                      event.stopPropagation();
                      onToggle(part);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    tabIndex={-1}
                  />
                  <span>{part}</span>
                </label>
                <button
                  type="button"
                  className="context-menu-body-delete"
                  title={`${part} 삭제`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(part);
                  }}
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      ) : currentParts.length === 0 ? (
        <div className="context-menu-empty">등록된 부위가 없습니다.</div>
      ) : null}

      <div className="context-menu-input-row" style={{ marginTop: '8px' }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="새 부위 추가"
          className="context-menu-input"
          autoComplete="off"
          autoFocus={autoFocus}
          value={inputValue}
          onFocus={() => setFocusIndex(0)}
          onChange={(event) => {
            event.stopPropagation();
            setInputValue(event.target.value);
          }}
          onKeyDown={handleInputKeyDown}
          onCompositionStart={() => {
            if (imeOpenRef) imeOpenRef.current = true;
          }}
          onCompositionEnd={() => {
            if (imeOpenRef) imeOpenRef.current = false;
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
        <button
          type="button"
          className="context-menu-inline-button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            submitInput();
          }}
        >
          추가
        </button>
      </div>
    </div>
  );
}
