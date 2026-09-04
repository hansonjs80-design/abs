import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { normalizeBodyPartKey } from '../../lib/schedulerUtils';
import {
  BODY_PART_PRESET_DIRECTIONS,
  BODY_PART_PRESET_GROUPS,
  getBodyPartPresetState,
} from '../../lib/bodyPartPresetUtils';

export default function BodyPartKeyboardPanel({
  availableParts = [],
  currentParts = [],
  onAdd,
  onDelete,
  onEdit,
  onMove,
  onRemove,
  onToggle,
  onSetPreset,
  imeOpenRef,
  autoFocus = false,
}) {
  const [inputValue, setInputValue] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedDrafts, setSelectedDrafts] = useState([]);
  const [editingSelectedIndex, setEditingSelectedIndex] = useState(null);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const selectedInputRefs = useRef([]);
  const selectedParts = currentParts.map((part) => String(part || '').trim()).filter(Boolean);
  const selectedPartSignature = selectedParts.join('\u001f');
  const selectedKeySet = new Set(selectedParts.map((part) => normalizeBodyPartKey(part)));
  const selectableParts = availableParts.filter((part) => !selectedKeySet.has(normalizeBodyPartKey(part)));

  const togglePresetDirection = (item, directionId) => {
    const { directions } = getBodyPartPresetState(selectedParts, item);
    const nextDirections = directions.includes(directionId)
      ? directions.filter((id) => id !== directionId)
      : [...directions, directionId];
    onSetPreset?.(item.id, true, nextDirections);
  };

  const togglePresetSelection = (item) => {
    const { isSelected } = getBodyPartPresetState(selectedParts, item);
    onSetPreset?.(item.id, !isSelected, []);
  };

  useEffect(() => {
    setSelectedDrafts(selectedPartSignature ? selectedPartSignature.split('\u001f') : []);
    setEditingSelectedIndex(null);
  }, [selectedPartSignature]);

  useEffect(() => {
    if (editingSelectedIndex === null) return undefined;
    const frameId = requestAnimationFrame(() => {
      selectedInputRefs.current[editingSelectedIndex]?.focus({ preventScroll: true });
      selectedInputRefs.current[editingSelectedIndex]?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [editingSelectedIndex]);

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
    const maxIndex = selectableParts.length;
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
    if (event.key === 'ArrowDown' && selectableParts.length > 0) {
      event.preventDefault();
      focusTarget(1);
      return;
    }
    if (event.key === 'ArrowUp' && selectableParts.length > 0) {
      event.preventDefault();
      focusTarget(selectableParts.length);
    }
  };

  const handleItemKeyDown = (event, part, index) => {
    event.stopPropagation();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusTarget(index === selectableParts.length - 1 ? 0 : index + 2);
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
      focusTarget(Math.min(index + 1, Math.max(0, selectableParts.length - 1)));
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
      event.preventDefault();
      onToggle(part);
    }
  };

  const commitSelectedDraft = (index, value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      onRemove?.(index);
      return;
    }
    if (trimmed !== selectedParts[index]) {
      const nextParts = selectedParts.map((part, partIndex) => (
        partIndex === index ? trimmed : (selectedDrafts[partIndex] ?? part)
      ));
      onEdit?.(index, trimmed, nextParts);
    }
  };

  return (
    <div
      className="context-menu-body-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="context-menu-body-presets" aria-label="진단별 부위 빠른 입력">
        {BODY_PART_PRESET_GROUPS.map((group) => (
          <section key={group.id} className="context-menu-body-preset-group">
            <h4 className="context-menu-body-preset-title">{group.label}</h4>
            <div className="context-menu-body-preset-list">
              {group.items.map((item) => {
                const { isSelected, directions } = getBodyPartPresetState(selectedParts, item);
                return (
                  <div key={item.id} className="context-menu-body-preset-item">
                    <label className="context-menu-body-preset-label">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        aria-label={`${item.label} 선택`}
                        onChange={(event) => {
                          event.stopPropagation();
                          togglePresetSelection(item);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <span>{item.label} <small>({item.code})</small></span>
                    </label>
                    {isSelected ? (
                      <span className="context-menu-body-preset-directions" aria-label={`${item.label} 좌우 선택`}>
                      {BODY_PART_PRESET_DIRECTIONS.map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          className={`context-menu-body-preset-direction${directions.includes(id) ? ' is-active' : ''}`}
                          aria-pressed={directions.includes(id)}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            togglePresetDirection(item, id);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* 하단 선택 및 입력 섹션: 상단 처방목록과 구분을 위한 배경/구분선 컨테이너 */}
      <div className="context-menu-body-bottom-section">
        {selectedParts.length > 0 ? (
          <div className="context-menu-body-selected-list">
            {selectedParts.map((part, index) => {
              const draftValue = selectedDrafts[index] ?? part;
              const canReorderParts = selectedParts.length > 1;
              return (
                <div key={`${normalizeBodyPartKey(part)}-${index}`} className="context-menu-body-selected-item">
                  <input
                    type="checkbox"
                    className="context-menu-body-selected-checkbox"
                    checked
                    aria-label={`${part} 선택 해제`}
                    onChange={(event) => {
                      event.stopPropagation();
                      onToggle(part);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  />
                  {editingSelectedIndex === index ? (
                    <input
                      ref={(node) => {
                        selectedInputRefs.current[index] = node;
                      }}
                      type="text"
                      className="context-menu-input context-menu-input--body-part"
                      value={draftValue}
                      aria-label={`부위 ${index + 1} 수정`}
                      title="부위 수정"
                      onChange={(event) => {
                        event.stopPropagation();
                        const value = event.target.value;
                        setSelectedDrafts((prev) => prev.map((item, itemIndex) => itemIndex === index ? value : item));
                      }}
                      onBlur={(event) => {
                        event.stopPropagation();
                        commitSelectedDraft(index, event.target.value);
                        setEditingSelectedIndex(null);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitSelectedDraft(index, event.currentTarget.value);
                          setEditingSelectedIndex(null);
                          event.currentTarget.blur();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setSelectedDrafts((prev) => prev.map((item, itemIndex) => itemIndex === index ? part : item));
                          setEditingSelectedIndex(null);
                        }
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <span className="context-menu-list-text" title={part}>{part}</span>
                  )}
                  <div className="context-menu-body-selected-actions">
                    {editingSelectedIndex === index ? null : (
                      <button
                        type="button"
                        className="context-menu-note-icon-button"
                        aria-label="부위 수정"
                        title="수정"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedDrafts((prev) => prev.map((item, itemIndex) => itemIndex === index ? part : item));
                          setEditingSelectedIndex(index);
                        }}
                      >
                        <Pencil size={13} strokeWidth={2.4} />
                      </button>
                    )}
                    {canReorderParts ? (
                      <div className="context-menu-note-reorder-stack">
                        <button
                          type="button"
                          className="context-menu-note-icon-button context-menu-note-order-button"
                          aria-label="부위 위로 이동"
                          title="위로 이동"
                          disabled={index === 0}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onMove?.(index, 'up');
                          }}
                        >
                          <ArrowUp size={11} strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          className="context-menu-note-icon-button context-menu-note-order-button"
                          aria-label="부위 아래로 이동"
                          title="아래로 이동"
                          disabled={index === selectedParts.length - 1}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onMove?.(index, 'down');
                          }}
                        >
                          <ArrowDown size={11} strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="context-menu-note-icon-button context-menu-note-remove"
                      aria-label="부위 삭제"
                      title="삭제"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onDelete?.(part);
                      }}
                    >
                      <Trash2 size={14} strokeWidth={2.3} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {selectableParts.length > 0 ? (
          <div className="context-menu-checklist">
            {selectableParts.map((part, index) => {
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

        <div className="context-menu-input-row" style={{ marginTop: '5px' }}>
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
    </div>
  );
}
