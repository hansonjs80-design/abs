import { useEffect, useRef } from 'react';
import { isPatientHistoryShortcut } from '../../lib/scheduleKeyboardUtils';

export default function useScheduleGlobalEvents({
  viewRef,
  contextMenuRef,
  dragSelectionRef,
  selectedCell,
  selectedCellRef,
  selectedKeys,
  editingCell,
  handleKeyDown,
  handlePasteSelection,
  handleOpenPatientHistoryModal,
  isEditableTarget,
  isContextMenuTarget,
  setActiveContextSubmenu,
  setContextMenu,
}) {
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [viewRef, handleKeyDown]);

  const openModalRef = useRef(handleOpenPatientHistoryModal);
  useEffect(() => {
    openModalRef.current = handleOpenPatientHistoryModal;
  }, [handleOpenPatientHistoryModal]);

  useEffect(() => {
    const handleGlobalCmdF = (e) => {
      if (isPatientHistoryShortcut(e) && selectedCellRef.current) {
        e.preventDefault();
        e.stopPropagation();
        openModalRef.current();
      }
    };

    window.addEventListener('keydown', handleGlobalCmdF, { capture: true });
    return () => window.removeEventListener('keydown', handleGlobalCmdF, { capture: true });
  }, [selectedCellRef]);

  useEffect(() => {
    const handlePasteEvent = (event) => {
      if (!selectedCell) return;

      const target = event.target;
      if (isContextMenuTarget(target)) return;
      const isEditablePasteTarget =
        (target instanceof HTMLInputElement && !target.dataset.hiddenInput) ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isEditablePasteTarget) return;

      const pastedText = event.clipboardData?.getData('text/plain');
      const pastedHtml = event.clipboardData?.getData('text/html');
      if (!pastedText) return;
      event.preventDefault();
      handlePasteSelection(pastedText, pastedHtml);
    };

    window.addEventListener('paste', handlePasteEvent, true);
    return () => window.removeEventListener('paste', handlePasteEvent, true);
  }, [selectedCell, handlePasteSelection, isContextMenuTarget]);

  useEffect(() => {
    const handleWindowKeyDown = (event) => {
      const target = event.target;
      if (isContextMenuTarget(target)) return;
      if (isEditableTarget(target)) return;
      handleKeyDown(event);
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true);
  }, [handleKeyDown, isEditableTarget, isContextMenuTarget]);

  useEffect(() => {
    const handleMouseUp = () => {
      dragSelectionRef.current = null;
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragSelectionRef]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const handleContext = (event) => {
      if (!selectedKeys || selectedKeys.size === 0 || editingCell) {
        setContextMenu(null);
        return;
      }
      event.preventDefault();
      const MENU_WIDTH = 180;
      const MENU_HEIGHT = 180;
      const VIEWPORT_GAP = 12;
      const SUBMENU_WIDTH = 300;
      const isNearRightEdge = event.clientX + MENU_WIDTH + SUBMENU_WIDTH > window.innerWidth;

      const maxX = Math.max(VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP);
      const maxY = Math.max(VIEWPORT_GAP, window.innerHeight - MENU_HEIGHT - VIEWPORT_GAP);
      setActiveContextSubmenu(null);
      setContextMenu({
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
        isNearRightEdge,
      });
    };
    el.addEventListener('contextmenu', handleContext);
    return () => el.removeEventListener('contextmenu', handleContext);
  }, [viewRef, selectedKeys, editingCell, setActiveContextSubmenu, setContextMenu]);

  useEffect(() => {
    const handleWindowClick = (event) => {
      if (contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, [contextMenuRef, setContextMenu]);
}
