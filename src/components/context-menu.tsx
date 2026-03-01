'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface ContextMenuItem {
    label: string;
    labelNode?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
    danger?: boolean;
    children?: ContextMenuItem[];
    disabled?: boolean;
}

export function ContextMenu({
    children,
    items,
    containerClassName = 'w-full',
}: {
    children: React.ReactNode,
    items: ContextMenuItem[],
    containerClassName?: string
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const menuRef = useRef<HTMLUListElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Calculate position relative to viewport
        const x = e.clientX;
        const y = e.clientY;
        
        setPosition({ x, y });
        setIsOpen(true);
    };

    // Close menu when clicking outside
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
                containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };

        // Use setTimeout to avoid immediate closure
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
            document.addEventListener('contextmenu', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
        }, 0);

        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('contextmenu', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen]);

    // Calculate menu width based on content and adjust position if menu would go off-screen
    useEffect(() => {
        if (!isOpen || !menuRef.current) return;

        const menu = menuRef.current;
        
        // Use requestAnimationFrame to ensure styles are applied
        requestAnimationFrame(() => {
            // Calculate optimal width based on content
            // Create a temporary element to measure text width
            const tempElement = document.createElement('div');
            tempElement.style.position = 'absolute';
            tempElement.style.visibility = 'hidden';
            tempElement.style.whiteSpace = 'nowrap';
            tempElement.style.pointerEvents = 'none';
            
            // Copy font styles from menu
            const menuStyles = window.getComputedStyle(menu);
            tempElement.style.fontSize = menuStyles.fontSize;
            tempElement.style.fontFamily = menuStyles.fontFamily;
            tempElement.style.fontWeight = menuStyles.fontWeight;
            tempElement.style.padding = '0.5rem 0.75rem'; // Match menu item padding
            tempElement.style.boxSizing = 'border-box';
            
            document.body.appendChild(tempElement);

            let maxWidth = 0;
            items.forEach(item => {
                tempElement.textContent = item.label;
                const width = tempElement.getBoundingClientRect().width;
                const iconWidth = item.icon ? 20 : 0;
                const submenuArrowWidth = item.children?.length ? 16 : 0;
                const totalWidth = width + iconWidth + submenuArrowWidth;
                if (totalWidth > maxWidth) {
                    maxWidth = totalWidth;
                }
            });

            document.body.removeChild(tempElement);

            // Set menu width (add padding: 1rem on each side = 2rem total = 32px)
            const menuWidth = Math.max(maxWidth + 32, 280); // Minimum 280px, or content width + padding
            menu.style.width = `${menuWidth}px`;
            menu.style.minWidth = `${menuWidth}px`;

            // Now adjust position if menu would go off-screen
            const rect = menu.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let adjustedX = position.x;
            let adjustedY = position.y;

            // Adjust horizontal position if menu goes off right edge
            if (rect.right > viewportWidth) {
                adjustedX = viewportWidth - rect.width - 10;
            }
            // Adjust horizontal position if menu goes off left edge
            if (adjustedX < 10) {
                adjustedX = 10;
            }

            // Adjust vertical position if menu goes off bottom edge
            if (rect.bottom > viewportHeight) {
                adjustedY = viewportHeight - rect.height - 10;
            }
            // Adjust vertical position if menu goes off top edge
            if (adjustedY < 10) {
                adjustedY = 10;
            }

            if (adjustedX !== position.x || adjustedY !== position.y) {
                menu.style.left = `${adjustedX}px`;
                menu.style.top = `${adjustedY}px`;
            }
        });
    }, [isOpen, position, items]);

    const renderMenuItem = (item: ContextMenuItem, key: string) => {
        const hasChildren = !!item.children?.length;

        return (
            <li key={key} className={cn(hasChildren && "relative group/submenu")}>
                <a
                    onClick={(e) => {
                        e.stopPropagation();
                        if (item.disabled || hasChildren) {
                            return;
                        }
                        item.onClick?.();
                        setIsOpen(false);
                    }}
                    className={cn(
                        "flex items-center gap-2",
                        "whitespace-nowrap",
                        item.danger && "text-error",
                        item.disabled && "opacity-40 pointer-events-none",
                        hasChildren && "flex items-center justify-between gap-3"
                    )}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        {item.icon && <span className="inline-flex shrink-0 opacity-80">{item.icon}</span>}
                        <span>{item.labelNode ?? item.label}</span>
                    </span>
                    {hasChildren && <i className="iconoir-nav-arrow-right text-[12px]" aria-hidden="true" />}
                </a>
                {hasChildren && (
                    <>
                        <span className="hidden group-hover/submenu:block absolute left-full top-0 h-full w-3" />
                        <ul className="hidden group-hover/submenu:block absolute left-[calc(100%-1px)] top-0 menu !m-0 p-2 shadow-lg bg-base-100 rounded-box border border-base-200 min-w-[220px] z-[10000] [&:before]:hidden">
                            {item.children!.map((child, idx) => renderMenuItem(child, `${key}-${idx}`))}
                        </ul>
                    </>
                )}
            </li>
        );
    };

    return (
        <div ref={containerRef} className={containerClassName} onContextMenu={handleContextMenu}>
            {children}
            {isOpen && (
                <ul
                    ref={menuRef}
                    className="fixed z-[9999] menu p-2 shadow-lg bg-base-100 rounded-box border border-base-200"
                    style={{
                        left: `${position.x}px`,
                        top: `${position.y}px`,
                    }}
                >
                    {items.map((item, idx) => renderMenuItem(item, `menu-${idx}`))}
                </ul>
            )}
        </div>
    );
}
