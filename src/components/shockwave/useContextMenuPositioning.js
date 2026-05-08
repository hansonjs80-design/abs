import { useCallback, useEffect, useState } from 'react';

const VIEWPORT_GAP = 12;

export default function useContextMenuPositioning({
  activeContextSubmenu,
  contextMenu,
  contextMenuRef,
  setContextMenu,
}) {
  const [contextSubmenuOffsetY, setContextSubmenuOffsetY] = useState(0);

  const repositionContextMenu = useCallback(() => {
    if (!contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const maxX = Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP);
    const maxY = Math.max(VIEWPORT_GAP, window.innerHeight - rect.height - VIEWPORT_GAP);

    setContextMenu((prev) => {
      if (!prev) return prev;
      const nextX = Math.min(Math.max(VIEWPORT_GAP, prev.x), maxX);
      const nextY = Math.min(Math.max(VIEWPORT_GAP, prev.y), maxY);
      if (nextX === prev.x && nextY === prev.y) return prev;
      return { ...prev, x: nextX, y: nextY };
    });
  }, [contextMenuRef, setContextMenu]);

  const repositionContextSubmenu = useCallback(() => {
    const menu = contextMenuRef.current;
    if (!menu || !activeContextSubmenu) {
      setContextSubmenuOffsetY(0);
      return;
    }

    const submenu = menu.querySelector('.has-submenu.is-submenu-open > .context-menu-submenu');
    if (!submenu) {
      setContextSubmenuOffsetY(0);
      return;
    }

    const previousTransform = submenu.style.transform;
    submenu.style.transform = 'translateY(0px)';
    const rect = submenu.getBoundingClientRect();
    submenu.style.transform = previousTransform;

    let nextOffset = 0;
    if (rect.bottom > window.innerHeight - VIEWPORT_GAP) {
      nextOffset = window.innerHeight - VIEWPORT_GAP - rect.bottom;
    }
    if (rect.top + nextOffset < VIEWPORT_GAP) {
      nextOffset += VIEWPORT_GAP - (rect.top + nextOffset);
    }
    setContextSubmenuOffsetY(nextOffset);
  }, [activeContextSubmenu, contextMenuRef]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    let frame = window.requestAnimationFrame(() => {
      repositionContextMenu();
      repositionContextSubmenu();
    });

    const handleViewportChange = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        repositionContextMenu();
        repositionContextSubmenu();
      });
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [contextMenu, repositionContextMenu, repositionContextSubmenu]);

  useEffect(() => {
    if (!contextMenu || !activeContextSubmenu) {
      setContextSubmenuOffsetY(0);
      return undefined;
    }
    const frame = window.requestAnimationFrame(repositionContextSubmenu);
    return () => window.cancelAnimationFrame(frame);
  }, [contextMenu, activeContextSubmenu, repositionContextSubmenu]);

  return { contextSubmenuOffsetY };
}
