import { ensureMediaToken, getMediaPreviewUrl, getPresignedDownloadUrl } from '../api';
import { extractYouTubeId } from './markdownLinkComponents';

/**
 * Markdown to PDF Export Utility
 * Opens a formatted print frame styled specifically for high-quality A4 PDF generation.
 */

const escapeHtml = (str) => {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

const escapeAttr = (str) => escapeHtml(str).replace(/"/g, '&quot;');

function youtubeEmbedHtml(ytId, label) {
  const thumbUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  const watchUrl = `https://www.youtube.com/watch?v=${ytId}`;
  const caption = label && label.trim() ? label : watchUrl;
  return (
    `<a href="${escapeAttr(watchUrl)}" class="pdf-youtube">` +
    `<span class="pdf-youtube-thumb-wrap">` +
    `<img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(caption)}" class="pdf-youtube-thumb" />` +
    `<span class="pdf-youtube-play">▶</span>` +
    `</span>` +
    `<span class="pdf-youtube-caption">▶ YouTube에서 보기 — ${escapeHtml(caption)}</span>` +
    `</a>`
  );
}

/**
 * Walks the raw markdown once, resolving everything that needs a network
 * round-trip or can't survive as plain text in a static document — embedded
 * images (media token refreshed), attached-file links (resolved to a real,
 * directly downloadable presigned URL), in-app folder links (dropped, since
 * they're meaningless outside the app), and YouTube links (swapped for a
 * clickable thumbnail, since an iframe player can't exist in a PDF) — before
 * any HTML-escaping happens. Matches are replaced with plain-ASCII
 * placeholders that pass through escaping and the regex-based markdown
 * formatting below untouched, then swapped for their real HTML at the end.
 */
async function resolveEmbeds(markdown) {
  const embeds = new Map();
  let counter = 0;
  const placeholder = (html) => {
    const key = `@@PDF_EMBED_${counter++}@@`;
    embeds.set(key, html);
    return key;
  };

  let text = markdown || '';

  // 1. Attached-file links -> resolve to a real, self-contained presigned
  // download URL (valid ~1hr from export time; the API route itself only
  // returns JSON to an authenticated fetch, so the raw route is useless here).
  const downloadLinkRe = /\[([^\]]*)\]\((\/api\/storage\/presigned-download\/[^)\s]+)\)/g;
  for (const m of [...text.matchAll(downloadLinkRe)]) {
    const [full, label, href] = m;
    const idMatch = href.match(/\/api\/storage\/presigned-download\/([^/?]+)/);
    let html;
    try {
      const { download_url } = await getPresignedDownloadUrl(idMatch[1]);
      html = `<a href="${escapeAttr(download_url)}" class="pdf-attachment-link">📎 ${escapeHtml(label)}</a>`;
    } catch (e) {
      html = `<span class="pdf-attachment-broken">📎 ${escapeHtml(label)} (다운로드 링크 생성 실패 — 앱에서 다시 시도하세요)</span>`;
    }
    text = text.split(full).join(placeholder(html));
  }

  // 2. In-app folder navigation links -> plain text, the link target doesn't exist outside the app.
  text = text.replace(/\[([^\]]*)\]\(folder:[^)\s]*\)/g, (full, label) => placeholder(escapeHtml(label)));

  // 3. Markdown images -> refresh the media token and embed for real.
  const imageRe = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  const imageMatches = [...text.matchAll(imageRe)];
  if (imageMatches.length) {
    await ensureMediaToken();
  }
  for (const m of imageMatches) {
    const [full, alt, href] = m;
    const idMatch = href.match(/\/api\/storage\/preview\/([^/?]+)/);
    const freshUrl = idMatch ? getMediaPreviewUrl(idMatch[1]) : href;
    const html = `<img src="${escapeAttr(freshUrl)}" alt="${escapeAttr(alt)}" class="pdf-image" />`;
    text = text.split(full).join(placeholder(html));
  }

  // 4. Links whose target is a YouTube URL -> thumbnail + working link.
  text = text.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (full, label, href) => {
    const ytId = extractYouTubeId(href);
    if (ytId) return placeholder(youtubeEmbedHtml(ytId, label));
    return placeholder(`<a href="${escapeAttr(href)}" class="pdf-link">${escapeHtml(label)}</a>`);
  });

  // 5. Bare URLs pasted directly into the text (how a YouTube link normally
  // gets attached — see InsertFileModal's handleInsertYoutube) -> same treatment.
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, (full, pre, href) => {
    const ytId = extractYouTubeId(href);
    if (ytId) return pre + placeholder(youtubeEmbedHtml(ytId, null));
    return pre + placeholder(`<a href="${escapeAttr(href)}" class="pdf-link">${escapeHtml(href)}</a>`);
  });

  return { text, embeds };
}

const formatMarkdown = (md) => {
  if (!md) return '<p><em>(내용 없음)</em></p>';
  let html = escapeHtml(md);

  // Code blocks
  html = html.replace(/```([a-zA-Z]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code>${code}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^&gt; (.*$)/gim, '<blockquote>$1</blockquote>');

  // Unordered Lists
  html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br/>');

  return `<div class="md-body"><p>${html}</p></div>`;
};

export const exportMarkdownToPdf = async (title, content) => {
  const docTitle = title || '문서';
  const { text: placeholderText, embeds } = await resolveEmbeds(content);

  let bodyHtml = formatMarkdown(placeholderText);
  for (const [key, html] of embeds) {
    bodyHtml = bodyHtml.split(key).join(html);
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(docTitle)}</title>
      <style>
        @page {
          size: A4;
          margin: 18mm 16mm;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #111827;
          line-height: 1.65;
          font-size: 10.5pt;
          margin: 0;
          padding: 0;
        }
        .header-meta {
          border-bottom: 1.5px solid #e5e7eb;
          padding-bottom: 8px;
          margin-bottom: 20px;
          display: flex;
          justify-content: space-between;
          font-size: 8.5pt;
          color: #6b7280;
        }
        .doc-title {
          font-size: 22pt;
          font-weight: 800;
          color: #111827;
          margin-top: 0;
          margin-bottom: 18px;
          line-height: 1.25;
        }
        h1 {
          font-size: 18pt;
          font-weight: 700;
          color: #111827;
          margin-top: 22px;
          margin-bottom: 12px;
          border-bottom: 1px solid #e5e7eb;
          padding-bottom: 6px;
        }
        h2 {
          font-size: 14pt;
          font-weight: 700;
          color: #1f2937;
          margin-top: 18px;
          margin-bottom: 10px;
        }
        h3 {
          font-size: 12pt;
          font-weight: 600;
          color: #374151;
          margin-top: 14px;
          margin-bottom: 8px;
        }
        p {
          margin: 8px 0;
        }
        code {
          font-family: "JetBrains Mono", Consolas, Monaco, monospace;
          background-color: #f3f4f6;
          padding: 2px 5px;
          border-radius: 4px;
          font-size: 9pt;
          border: 1px solid #e5e7eb;
        }
        pre {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          margin: 12px 0;
        }
        pre code {
          background: none;
          border: none;
          padding: 0;
        }
        blockquote {
          margin: 12px 0;
          padding: 8px 14px;
          border-left: 3.5px solid #3b82f6;
          background: #f8fafc;
          color: #4b5563;
        }
        ul, ol {
          margin: 8px 0;
          padding-left: 22px;
        }
        li {
          margin: 4px 0;
        }
        .pdf-image {
          max-width: 100%;
          border-radius: 6px;
          margin: 10px 0;
          display: block;
        }
        .pdf-link, .pdf-attachment-link {
          color: #2563eb;
          text-decoration: none;
          border-bottom: 1px solid rgba(37, 99, 235, 0.4);
        }
        .pdf-attachment-link {
          font-weight: 600;
        }
        .pdf-attachment-broken {
          color: #b45309;
          font-style: italic;
        }
        .pdf-youtube {
          display: inline-block;
          margin: 10px 0;
          text-decoration: none;
          color: #111827;
        }
        .pdf-youtube-thumb-wrap {
          position: relative;
          display: block;
          max-width: 360px;
        }
        .pdf-youtube-thumb {
          width: 100%;
          display: block;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        .pdf-youtube-play {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 44px;
          height: 44px;
          line-height: 44px;
          text-align: center;
          background: rgba(17, 24, 39, 0.75);
          color: #fff;
          border-radius: 50%;
          font-size: 16pt;
        }
        .pdf-youtube-caption {
          display: block;
          margin-top: 4px;
          font-size: 9pt;
          font-weight: 600;
          color: #2563eb;
        }
      </style>
    </head>
    <body>
      <div class="header-meta">
        <span>Finder Knowledge Base</span>
        <span>출력일자: ${new Date().toLocaleDateString()}</span>
      </div>
      <div class="doc-title">${escapeHtml(docTitle)}</div>
      <div class="content">
        ${bodyHtml}
      </div>
    </body>
    </html>
  `);
  doc.close();

  // Wait for any images (attachments, YouTube thumbnails) to finish loading
  // (or fail) before opening the print dialog, so they aren't blank in the
  // resulting PDF — a fixed delay alone can't account for network latency.
  const images = Array.from(doc.images || []);
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }));

  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 2500);
  }, 200);
};
