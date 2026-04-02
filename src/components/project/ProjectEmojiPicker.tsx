'use client';

import { createElement, useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

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
  const { resolvedTheme } = useTheme();

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

  const themeClass = resolvedTheme === 'dark' ? 'dark' : 'light';

  return (
    <div className="project-emoji-picker-frame">
      {isReady ? createElement('emoji-picker', {
        ref: pickerRef,
        className: `project-emoji-picker ${themeClass}`,
        'data-source': EMOJI_DATA_SOURCE_PATH,
      }) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
          <span className="loading loading-spinner loading-sm" />
        </div>
      )}
    </div>
  );
}
