import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Custom-styled dropdown replacing the browser's native <select>, whose
 * options can't be themed to match the rest of the dark UI.
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
  const rootRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

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

      {isOpen && (
        <div className="select-options" role="listbox">
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
        </div>
      )}
    </div>
  );
}
