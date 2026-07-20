import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    sourcemap: false,
    minify: "esbuild",
    // Raise the warning threshold a little — we still want the warning to fire
    // if we regress, but Vite's default 500 KB is aggressive for a desktop app
    // that loads bundles from disk, not the network.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Vendor splits keep heavy libs out of the main chunk so updates ship
        // smaller diffs and cold paint hits a thinner bootstrap.
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("scheduler")) {
              return "vendor-react";
            }
            if (id.includes("@xterm/")) return "vendor-xterm";
            // Keep CodeMirror's core/state/view (always needed if any pack
            // loads) together, but let each `lang-*` pack become its own
            // chunk so we ship only what the user actually opens.
            if (id.includes("@codemirror/lang-") || id.includes("@lezer/")) {
              const m = id.match(/@codemirror\/lang-([a-z]+)/) ?? id.match(/@lezer\/([a-z]+)/);
              return m ? `cm-lang-${m[1]}` : "vendor-codemirror";
            }
            if (id.includes("@codemirror/") || id.includes("@uiw/react-codemirror")) {
              return "vendor-codemirror";
            }
            if (id.includes("vscode-material-icons")) return "vendor-icons";
            if (id.includes("@tauri-apps/")) return "vendor-tauri";
            // zustand: leave with main chunk (it transitively pulls React,
            // so giving it its own chunk creates a circular dep).
          }
        },
      },
    },
  },
}));
