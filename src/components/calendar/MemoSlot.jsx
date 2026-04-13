import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { computeMemoFontColor } from '../../lib/memoParser';

export default function MemoSlot({ memo, dayInfo, slotIndex, onSave, coord, maxWeeks }) {
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [value, setValue] = useState(memo?.content || '');
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing && wrapperRef.current && document.activeElement !== wrapperRef.current) {
      // Focus restoration tracking handled by React
    }
  }, [editing]);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    inputRef.current.focus();
  }, [editing]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || editing || dayInfo.isOtherMonth) return;

    const handleCompositionStart = () => {
      setValue(memo?.content || '');
      setEditing(true);
    };

    el.addEventListener('compositionstart', handleCompositionStart);
    return () => el.removeEventListener('compositionstart', handleCompositionStart);
  }, [editing, dayInfo.isOtherMonth, memo?.content]);

  const handleDoubleClick = () => {
    if (dayInfo.isOtherMonth) return;
    setValue(memo?.content || '');
    setEditing(true);
  };

  const beginEditing = (nextValue) => {
    flushSync(() => {
      setValue(nextValue);
      setEditing(true);
    });
    inputRef.current?.focus();
  };

  const handleBlur = () => {
    setEditing(false);
    const newVal = value.trim();
    const oldVal = (memo?.content || '').trim();
    if (newVal !== oldVal) {
      onSave(dayInfo.year, dayInfo.month, dayInfo.day, slotIndex, newVal);
    }
  };

  const moveFocusByArrow = (key) => {
    const [wi, di, slot] = coord.split('-').map(Number);
    let nextWi = wi;
    let nextDi = di;
    let nextSlot = slot;

    if (key === 'ArrowUp') {
      if (slot > 0) nextSlot = slot - 1;
      else if (wi > 0) { nextWi = wi - 1; nextSlot = 5; }
    } else if (key === 'ArrowDown') {
      if (slot < 5) nextSlot = slot + 1;
      else if (wi < maxWeeks - 1) { nextWi = wi + 1; nextSlot = 0; }
    } else if (key === 'ArrowLeft') {
      if (di > 0) nextDi = di - 1;
      else if (wi > 0) { nextWi = wi - 1; nextDi = 6; }
    } else if (key === 'ArrowRight') {
      if (di < 6) nextDi = di + 1;
      else if (wi < maxWeeks - 1) { nextWi = wi + 1; nextDi = 0; }
    }

    const target = document.querySelector(`[data-coord="${nextWi}-${nextDi}-${nextSlot}"]`);
    if (target) target.focus();
  };

  const handleKeyDown = (e) => {
    if (editing) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (e.nativeEvent?.isComposing) return;
        e.preventDefault();
        const newVal = value.trim();
        const oldVal = (memo?.content || '').trim();
        setEditing(false);
        if (newVal !== oldVal) {
          onSave(dayInfo.year, dayInfo.month, dayInfo.day, slotIndex, newVal);
        }
        requestAnimationFrame(() => moveFocusByArrow(e.key));
        return;
      }

      if (e.key === 'Enter') {
        // 한글 조합 중(isComposing)일 때 Enter 키를 누르면 조합만 완료하고 셀 저장은 하지 않음
        if (e.nativeEvent.isComposing) return;
        e.target.blur();
      }
      if (e.key === 'Escape') { setValue(memo?.content || ''); setEditing(false); }
      return;
    }

    // Selected state (Not editing)
    if (dayInfo.isOtherMonth) return;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      moveFocusByArrow(e.key);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      setValue(memo?.content || '');
      setEditing(true);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (memo?.content) {
        onSave(dayInfo.year, dayInfo.month, dayInfo.day, slotIndex, '');
      }
    } else if (
      (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) ||
      e.key === 'Process' ||
      e.keyCode === 229
    ) {
      const isImeTrigger =
        /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(e.key) ||
        e.key === 'Process' ||
        e.keyCode === 229 ||
        e.nativeEvent.isComposing;

      if (isImeTrigger) {
        beginEditing(memo?.content || '');
      } else {
        e.preventDefault();
        beginEditing(e.key);
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) {
      e.preventDefault();
      navigator.clipboard.writeText(memo?.content || '');
      setFlash(true);
      setTimeout(() => setFlash(false), 150);
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'x' || e.code === 'KeyX')) {
      e.preventDefault();
      navigator.clipboard.writeText(memo?.content || '');
      setFlash(true);
      setTimeout(() => setFlash(false), 150);
      onSave(dayInfo.year, dayInfo.month, dayInfo.day, slotIndex, '');
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (text !== undefined && text !== null) {
          onSave(dayInfo.year, dayInfo.month, dayInfo.day, slotIndex, text);
          setFlash(true);
          setTimeout(() => setFlash(false), 150);
        }
      }).catch(err => {
        console.error('Clipboard read failed:', err);
      });
    }
  };


  const content = memo?.content || '';
  const fontColor = computeMemoFontColor(content);

  let colorClass = '';
  if (dayInfo.isOtherMonth) colorClass = 'memo-dim';
  else if (dayInfo.isSundayOrHoliday) colorClass = 'memo-special';
  else if (fontColor === '#3c78d8' || fontColor === '#3b82f6') colorClass = 'memo-night';
  else if (fontColor === '#9900ff' || fontColor === '#8b5cf6') colorClass = 'memo-off';
  else if (fontColor === '#40a417' || fontColor === '#22c55e') colorClass = 'memo-leave';
  else if (fontColor === '#ff6d01' || fontColor === '#f97316') colorClass = 'memo-attend';
  else if (fontColor === '#ff0000') colorClass = 'memo-special';

  if (memo?.is_strikethrough) colorClass += ' memo-strikethrough';

  if (editing) {
    return (
      <div className="memo-slot editing">
        <input
          ref={inputRef}
          className="memo-slot-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={`memo-slot ${colorClass}`}
      style={flash ? { backgroundColor: 'var(--brand-primary-light)', opacity: 0.8 } : undefined}
      data-coord={coord}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={dayInfo.isOtherMonth ? -1 : 0}
      title={content}
    >
      {content}
    </div>
  );
}
