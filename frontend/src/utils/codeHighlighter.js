/**
 * Colour for code blocks, fetched only when there is code to colour.
 *
 * Shiki reads the same TextMate grammars VS Code does, which is why it gets
 * the colours right and also why it is big: one language is tens to hundreds
 * of kilobytes of JSON, and the whole set is several megabytes — more than
 * this entire app. So nothing here is imported at the top of the file:
 *
 * - the engine, the theme and Shiki itself arrive when a document holding a
 *   code block is first opened,
 * - each language's grammar arrives when a block actually written in that
 *   language is on screen, and never again.
 *
 * A document with no code block downloads none of it.
 */

// The languages offered in the code block's picker (CODE_BLOCK_LANGUAGES in
// useNoteEditor.js), each with the import that fetches its grammar. Written
// out rather than built from a template because a bundler has to be able to
// see every import to give it a file of its own.
const GRAMMARS = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  python: () => import('@shikijs/langs/python'),
  r: () => import('@shikijs/langs/r'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
};

let highlighterPromise = null;

/**
 * The highlighter, made once and shared by every editor on the page.
 *
 * One theme, a dark one, because a code block here is always dark. Handing
 * Shiki both a light and a dark theme would make it write colours as CSS
 * variables for something else to choose between, which is work for a choice
 * that isn't offered.
 */
export function createCodeHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = build().catch((error) => {
      // Colour is not worth breaking an editor over: forgotten, so the next
      // document may try again, and the code stays readable in the meantime.
      console.warn('[Code] syntax highlighting unavailable:', error);
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

async function build() {
  const [{ createHighlighterCore }, { createOnigurumaEngine }, theme] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/oniguruma'),
    import('@shikijs/themes/github-dark'),
  ]);

  const highlighter = await createHighlighterCore({
    themes: [theme],
    langs: [],
    engine: createOnigurumaEngine(() => import('shiki/wasm')),
  });

  // BlockNote asks for a language the moment it meets one it has not loaded,
  // and remembers a refusal so it does not ask twice. That is the hook this
  // uses to fetch one grammar at a time.
  const loadGrammar = highlighter.loadLanguage.bind(highlighter);
  highlighter.loadLanguage = async (language) => {
    const grammar = GRAMMARS[language];
    if (!grammar) {
      throw new Error(`no grammar for ${language}`);
    }
    return loadGrammar(await grammar());
  };

  return highlighter;
}
