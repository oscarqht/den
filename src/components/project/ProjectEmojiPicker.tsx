'use client';

import { createElement, useEffect, useMemo, useRef, useState } from 'react';

type EmojiClickDetail = {
  unicode?: string;
};

type EmojiClickEvent = Event & {
  detail?: EmojiClickDetail;
};

type ProjectEmojiPickerProps = {
  onSelect: (iconEmoji: string) => void;
};

const EMOJI_DATA_SOURCE_PATH = '/api/emoji-data';

export function ProjectEmojiPicker({ onSelect }: ProjectEmojiPickerProps) {
  const pickerRef = useRef<HTMLElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void import('emoji-picker-element').then(() => {
      if (!cancelled) {
        setIsReady(true);
      }
    }).catch((error) => {
      console.error('Failed to load emoji picker:', error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady || !pickerRef.current) return;

    const handleEmojiClick = (event: Event) => {
      const iconEmoji = (event as EmojiClickEvent).detail?.unicode?.trim();
      if (iconEmoji) {
        onSelect(iconEmoji);
      }
    };

    pickerRef.current.addEventListener('emoji-click', handleEmojiClick);
    return () => {
      pickerRef.current?.removeEventListener('emoji-click', handleEmojiClick);
    };
  }, [isReady, onSelect]);

  const pickerElement = useMemo(() => createElement('emoji-picker', {
    ref: pickerRef,
    className: 'block h-[360px] w-[320px] overflow-hidden',
    'data-source': EMOJI_DATA_SOURCE_PATH,
  }), []);

  if (!isReady) {
    return (
      <div className="flex h-[360px] w-[320px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        <span className="loading loading-spinner loading-sm" />
      </div>
    );
  }

  return pickerElement;
}
