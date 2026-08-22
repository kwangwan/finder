import React, { useState, useEffect } from 'react';
import { Folder, ExternalLink, Download } from './icons';
import { getPresignedDownloadUrl, ensureMediaToken, getMediaPreviewUrl } from '../api';

// Extract YouTube video ID from a URL (watch, share, or embed link forms)
export function extractYouTubeId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Extract a Vimeo video ID from a URL (plain watch or player/embed link forms)
export function extractVimeoId(url) {
  if (!url) return null;
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : null;
}

// Resolves a URL to a ready-to-embed iframe src for the video hosts this app
// recognizes (YouTube, Vimeo), or null if the URL isn't one of those.
export function getVideoEmbedUrl(url) {
  const ytId = extractYouTubeId(url);
  if (ytId) return `https://www.youtube.com/embed/${ytId}`;
  const vimeoId = extractVimeoId(url);
  if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
  return null;
}

// The link text NoteEditor.jsx's video-block markdown export uses (instead of
// the bare URL) — the ONLY signal that tells the preview renderer below "this
// link came from an actual video block the user explicitly inserted," as
// opposed to a plain YouTube/Vimeo URL someone just typed or pasted as text.
// BlockNote's own markdown exporter strips link `title` attributes entirely
// and collapses text-equals-href links to a bare URL, so the link's visible
// text is the only part of a `[text](url)` pair that reliably round-trips —
// this sentinel has to live in that text, not in an attribute.
export const VIDEO_EMBED_LINK_TEXT = '▶ 첨부된 동영상';

/**
 * An inserted image's markdown (`![name](/api/storage/preview/{id}?token=...)`)
 * has the media token baked into the stored text at insert time, but that
 * token expires after 15 minutes (see MEDIA_TOKEN_EXPIRE_MINUTES) — so the
 * literal URL saved in the note goes dead well before anyone reopens it.
 * This strips whatever token the src carries (fresh or stale, doesn't matter)
 * and asks for a current one before rendering, every time the image mounts.
 */
function MarkdownImage({ src, alt }) {
  const [resolvedSrc, setResolvedSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const idMatch = src && src.match(/\/api\/storage\/preview\/([^/?]+)/);
    if (!idMatch) {
      setResolvedSrc(src);
      return undefined;
    }
    setResolvedSrc(null);
    ensureMediaToken().then(() => {
      if (!cancelled) setResolvedSrc(getMediaPreviewUrl(idMatch[1]));
    });
    return () => { cancelled = true; };
  }, [src]);

  if (!resolvedSrc) return null;
  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)' }}
    />
  );
}

/**
 * Shared react-markdown `a`/`img` renderers: folder navigation links,
 * presigned-download links, and images re-authenticated with a fresh media
 * token on every render. Used by both the note editor's preview pane and the
 * standalone preview window, so both surfaces render attachments identically.
 */
export function createMarkdownLinkComponents({ onNavigateFolder, showAlert } = {}) {
  return {
    img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
    a: ({ href, children, ...props }) => {
      // 1. Folder Navigation Link: folder:FOLDER_ID
      if (href && href.startsWith('folder:') && onNavigateFolder) {
        const folderId = href.replace('folder:', '');
        return (
          <span
            onClick={(e) => {
              e.preventDefault();
              onNavigateFolder(folderId === 'root' ? null : folderId);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--accent-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              textDecoration: 'underline'
            }}
            title="새 탭으로 폴더 열기"
          >
            <Folder size={14} />
            {children}
            <ExternalLink size={12} />
          </span>
        );
      }

      // 2. Presigned Download Link: /api/storage/presigned-download/FILE_ID
      if (href && href.includes('/api/storage/presigned-download/')) {
        const fileId = href.split('/api/storage/presigned-download/')[1];
        return (
          <a
            href={href}
            onClick={async (e) => {
              e.preventDefault();
              try {
                const { download_url } = await getPresignedDownloadUrl(fileId);
                window.open(download_url, '_blank');
              } catch (err) {
                if (showAlert) {
                  await showAlert({
                    title: '다운로드 실패',
                    message: '다운로드 URL 생성 중 오류가 발생했습니다: ' + err.message,
                    type: 'error'
                  });
                }
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '0.2rem 0.55rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--accent-primary)',
              textDecoration: 'none',
              fontWeight: 600,
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}
            title="Presigned URL로 바로 다운로드"
          >
            <Download size={13} />
            {children}
          </a>
        );
      }

      // 3. A video block's own export (see VIDEO_EMBED_LINK_TEXT above) —
      // embed it here too, so the read-only preview shows exactly what the
      // live editor does. A link that merely happens to point at YouTube/
      // Vimeo (typed or pasted as plain text, not inserted as a video block)
      // does NOT get this treatment — it stays a plain link, since "just a
      // link" should render as just a link.
      const linkText = Array.isArray(children) ? children.join('') : children;
      const embedUrl = linkText === VIDEO_EMBED_LINK_TEXT ? getVideoEmbedUrl(href) : null;
      if (embedUrl) {
        return (
          <span style={{ display: 'block', margin: '1.25rem 0' }}>
            <span style={{
              display: 'block',
              position: 'relative',
              paddingBottom: '56.25%',
              height: 0,
              overflow: 'hidden',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-md)',
              border: '1px solid var(--border-subtle)'
            }}>
              <iframe
                src={embedUrl}
                title="Video Player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none'
                }}
              />
            </span>
          </span>
        );
      }

      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props} style={{ color: 'var(--accent-primary)' }}>
          {children}
        </a>
      );
    }
  };
}
