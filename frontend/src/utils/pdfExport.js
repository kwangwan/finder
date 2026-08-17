/**
 * Markdown to PDF Export Utility
 * Opens a formatted print frame styled specifically for high-quality A4 PDF generation.
 */
export const exportMarkdownToPdf = (title, content) => {
  const docTitle = title || '문서';
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;

  const escapeHtml = (str) => {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

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
    html = html.replace(/^\&gt; (.*$)/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/^&gt; (.*$)/gim, '<blockquote>$1</blockquote>');

    // Unordered Lists
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');

    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br/>');

    return `<div class="md-body"><p>${html}</p></div>`;
  };

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
      </style>
    </head>
    <body>
      <div class="header-meta">
        <span>Finder Knowledge Base</span>
        <span>출력일자: ${new Date().toLocaleDateString()}</span>
      </div>
      <div class="doc-title">${escapeHtml(docTitle)}</div>
      <div class="content">
        ${formatMarkdown(content)}
      </div>
    </body>
    </html>
  `);
  doc.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 2500);
  }, 300);
};
