import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  getAnchoredFloatingPanelLayout,
  getBrowserViewport,
  getFloatingPanelViewportOffset,
} from '../../lib/floatingPanelPositionUtils';

const VIEWPORT_GAP = 12;

export default function useContextMenuPositioning({
  activeContextSubmenu,
  contextMenu,
  contextMenuRef,
  setContextMenu,
}) {
  const [contextSubmenuOffset, setContextSubmenuOffset] = useState({ x: 0, y: 0 });
  const [bodySubmenuLayout, setBodySubmenuLayout] = useState({
    openLeft: null,
    maxWidth: null,
  });

  const resetBodySubmenuLayout = useCallback(() => {
    setBodySubmenuLayout((prev) => (
      prev.openLeft === null && prev.maxWidth === null
        ? prev
        : { openLeft: null, maxWidth: null }
    ));
  }, []);

  const repositionContextMenu = useCallback(() => {
    if (!contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const viewport = getBrowserViewport(window);
    const minX = viewport.offsetLeft + VIEWPORT_GAP;
    const minY = viewport.offsetTop + VIEWPORT_GAP;
    const maxX = Math.max(minX, viewport.offsetLeft + viewport.width - rect.width - VIEWPORT_GAP);
    const maxY = Math.max(minY, viewport.offsetTop + viewport.height - rect.height - VIEWPORT_GAP);

    setContextMenu((prev) => {
      if (!prev) return prev;
      const nextX = Math.min(Math.max(minX, prev.x), maxX);
      const nextY = Math.min(Math.max(minY, prev.y), maxY);
      if (nextX === prev.x && nextY === prev.y) return prev;
      return { ...prev, x: nextX, y: nextY };
    });
  }, [contextMenuRef, setContextMenu]);

  const repositionContextSubmenu = useCallback(() => {
    const menu = contextMenuRef.current;
    if (!menu || !activeContextSubmenu) {
      setContextSubmenuOffset((prev) => (
        prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }
      ));
      resetBodySubmenuLayout();
      return;
    }

    const submenu = menu.querySelector('.has-submenu.is-submenu-open > .context-menu-submenu');
    if (!submenu) {
      setContextSubmenuOffset((prev) => (
        prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }
      ));
      resetBodySubmenuLayout();
      return;
    }

    const previousTransform = submenu.style.transform;
    submenu.style.transform = 'translate(0px, 0px)';
    const rect = submenu.getBoundingClientRect();
    submenu.style.transform = previousTransform;
    const viewport = getBrowserViewport(window);
    const viewportOffset = getFloatingPanelViewportOffset(
      rect,
      viewport,
      VIEWPORT_GAP,
    );
    const isBodySubmenu = submenu.classList.contains('context-menu-submenu--body')
      && !menu.classList.contains('standalone-mode');
    let nextOffset = viewportOffset;

    if (isBodySubmenu) {
      const anchoredLayout = getAnchoredFloatingPanelLayout({
        panelRect: rect,
        anchorRect: menu.getBoundingClientRect(),
        viewport,
        viewportGap: VIEWPORT_GAP,
        panelGap: 4,
        preferLeft: menu.classList.contains('submenu-pop-left'),
      });
      nextOffset = { x: 0, y: viewportOffset.y };
      setBodySubmenuLayout((prev) => (
        prev.openLeft === anchoredLayout.openLeft
          && prev.maxWidth === anchoredLayout.maxWidth
          ? prev
          : anchoredLayout
      ));
    } else {
      resetBodySubmenuLayout();
    }

    setContextSubmenuOffset((prev) => (
      prev.x === nextOffset.x && prev.y === nextOffset.y ? prev : nextOffset
    ));
  }, [activeContextSubmenu, contextMenuRef, resetBodySubmenuLayout]);

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
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, [contextMenu, repositionContextMenu, repositionContextSubmenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !activeContextSubmenu) {
      setContextSubmenuOffset((prev) => (
        prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }
      ));
      return undefined;
    }

    let frame = window.requestAnimationFrame(() => {
      repositionContextMenu();
      repositionContextSubmenu();
    });

    const submenu = contextMenuRef.current?.querySelector(
      '.has-submenu.is-submenu-open > .context-menu-submenu',
    );
    const resizeObserver = submenu && window.ResizeObserver
      ? new window.ResizeObserver(() => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          repositionContextMenu();
          repositionContextSubmenu();
        });
      })
      : null;
    if (submenu && resizeObserver) resizeObserver.observe(submenu);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [
    contextMenu,
    activeContextSubmenu,
    contextMenuRef,
    repositionContextMenu,
    repositionContextSubmenu,
  ]);

  return {
    bodySubmenuMaxWidth: bodySubmenuLayout.maxWidth,
    bodySubmenuOpenLeft: bodySubmenuLayout.openLeft,
    contextSubmenuOffsetX: contextSubmenuOffset.x,
    contextSubmenuOffsetY: contextSubmenuOffset.y,
  };
}
