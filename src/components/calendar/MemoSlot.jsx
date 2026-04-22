import { computeMemoFontColor } from '../../lib/memoParser';

export default function MemoSlot({ 
  memo, dayInfo, slotIndex, 
  isSelected, isPrimary, isEditing,
  clipboardMode, holidayName,
  onMouseDown, onMouseEnter, onDoubleClick, onContextMenu,
  cellId,
  autoFontColor,
}) {
  const content = memo?.content || '';
  const fontColor = computeMemoFontColor(content);

  // DB에 저장된 커스텀 색상 우선, 없으면 자동 감지 색상 클래스 사용
  const customFontColor = memo?.font_color || autoFontColor;
  const customBgColor = memo?.bg_color;

  let colorClass = '';
  if (!customFontColor) {
    if (dayInfo.isOtherMonth) colorClass = 'memo-dim';
    else if (dayInfo.isSundayOrHoliday) colorClass = 'memo-special';
    else if (fontColor === '#3c78d8' || fontColor === '#3b82f6') colorClass = 'memo-night';
    else if (fontColor === '#9900ff' || fontColor === '#8b5cf6') colorClass = 'memo-off';
    else if (fontColor === '#40a417' || fontColor === '#22c55e') colorClass = 'memo-leave';
    else if (fontColor === '#ff6d01' || fontColor === '#f97316') colorClass = 'memo-attend';
    else if (fontColor === '#ff0000') colorClass = 'memo-special';
  }

  if (memo?.is_strikethrough) colorClass += ' memo-strikethrough';

  let antsClass = '';
  if (clipboardMode) antsClass = `ants-active ${clipboardMode === 'cut' ? 'ants-red' : 'ants-blue'}`;

  let stateClass = '';
  if (isSelected) stateClass += ' selected';
  if (isPrimary) stateClass += ' primary-selected';
  if (isEditing) stateClass += ' editing';

  const inlineStyle = {
    position: 'relative', overflow: 'hidden',
  };
  if (customFontColor) inlineStyle.color = customFontColor;
  if (customBgColor) inlineStyle.backgroundColor = customBgColor;

  return (
    <div
      className={`memo-slot ${colorClass} ${antsClass} ${stateClass}`}
      data-cell-id={cellId}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={content}
      style={inlineStyle}
    >
      <span style={{
        pointerEvents: 'none',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        width: '100%', textAlign: 'right',
        ...(holidayName && !content ? { color: '#e53e3e', fontWeight: 600 } : {}),
      }}>
        {content || holidayName || ''}
      </span>
    </div>
  );
}
