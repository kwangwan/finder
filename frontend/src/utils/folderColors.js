/**
 * The one palette a folder can be given, and the one rule for what colour its
 * icon ends up.
 *
 * Kept here because the picker used to be copied into each modal that offered
 * it, which is how the "default" entry and the actual default drifted apart.
 */

// `null` is a real, reachable state — a folder that was never given a colour,
// which then follows the theme. It is first because it is what a new folder is.
export const FOLDER_COLOR_OPTIONS = [
  { label: '색 없음 (테마 색상)', value: null },
  { label: '파랑', value: '#3b82f6' },
  { label: '에메랄드', value: '#10b981' },
  { label: '보라', value: '#8b5cf6' },
  { label: '주황', value: '#f59e0b' },
  { label: '로즈', value: '#f43f5e' },
  { label: '사이언', value: '#06b6d4' },
  { label: '핑크', value: '#ec4899' },
  { label: '그레이', value: '#64748b' },
];

/**
 * What colour to draw a folder icon in.
 *
 * Every place that shows a folder has to answer this the same way, or the same
 * folder reads as two different colours depending on where you look at it —
 * which is exactly what happened when the sidebar dimmed uncoloured folders
 * while the listing drew them in the accent colour.
 */
export function folderIconColor(folder) {
  return folder?.color || 'var(--accent-primary)';
}
