import { useEffect, useState } from 'react';

export function ContextMenuLocalInput({
  value,
  onChange,
  onKeyDown,
  onBlur,
  className,
  placeholder,
  autoFocus,
  onCompositionStart,
  onCompositionEnd,
  inputMode,
  pattern,
}) {
  const [localValue, setLocalValue] = useState(value || '');

  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  return (
    <input
      type="text"
      className={className}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete="off"
      inputMode={inputMode}
      pattern={pattern}
      value={localValue}
      onChange={(event) => {
        event.stopPropagation();
        setLocalValue(event.target.value);
        onChange?.(event.target.value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event, localValue);
      }}
      onBlur={(event) => {
        onBlur?.(event, localValue);
      }}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
