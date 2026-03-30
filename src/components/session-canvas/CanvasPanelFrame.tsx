'use client';

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import type { SessionCanvasPanel } from '@/lib/types';

type CanvasPanelFrameProps = {
  panel: SessionCanvasPanel;
  scale: number;
  interactionMode?: 'canvas' | 'stacked';
  active: boolean;
  selected: boolean;
  closable?: boolean;
  onFocus: (panelId: string) => void;
  onUpdate: (
    panelId: string,
    updates: Partial<Pick<SessionCanvasPanel, 'x' | 'y' | 'width' | 'height'>>,
  ) => void;
  onClose: (panelId: string) => void;
  onMaximize: (panelId: string) => void;
  onRestore: (panelId: string) => void;
  headerActions?: ReactNode;
  children: ReactNode;
};

const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 220;
const PANEL_GEOMETRY_SYNC_EPSILON = 0.01;
const PANEL_SNAP_GRID_SIZE = 28;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, a, input, textarea, select, [data-panel-interactive="true"]'));
}

type PanelGeometry = Pick<SessionCanvasPanel, 'x' | 'y' | 'width' | 'height'>;

function areGeometriesEqual(a: PanelGeometry, b: PanelGeometry): boolean {
  return (
    Math.abs(a.x - b.x) < PANEL_GEOMETRY_SYNC_EPSILON
    && Math.abs(a.y - b.y) < PANEL_GEOMETRY_SYNC_EPSILON
    && Math.abs(a.width - b.width) < PANEL_GEOMETRY_SYNC_EPSILON
    && Math.abs(a.height - b.height) < PANEL_GEOMETRY_SYNC_EPSILON
  );
}

function snapToGrid(value: number): number {
  return Math.round(value / PANEL_SNAP_GRID_SIZE) * PANEL_SNAP_GRID_SIZE;
}

function CanvasPanelFrameComponent({
  panel,
  scale,
  interactionMode = 'canvas',
  active,
  selected,
  closable = true,
  onFocus,
  onUpdate,
  onClose,
  onMaximize,
  onRestore,
  headerActions,
  children,
}: CanvasPanelFrameProps) {
  const isStacked = interactionMode === 'stacked';
  const isMaximized = Boolean(panel.state?.maximized);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    mode: 'move' | 'resize';
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const committedGeometryRef = useRef<PanelGeometry | null>(null);
  const pendingGeometryRef = useRef<PanelGeometry | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pointerCaptureElementRef = useRef<HTMLElement | null>(null);
  const disabledIframeRefs = useRef<Array<{ element: HTMLIFrameElement; pointerEvents: string }>>([]);
  const [isResizePreviewActive, setIsResizePreviewActive] = useState(false);

  const applyGeometryToFrame = useCallback((geometry: PanelGeometry) => {
    const frame = frameRef.current;
    if (!frame) return;

    if (isStacked) {
      frame.style.left = '';
      frame.style.top = '';
      frame.style.width = '';
      frame.style.height = '';
      return;
    }

    frame.style.left = `${geometry.x}px`;
    frame.style.top = `${geometry.y}px`;
    frame.style.width = `${geometry.width}px`;
    frame.style.height = `${geometry.height}px`;
  }, [isStacked]);

  const flushPendingGeometry = useCallback(() => {
    animationFrameRef.current = null;
    const geometry = pendingGeometryRef.current;
    if (!geometry) return;
    applyGeometryToFrame(geometry);
  }, [applyGeometryToFrame]);

  const scheduleGeometryPreview = useCallback((geometry: PanelGeometry) => {
    pendingGeometryRef.current = geometry;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(flushPendingGeometry);
  }, [flushPendingGeometry]);

  const setIframeInteractionEnabled = useCallback((enabled: boolean) => {
    if (enabled) {
      for (const entry of disabledIframeRefs.current) {
        entry.element.style.pointerEvents = entry.pointerEvents;
      }
      disabledIframeRefs.current = [];
      return;
    }

    disabledIframeRefs.current = Array.from(
      document.querySelectorAll<HTMLIFrameElement>('[data-session-canvas-panel-content="true"] iframe'),
    ).map((element) => {
      const previousPointerEvents = element.style.pointerEvents;
      element.style.pointerEvents = 'none';
      return {
        element,
        pointerEvents: previousPointerEvents,
      };
    });
  }, []);

  const finalizePointerTracking = useCallback(() => {
    const dragState = dragStateRef.current;
    const pointerCaptureElement = pointerCaptureElementRef.current;
    if (dragState && pointerCaptureElement?.hasPointerCapture?.(dragState.pointerId)) {
      try {
        pointerCaptureElement.releasePointerCapture(dragState.pointerId);
      } catch {
        // Ignore release failures from detached elements.
      }
    }

    pointerCaptureElementRef.current = null;
    setIframeInteractionEnabled(true);
    dragStateRef.current = null;
  }, [setIframeInteractionEnabled]);

  const handlePointerMove = useCallback(function handlePointerMove(event: PointerEvent) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = (event.clientX - dragState.startClientX) / scale;
    const deltaY = (event.clientY - dragState.startClientY) / scale;

    if (dragState.mode === 'move') {
      const nextX = dragState.startX + deltaX;
      const nextY = dragState.startY + deltaY;
      scheduleGeometryPreview({
        x: event.shiftKey ? snapToGrid(nextX) : nextX,
        y: event.shiftKey ? snapToGrid(nextY) : nextY,
        width: dragState.startWidth,
        height: dragState.startHeight,
      });
      return;
    }

    scheduleGeometryPreview({
      x: dragState.startX,
      y: dragState.startY,
      width: Math.max(MIN_PANEL_WIDTH, dragState.startWidth + deltaX),
      height: Math.max(MIN_PANEL_HEIGHT, dragState.startHeight + deltaY),
    });
  }, [scale, scheduleGeometryPreview]);

  const handlePointerUp = useCallback(function handlePointerUp(event: PointerEvent) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const geometry = pendingGeometryRef.current;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (geometry) {
      applyGeometryToFrame(geometry);
      committedGeometryRef.current = geometry;
      pendingGeometryRef.current = null;

      if (dragState.mode === 'move') {
        onUpdate(panel.id, { x: geometry.x, y: geometry.y });
      } else {
        onUpdate(panel.id, { width: geometry.width, height: geometry.height });
      }
    }

    const frame = frameRef.current;
    if (frame) {
      frame.style.willChange = '';
    }

    setIsResizePreviewActive(false);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
    finalizePointerTracking();
  }, [applyGeometryToFrame, finalizePointerTracking, handlePointerMove, onUpdate, panel.id]);

  const stopPointerTracking = useCallback(() => {
    const dragState = dragStateRef.current;
    if (!dragState) {
      finalizePointerTracking();
      return;
    }

    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
    finalizePointerTracking();
  }, [finalizePointerTracking, handlePointerMove, handlePointerUp]);

  const handleHeaderDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;

    event.stopPropagation();
    onFocus(panel.id);

    if (isStacked) return;
    if (isMaximized) {
      onRestore(panel.id);
      return;
    }

    onMaximize(panel.id);
  }, [isMaximized, isStacked, onFocus, onMaximize, onRestore, panel.id]);

  const startPointerTracking = useCallback((
    event: ReactPointerEvent,
    mode: 'move' | 'resize',
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onFocus(panel.id);

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: panel.x,
      startY: panel.y,
      mode,
      startWidth: panel.width,
      startHeight: panel.height,
    };

    committedGeometryRef.current = null;
    pendingGeometryRef.current = {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
    };

    const frame = frameRef.current;
    if (frame) {
      frame.style.willChange = mode === 'move' ? 'left, top' : 'width, height';
    }

    pointerCaptureElementRef.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (pointerCaptureElementRef.current?.setPointerCapture) {
      try {
        pointerCaptureElementRef.current.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures and fall back to window listeners.
      }
    }

    setIframeInteractionEnabled(false);
    setIsResizePreviewActive(mode === 'resize');

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [handlePointerMove, handlePointerUp, onFocus, panel.height, panel.id, panel.width, panel.x, panel.y, setIframeInteractionEnabled]);

  useEffect(() => {
    if (dragStateRef.current) return;

    const committedGeometry = committedGeometryRef.current;
    const currentGeometry = {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
    };

    if (committedGeometry && areGeometriesEqual(committedGeometry, currentGeometry)) {
      committedGeometryRef.current = null;
    }

    if (!committedGeometryRef.current) {
      applyGeometryToFrame(currentGeometry);
    }
  }, [applyGeometryToFrame, panel.height, panel.width, panel.x, panel.y]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    stopPointerTracking();
  }, [stopPointerTracking]);

  return (
    <div
      ref={frameRef}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-white transition-shadow dark:bg-[#111827] ${
        isStacked ? 'relative h-full w-full' : 'absolute'
      } ${
        selected
          ? 'border-slate-400 shadow-[0_18px_42px_-18px_rgba(15,23,42,0.48)] ring-1 ring-slate-300 dark:border-slate-500 dark:ring-slate-600'
          : active
            ? 'border-slate-300 shadow-[0_18px_42px_-18px_rgba(15,23,42,0.48)] dark:border-slate-600'
            : 'border-slate-200 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.4)] dark:border-slate-800'
      }`}
      style={{
        left: isStacked ? undefined : panel.x,
        top: isStacked ? undefined : panel.y,
        width: isStacked ? '100%' : panel.width,
        height: isStacked ? '100%' : panel.height,
        zIndex: isStacked ? undefined : panel.zIndex,
        contain: 'layout paint',
      }}
      data-session-canvas-panel="true"
      onPointerDownCapture={() => onFocus(panel.id)}
      onFocusCapture={() => onFocus(panel.id)}
      onMouseDown={() => onFocus(panel.id)}
      onWheelCapture={(event) => {
        if (isStacked) return;
        if (!selected) return;
        if (event.ctrlKey || event.metaKey) return;
        event.stopPropagation();
      }}
    >
      <div
        className="relative flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/90 px-3 py-1.5 text-[12px] dark:border-slate-800 dark:bg-slate-950/80"
        onPointerDown={(event) => {
          if (isStacked || isMaximized) return;
          if (isInteractiveTarget(event.target)) return;
          startPointerTracking(event, 'move');
        }}
        onDoubleClick={handleHeaderDoubleClick}
      >
        <div className="flex shrink-0 items-center gap-1.5" data-panel-interactive="true">
          <button
            type="button"
            className={`h-3 w-3 rounded-full border border-[#d24a43] bg-[#ff5f57] transition ${closable ? 'hover:brightness-95' : 'cursor-not-allowed opacity-50'}`}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (!closable) return;
              onClose(panel.id);
            }}
            disabled={!closable}
            data-panel-interactive="true"
            aria-label={closable ? `Close ${panel.title}` : `${panel.title} cannot be closed`}
            title={closable ? 'Close panel' : 'This panel cannot be closed'}
          />
          <button
            type="button"
            className={`h-3 w-3 rounded-full border border-[#c89f19] bg-[#ffbd2f] transition ${isMaximized && !isStacked ? 'hover:brightness-95' : 'cursor-default opacity-50'}`}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (!isMaximized || isStacked) return;
              onRestore(panel.id);
            }}
            disabled={!isMaximized || isStacked}
            data-panel-interactive="true"
            aria-label={isMaximized ? `Restore ${panel.title}` : `Restore ${panel.title} is unavailable`}
            title={isMaximized ? 'Restore panel' : 'Restore unavailable'}
          />
          <button
            type="button"
            className={`h-3 w-3 rounded-full border border-[#4ba443] bg-[#28c840] transition ${!isMaximized && !isStacked ? 'hover:brightness-95' : 'cursor-default opacity-50'}`}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (isMaximized || isStacked) return;
              onMaximize(panel.id);
            }}
            disabled={isMaximized || isStacked}
            data-panel-interactive="true"
            aria-label={!isMaximized ? `Maximize ${panel.title}` : `Maximize ${panel.title} is unavailable`}
            title={!isMaximized ? 'Maximize panel' : 'Already maximized'}
          />
        </div>
        <div className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-100">
          {panel.title}
        </div>
        {headerActions}
      </div>

      <div
        className={`relative min-h-0 flex-1 overflow-hidden ${isResizePreviewActive ? 'bg-slate-50/80 dark:bg-slate-950/70' : ''}`}
        data-session-canvas-panel-content="true"
      >
        <div className={isResizePreviewActive ? 'hidden h-full' : 'h-full'}>
          {children}
        </div>
        {isResizePreviewActive ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-[11px] font-medium tracking-[0.02em] text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-950/85 dark:text-slate-300">
              Resizing
            </div>
          </div>
        ) : null}
      </div>

      {!isStacked && !isMaximized ? (
        <button
          type="button"
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize rounded-tl-md bg-slate-100/80 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:bg-slate-900/80 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          onPointerDown={(event) => {
            startPointerTracking(event, 'resize');
          }}
          data-panel-interactive="true"
          aria-label={`Resize ${panel.title}`}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5">
            <path
              d="M6 14L14 6M10 14L14 10M14 14L14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

CanvasPanelFrameComponent.displayName = 'CanvasPanelFrame';

export const CanvasPanelFrame = memo(CanvasPanelFrameComponent);
