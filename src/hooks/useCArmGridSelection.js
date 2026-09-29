import { useEffect, useRef, useState } from 'react';
import { cArmCellSelected, cArmSelectionBounds } from '../lib/cArmSelection';

export default function useCArmGridSelection({ rowCount, columnCount, disabled, onClear, onUndo, onRedo }) {
  const rootRef = useRef(null);
  const selectionRef = useRef(null);
  const editingRef = useRef(null);
  const dragRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [editingCell, setEditingCell] = useState(null);

  const update = (next) => { selectionRef.current = next; setSelection(next); };
  const updateEditing = (next) => { editingRef.current = next; setEditingCell(next); };
  const bounds = cArmSelectionBounds(selection);

  const isEditing = (row, col) => editingRef.current?.row === row && editingRef.current?.col === col;

  const focus = (cell, editMode = false) => {
    const input = rootRef.current?.querySelector(`[data-c-arm-row="${cell.row}"][data-c-arm-col="${cell.col}"] input`);
    if (!input) return;
    input.focus({ preventScroll: true });
    if (editMode) {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    } else {
      input.select();
    }
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const startEdit = (row, col) => {
    update({ anchor: { row, col }, end: { row, col } });
    updateEditing({ row, col });
    focus({ row, col }, true);
  };

  useEffect(() => {
    const move = (event) => {
      if (dragRef.current !== event.pointerId) return;
      const cell = window.document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-c-arm-row]');
      if (!cell || !rootRef.current?.contains(cell)) return;
      const end = { row: Number(cell.dataset.cArmRow), col: Number(cell.dataset.cArmCol) };
      const current = selectionRef.current;
      if (!current || (current.end.row === end.row && current.end.col === end.col)) return;
      const next = { ...current, end };
      selectionRef.current = next;
      setSelection(next);
    };
    const stop = () => { dragRef.current = null; };
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        dragRef.current = null;
        selectionRef.current = null;
        setSelection(null);
        editingRef.current = null;
        setEditingCell(null);
      }
    };
    window.document.addEventListener('pointermove', move);
    window.document.addEventListener('pointerup', stop);
    window.document.addEventListener('pointercancel', stop);
    window.document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', stop);
    return () => {
      window.document.removeEventListener('pointermove', move);
      window.document.removeEventListener('pointerup', stop);
      window.document.removeEventListener('pointercancel', stop);
      window.document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', stop);
    };
  }, []);

  useEffect(() => {
    const current = selectionRef.current;
    if (current && (current.anchor.col >= columnCount || current.end.col >= columnCount)) {
      selectionRef.current = null;
      setSelection(null);
      editingRef.current = null;
      setEditingCell(null);
    }
  }, [columnCount]);

  const getCellProps = (row, col) => {
    const selected = cArmCellSelected(bounds, row, col);
    const active = selection?.anchor.row === row && selection?.anchor.col === col;
    const editing = isEditing(row, col);
    return {
      'data-c-arm-row': row,
      'data-c-arm-col': col,
      'data-selected': selected ? 'true' : undefined,
      'data-editing': editing ? 'true' : undefined,
      className: [
        selected && 'c-arm-cell-selected',
        active && 'c-arm-cell-active',
        editing && 'c-arm-cell-editing',
        selected && row === bounds.top && 'c-arm-range-top',
        selected && row === bounds.bottom && 'c-arm-range-bottom',
        selected && col === bounds.left && 'c-arm-range-left',
        selected && col === bounds.right && 'c-arm-range-right',
      ].filter(Boolean).join(' '),
      onPointerDown: (event) => {
        if (disabled || event.button !== 0) return;
        if (isEditing(row, col)) return;
        if (event.detail >= 2) {
          event.preventDefault();
          startEdit(row, col);
          return;
        }
        event.preventDefault();
        updateEditing(null);
        const cell = { row, col };
        const anchor = event.shiftKey && selectionRef.current ? selectionRef.current.anchor : cell;
        update({ anchor, end: cell });
        dragRef.current = event.pointerId;
        focus(anchor, false);
      },
      onDoubleClick: (event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        startEdit(row, col);
      },
    };
  };

  const onFocus = (row, col) => {
    if (!cArmCellSelected(cArmSelectionBounds(selectionRef.current), row, col)) {
      update({ anchor: { row, col }, end: { row, col } });
    }
  };

  const onBlur = (row, col) => {
    if (isEditing(row, col)) {
      updateEditing(null);
    }
  };

  const onKeyDown = (event) => {
    if (disabled || event.isComposing) return;
    const current = selectionRef.current;
    const editing = current ? isEditing(current.anchor.row, current.anchor.col) : false;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo(); return; }
    if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); onRedo(); return; }
    if (command && event.key.toLowerCase() === 'a' && !editing) {
      event.preventDefault();
      update({ anchor: { row: 1, col: 0 }, end: { row: rowCount, col: columnCount - 1 } });
      return;
    }
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (editing) {
        updateEditing(null);
        focus(current.anchor, false);
      } else {
        update(null);
        event.currentTarget.blur();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (editing) return;
      event.preventDefault();
      onClear(cArmSelectionBounds(current));
      return;
    }
    if (editing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      return;
    }
    let target = { ...(event.shiftKey ? current.end : current.anchor) };
    const movements = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (movements[event.key]) {
      target.row += movements[event.key][0];
      target.col += movements[event.key][1];
    } else if (event.key === 'Enter') {
      target.row += event.shiftKey ? -1 : 1;
    } else if (event.key === 'Tab') {
      target.col += event.shiftKey ? -1 : 1;
      if (target.col >= columnCount) { target.col = 0; target.row += 1; }
      if (target.col < 0) { target.col = columnCount - 1; target.row -= 1; }
      if (target.row < 1 || target.row > rowCount) return;
    } else {
      if (!editing && event.key.length === 1 && !command) {
        updateEditing({ row: current.anchor.row, col: current.anchor.col });
      }
      return;
    }
    event.preventDefault();
    updateEditing(null);
    target = { row: Math.max(1, Math.min(rowCount, target.row)), col: Math.max(0, Math.min(columnCount - 1, target.col)) };
    const extend = event.shiftKey && Boolean(movements[event.key]);
    update({ anchor: extend ? current.anchor : target, end: target });
    if (!extend) focus(target, false);
  };

  return { rootRef, bounds, getCellProps, onFocus, onBlur, onKeyDown, isEditing, startEdit, selectRange: update };
}
