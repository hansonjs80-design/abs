import { useEffect, useRef, useState } from 'react';

export function ContextMenuLocalInputGroup({
  placeholder,
  buttonLabel,
  onSubmit,
  imeOpenRef,
  className = 'context-menu-input',
  autoFocus,
  focusSignal = 0,
  onInputKeyDown,
}) {
  const [localValue, setLocalValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!autoFocus && !focusSignal) return undefined;
    let cancelled = false;
    const focusInput = () => {
      if (cancelled || !inputRef.current) return;
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.select();
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
      if (nestedFrameId !== null) cancelAnimationFrame(nestedFrameId);
    };
  }, [autoFocus, focusSignal, placeholder]);

  const handleSubmit = () => {
    const trimmed = localValue.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setLocalValue('');
  };

  return (
    <div className="context-menu-input-row" style={{ marginTop: '8px' }}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        autoFocus={autoFocus}
        value={localValue}
        onChange={(event) => {
          event.stopPropagation();
          setLocalValue(event.target.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            handleSubmit();
            return;
          }
          onInputKeyDown?.(event);
        }}
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
          handleSubmit();
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
