/**
 * Lazy-loaded CodeMirror language packs.
 *
 * Each `@codemirror/lang-*` package adds 30–80 KB to the bundle and most users
 * only open one or two file types per session. We dynamic-import the pack on
 * demand and cache the result so repeated opens of the same language don't
 * re-hit the network/disk.
 */
import type { Extension } from "@codemirror/state";

type Loader = () => Promise<Extension[]>;

const cache = new Map<string, Promise<Extension[]>>();

const LOADERS: Record<string, Loader> = {
  ts:     async () => [(await import("@codemirror/lang-javascript")).javascript({ jsx: false, typescript: true })],
  tsx:    async () => [(await import("@codemirror/lang-javascript")).javascript({ jsx: true,  typescript: true })],
  js:     async () => [(await import("@codemirror/lang-javascript")).javascript({ jsx: false })],
  mjs:    async () => [(await import("@codemirror/lang-javascript")).javascript({ jsx: false })],
  cjs:    async () => [(await import("@codemirror/lang-javascript")).javascript({ jsx: false })],
  jsx:    async () => [(await import("@codemirror/lang-javascript")).javascript({ jsx: true })],
  py:     async () => [(await import("@codemirror/lang-python")).python()],
  rs:     async () => [(await import("@codemirror/lang-rust")).rust()],
  json:   async () => [(await import("@codemirror/lang-json")).json()],
  css:    async () => [(await import("@codemirror/lang-css")).css()],
  scss:   async () => [(await import("@codemirror/lang-css")).css()],
  html:   async () => [(await import("@codemirror/lang-html")).html()],
  svg:    async () => [(await import("@codemirror/lang-html")).html()],
  xml:    async () => [(await import("@codemirror/lang-html")).html()],
  vue:    async () => [(await import("@codemirror/lang-html")).html()],
  svelte: async () => [(await import("@codemirror/lang-html")).html()],
  md:     async () => [(await import("@codemirror/lang-markdown")).markdown()],
};

/** Resolve a CodeMirror language extension array for a filename. Always
 *  returns — empty array means "no syntax highlighting, plain text." */
export function loadLanguageExtension(filename: string): Promise<Extension[]> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const loader = LOADERS[ext];
  if (!loader) return Promise.resolve([]);
  let cached = cache.get(ext);
  if (!cached) {
    cached = loader().catch(() => []);
    cache.set(ext, cached);
  }
  return cached;
}
