import React from 'react';
import { Palette, Check, Ban } from '../../utils/icons';
import { FOLDER_COLOR_OPTIONS } from '../../utils/folderColors';

/**
 * The folder colour swatches, shared by 새 폴더 and 이름 및 색상 변경.
 *
 * "색 없음" is a swatch like any other rather than an absent option: without
 * it a colour could be given but never taken back, and the state a folder
 * starts in was unreachable from the picker that is supposed to describe it.
 */
export default function FolderColorPicker({ value, onChange, label = '폴더 테마 색상', disabled = false }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.65rem' }}>
        <Palette size={15} color="var(--accent-primary)" />
        <span>{label}</span>
      </label>
      <div style={{
        display: 'flex',
        gap: '0.65rem',
        flexWrap: 'wrap',
        background: 'var(--bg-tertiary)',
        padding: '0.85rem 1rem',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
      }}>
        {FOLDER_COLOR_OPTIONS.map(c => {
          const selected = (value || null) === c.value;
          const isNone = c.value === null;
          return (
            <button
              key={c.value || 'none'}
              type="button"
              disabled={disabled}
              onClick={() => onChange(c.value)}
              title={c.label}
              aria-label={c.label}
              aria-pressed={selected}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                // The empty swatch shows no colour at all — filling it with the
                // theme's accent would make it indistinguishable from 파랑 in
                // the default theme.
                backgroundColor: isNone ? 'transparent' : c.value,
                border: isNone
                  ? `2px dashed ${selected ? 'var(--accent-primary)' : 'var(--border-medium)'}`
                  : (selected ? '2px solid #ffffff' : '2px solid transparent'),
                boxShadow: selected && !isNone ? `0 0 10px ${c.value}cc, 0 0 0 2px ${c.value}` : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all 0.2s ease',
                transform: selected ? 'scale(1.1)' : 'scale(1)',
              }}
            >
              {isNone
                ? <Ban size={15} color={selected ? 'var(--accent-primary)' : 'var(--text-muted)'} />
                : (selected && <Check size={16} color="#fff" strokeWidth={3} />)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
