'use client';
/* eslint-disable @next/next/no-img-element */

import { DiffImage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CSSProperties, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ImageDiffViewProps {
  filePath: string;
  imageDiff?: DiffImage | null;
}

type ImageDiffMode = 'side-by-side' | 'swipe' | 'onion-skin';

const IMAGE_MODE_STORAGE_KEY = 'git-web:image-diff-mode';

const MODE_OPTIONS: Array<{ value: ImageDiffMode; label: string }> = [
  { value: 'side-by-side', label: 'Side-by-Side' },
  { value: 'swipe', label: 'Swipe' },
  { value: 'onion-skin', label: 'Onion Skin' },
];

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundImage: `
    linear-gradient(45deg, rgba(120, 120, 120, 0.16) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(120, 120, 120, 0.16) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(120, 120, 120, 0.16) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(120, 120, 120, 0.16) 75%)
  `,
  backgroundSize: '22px 22px',
  backgroundPosition: '0 0, 0 11px, 11px -11px, -11px 0px',
};

function formatBase64Size(base64?: string): string | null {
  if (!base64) return null;

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useImagePreview(mimeType?: string, base64?: string) {
  const [loadedPreview, setLoadedPreview] = useState<{
    src: string;
    dimensions: { width: number; height: number } | null;
  } | null>(null);

  const src = useMemo(() => {
    if (!mimeType || !base64) return null;
    return `data:${mimeType};base64,${base64}`;
  }, [mimeType, base64]);

  const formattedSize = useMemo(() => formatBase64Size(base64), [base64]);

  useEffect(() => {
    if (!src) return;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setLoadedPreview({
          src,
          dimensions: { width: image.naturalWidth, height: image.naturalHeight },
        });
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setLoadedPreview({ src, dimensions: null });
      }
    };
    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  const dimensions = src && loadedPreview?.src === src ? loadedPreview.dimensions : null;

  const metadata =
    dimensions && formattedSize
      ? `${dimensions.width} x ${dimensions.height} px, ${formattedSize}`
      : formattedSize
        ? `-, ${formattedSize}`
        : null;

  return {
    src,
    metadata,
  };
}

function ImagePane({
  title,
  filePath,
  imageSrc,
  metadata,
}: {
  title: string;
  filePath: string;
  imageSrc: string | null;
  metadata: string | null;
}) {
  return (
    <section className="border border-base-300 rounded-lg bg-base-200/30 overflow-hidden h-full min-h-0 flex flex-col">
      <header className="px-3 py-2 border-b border-base-300 text-[10px] uppercase tracking-wider font-bold opacity-70">
        {metadata ? `${title} (${metadata})` : title}
      </header>
      <div className="flex-1 min-h-0 flex items-center justify-center p-3" style={CHECKERBOARD_STYLE}>
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={`${title} image for ${filePath}`}
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
        ) : (
          <span className="text-sm opacity-50">No image</span>
        )}
      </div>
    </section>
  );
}

export function ImageDiffView({ filePath, imageDiff }: ImageDiffViewProps) {
  const leftPreview = useImagePreview(imageDiff?.left?.mimeType, imageDiff?.left?.base64);
  const rightPreview = useImagePreview(imageDiff?.right?.mimeType, imageDiff?.right?.base64);
  const hasBothImages = Boolean(leftPreview.src && rightPreview.src);

  const [mode, setMode] = useState<ImageDiffMode>(() => {
    if (typeof window === 'undefined') return 'side-by-side';

    try {
      const stored = localStorage.getItem(IMAGE_MODE_STORAGE_KEY);
      if (stored === 'side-by-side' || stored === 'swipe' || stored === 'onion-skin') {
        return stored;
      }
    } catch (error) {
      console.error('Failed to load image diff mode preference:', error);
    }

    return 'side-by-side';
  });

  const [swipePosition, setSwipePosition] = useState(50);
  const [onionBlend, setOnionBlend] = useState(50);
  const [swipePointerId, setSwipePointerId] = useState<number | null>(null);
  const compareCanvasRef = useRef<HTMLDivElement | null>(null);
  const effectiveMode: ImageDiffMode = !hasBothImages && mode !== 'side-by-side' ? 'side-by-side' : mode;

  useEffect(() => {
    try {
      localStorage.setItem(IMAGE_MODE_STORAGE_KEY, mode);
    } catch (error) {
      console.error('Failed to save image diff mode preference:', error);
    }
  }, [mode]);

  const updateSwipePosition = useCallback((clientX: number) => {
    const container = compareCanvasRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, ratio));
    setSwipePosition(clamped * 100);
  }, []);

  const onSwipePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (effectiveMode !== 'swipe' || !hasBothImages) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSwipePointerId(event.pointerId);
    updateSwipePosition(event.clientX);
  }, [effectiveMode, hasBothImages, updateSwipePosition]);

  const onSwipePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (effectiveMode !== 'swipe' || swipePointerId !== event.pointerId) return;
    updateSwipePosition(event.clientX);
  }, [effectiveMode, swipePointerId, updateSwipePosition]);

  const onSwipePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (swipePointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSwipePointerId(null);
  }, [swipePointerId]);

  const renderSideBySide = () => (
    <div className="min-w-[720px] h-full min-h-0 grid grid-cols-2 gap-4">
      <ImagePane
        title="Old"
        filePath={filePath}
        imageSrc={leftPreview.src}
        metadata={leftPreview.metadata}
      />
      <ImagePane
        title="New"
        filePath={filePath}
        imageSrc={rightPreview.src}
        metadata={rightPreview.metadata}
      />
    </div>
  );

  const renderComparisonMode = () => (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-1 pb-2 text-sm font-semibold flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-error shrink-0">Old</span>
          <span className="text-[11px] opacity-60 truncate font-mono">{leftPreview.metadata ?? 'No image'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <span className="text-[11px] opacity-60 truncate font-mono">{rightPreview.metadata ?? 'No image'}</span>
          <span className="text-success shrink-0">New</span>
        </div>
      </div>

      <div
        ref={compareCanvasRef}
        className={cn(
          'relative flex-1 min-h-0 rounded-lg border border-base-300 overflow-hidden shadow-sm',
          effectiveMode === 'swipe' && hasBothImages ? 'cursor-ew-resize touch-none' : ''
        )}
        style={CHECKERBOARD_STYLE}
        onPointerDown={onSwipePointerDown}
        onPointerMove={onSwipePointerMove}
        onPointerUp={onSwipePointerUp}
        onPointerCancel={onSwipePointerUp}
      >
        {leftPreview.src ? (
          <img
            src={leftPreview.src}
            alt={`Old image for ${filePath}`}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
            draggable={false}
          />
        ) : null}

        {effectiveMode === 'onion-skin' ? (
          rightPreview.src ? (
            <img
              src={rightPreview.src}
              alt={`New image for ${filePath}`}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
              style={{ opacity: onionBlend / 100 }}
              draggable={false}
            />
          ) : null
        ) : rightPreview.src ? (
          <img
            src={rightPreview.src}
            alt={`New image for ${filePath}`}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
            style={{ clipPath: `inset(0 0 0 ${swipePosition}%)` }}
            draggable={false}
          />
        ) : null}

        {effectiveMode === 'swipe' && hasBothImages ? (
          <>
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-primary/90 pointer-events-none"
              style={{ left: `${swipePosition}%`, transform: 'translateX(-1px)' }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-primary bg-base-100 pointer-events-none"
              style={{ left: `${swipePosition}%`, transform: 'translate(-50%, -50%)' }}
            />
          </>
        ) : null}

        {!leftPreview.src && !rightPreview.src ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm opacity-50">No image data available</div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="h-full min-h-0 p-4 box-border flex flex-col">
      <div className={cn('flex-1 min-h-0', effectiveMode === 'side-by-side' ? 'overflow-auto' : 'overflow-hidden')}>
        {effectiveMode === 'side-by-side' ? renderSideBySide() : renderComparisonMode()}
      </div>

      {effectiveMode === 'onion-skin' && hasBothImages ? (
        <div className="mt-3 flex items-center justify-center gap-3 shrink-0">
          <span className="text-sm font-semibold text-error">Old</span>
          <input
            type="range"
            min={0}
            max={100}
            value={onionBlend}
            onChange={(event) => setOnionBlend(Number(event.target.value))}
            className="range range-primary range-sm w-[320px] max-w-[65vw]"
            aria-label="Onion skin blend slider"
          />
          <span className="text-sm font-semibold text-success">New</span>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-center gap-2 shrink-0">
        {MODE_OPTIONS.map((option) => {
          const disabled = option.value !== 'side-by-side' && !hasBothImages;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              disabled={disabled}
              className={cn(
                'px-4 py-1.5 text-sm rounded-lg transition-colors font-semibold',
                effectiveMode === option.value
                  ? 'bg-base-300 text-base-content'
                  : 'text-base-content/60 hover:text-base-content hover:bg-base-200',
                disabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : ''
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {!hasBothImages ? (
        <p className="text-center text-[11px] opacity-60 mt-2">
          Swipe and Onion Skin modes require both old and new image versions.
        </p>
      ) : null}
    </div>
  );
}
