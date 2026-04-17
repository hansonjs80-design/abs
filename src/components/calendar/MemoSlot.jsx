import { useRef } from 'react';
import { computeMemoFontColor } from '../../lib/memoParser';

export default function MemoSlot({ 
  memo, dayInfo, slotIndex, 
  isSelected, isPrimary, isEditing, editValue, editSessionId,
  clipboardMode,
  onMouseDown, onMouseEnter, onDoubleClick, onContextMenu,
  editInputRef, onEditBlur, onEditKeyDown
}) {
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

  let antsClass = '';
  if (clipboardMode) antsClass = `ants-active ${clipboardMode === 'cut' ? 'ants-red' : 'ants-blue'}`;

  let stateClass = '';
  if (isSelected) stateClass += ' selected';
  if (isPrimary) stateClass += ' primary-selected';
  if (isEditing) stateClass += ' editing';

  return (
    <div
      className={`memo-slot ${colorClass} ${antsClass} ${stateClass}`}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={content}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {isEditing ? (
        <input
          key={editSessionId || 'edit'}
          ref={editInputRef}
          className="memo-slot-input"
          defaultValue={editValue}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            zIndex: 2, boxSizing: 'border-box',
          }}
          onBlur={onEditBlur}
          onKeyDown={onEditKeyDown}
          autoFocus
        />
      ) : (
        <span style={{
          pointerEvents: 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          width: '100%', textAlign: 'right',
        }}>
          {content}
        </span>
      )}
    </div>
  );
}
