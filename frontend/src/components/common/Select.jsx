import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from '../../utils/icons';

/**
 * Custom-styled dropdown replacing the browser's native <select>, whose
 * options can't be themed to match the rest of the dark UI.
 *
 * The option list is rendered through a portal into document.body,
 * positioned with `position: fixed` from the trigger's own bounding rect —
 * every usage of this component lives inside a modal, and modals clip their
 * content with `overflow: hidden` for rounded corners. On short/narrow
 * mobile viewports a trigger sitting near the bottom of the modal would
 * otherwise have its dropdown clipped to zero visible height by that
 * ancestor, which looked exactly like "tapping the select does nothing."
 *
 * options: [{ value, label }] — value may be a string, number, or '' (for a
 * "no selection" placeholder option).
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = '선택',
  title,
  className = '',
  style = {},
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null); // { top, left, width } | null
  const rootRef = useRef(null);
  const panelRef = useRef(null);

  const updatePosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = Math.min(260, options.length * 36 + 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < estimatedMenuHeight && rect.top > spaceBelow;
    // Some triggers are deliberately narrowed on mobile to fit a crowded
    // toolbar (e.g. the sort-order select) — the option list doesn't need
    // to match that width and shouldn't truncate every label to fit it.
    const width = Math.max(rect.width, 140);
    setMenuRect({
      left: Math.min(rect.left, window.innerWidth - width - 8),
      width,
      top: openUpward ? undefined : rect.bottom + 6,
      bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
      maxHeight: openUpward ? Math.max(120, rect.top - 12) : Math.max(120, spaceBelow - 12),
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsidePointer = (e) => {
      if (
        (rootRef.current && rootRef.current.contains(e.target)) ||
        (panelRef.current && panelRef.current.contains(e.target))
      ) {
        return;
      }
      setIsOpen(false);
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    // Reposition (rather than close) on scroll/resize so the panel keeps
    // tracking the trigger — most callers sit inside a scrollable modal
    // body, not the window itself.
    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  const selected = options.find(o => String(o.value) === String(value));

  return (
    <div ref={rootRef} className={`select-root ${className}`} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        className="select-trigger"
        title={title}
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
      >
        <span className="select-trigger-label">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`select-trigger-icon ${isOpen ? 'is-open' : ''}`} />
      </button>

      {isOpen && menuRect && createPortal(
        <div
          ref={panelRef}
          className="select-options"
          role="listbox"
          style={{
            position: 'fixed',
            left: menuRect.left,
            width: menuRect.width,
            top: menuRect.top,
            bottom: menuRect.bottom,
            maxHeight: menuRect.maxHeight,
          }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              role="option"
              aria-selected={String(opt.value) === String(value)}
              aria-disabled={!!opt.disabled}
              className={`select-option ${String(opt.value) === String(value) ? 'is-selected' : ''} ${opt.disabled ? 'is-disabled' : ''}`}
              onClick={() => {
                if (opt.disabled) return;
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
