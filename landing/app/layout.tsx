import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk, Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

/* Three-role type system (Linear's own model: Display / Text / Mono):
   - Space Grotesk  → display headings (engineered, characterful, pairs with mono)
   - Geist          → body / long-form text (highly readable, modern)
   - JetBrains Mono → the brand signature: labels, code, terminal, data, nav   */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.codegrid.app"),
  title: {
    default: "CodeGrid — An army of coding agents. A canvas per project.",
    template: "%s | CodeGrid",
  },
  description:
    "Give every project its own infinite canvas, then run Claude, Codex, Gemini, Grok, Cursor & shells side by side. Drag, resize, zoom, and switch projects with a keystroke. Free for macOS.",
  keywords: [
    "Claude Code",
    "Codex",
    "Gemini",
    "Grok",
    "Cursor",
    "AI agents",
    "terminal manager",
    "developer tools",
    "Tauri",
    "workspace",
    "parallel AI coding",
    "AI coding workspace",
    "multi-agent terminal",
    "macOS developer tools",
    "AI terminal manager",
    "coding canvas",
  ],
  applicationName: "CodeGrid",
  authors: [{ name: "ZipLyne LLC", url: "https://www.codegrid.app" }],
  creator: "ZipLyne LLC",
  publisher: "ZipLyne LLC",
  category: "Developer Tools",
  alternates: {
    canonical: "https://www.codegrid.app",
  },
  openGraph: {
    title: "CodeGrid — An army of coding agents. A canvas per project.",
    description:
      "Give every project its own infinite canvas, then run Claude, Codex, Gemini, Grok, Cursor & shells side by side. Drag, resize, zoom, and switch projects with a keystroke. Free for macOS.",
    type: "website",
    siteName: "CodeGrid",
    url: "https://www.codegrid.app",
    locale: "en_US",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "CodeGrid — Terminal workspace manager for AI coding agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CodeGrid — An army of coding agents. A canvas per project.",
    description:
      "Give every project its own infinite canvas, then run Claude, Codex, Gemini, Grok, Cursor & shells side by side. Drag, resize, zoom, and switch projects with a keystroke. Free for macOS.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  other: {
    "theme-color": "#0a0a0a",
  },
};

/* ------------------------------------------------------------------ */
/*  JSON-LD structured data (global)                                   */
/* ------------------------------------------------------------------ */

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ZipLyne",
  legalName: "ZipLyne LLC",
  url: "https://www.codegrid.app",
  logo: "https://www.codegrid.app/icon-512.png",
  foundingDate: "2025-02-03",
  founder: {
    "@type": "Person",
    name: "Isaac Horowitz",
    sameAs: "https://www.linkedin.com/in/iowitz/",
  },
  address: {
    "@type": "PostalAddress",
    streetAddress: "30 N Gould St, Ste N",
    addressLocality: "Sheridan",
    addressRegion: "WY",
    postalCode: "82801",
    addressCountry: "US",
  },
  sameAs: [
    "https://github.com/ZipLyne-Agency/CodeGrid",
    "https://www.linkedin.com/in/iowitz/",
  ],
  contactPoint: {
    "@type": "ContactPoint",
    email: "admin@codegrid.dev",
    contactType: "customer support",
  },
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "CodeGrid",
  description:
    "Give every project its own infinite canvas, then run Claude, Codex, Gemini, Grok, Cursor & shells side by side. Drag, resize, zoom, and switch projects with a keystroke. Free for macOS.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS",
  processorRequirements: "Apple Silicon (M1 or later)",
  url: "https://www.codegrid.app",
  downloadUrl: "https://www.codegrid.app/download",
  screenshot: "https://www.codegrid.app/og.png",
  softwareVersion: "1.0",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    name: "Free & open source",
    description: "Free and open source macOS desktop app — all 5 AI agents, multiple parallel sessions, Git manager, MCP server management, GitHub repo browser, and attention detection.",
  },
  featureList: [
    "Run Claude, Codex, Gemini, Grok, Cursor, and shell agents side by side",
    "2D canvas with drag-and-resize terminal panes",
    "Layout presets: Auto, Focus, Columns, Rows, Grid",
    "Attention detection for agent prompts and approvals",
    "Built-in Git integration with staging, commits, branches",
    "Browser panes on the canvas",
    "File tree and project search",
    "GitHub repo browser and clone",
    "Multiple workspaces with saved layouts",
    "Command palette (Cmd+K)",
  ],
};

const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "CodeGrid",
  url: "https://www.codegrid.app",
  description:
    "CodeGrid is a macOS desktop application for running multiple AI coding agents in parallel on a 2D canvas workspace.",
  publisher: {
    "@type": "Organization",
    name: "ZipLyne LLC",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} ${spaceGrotesk.variable} ${geist.variable} antialiased`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0a0a0a" />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="CodeGrid Blog — RSS"
          href={`${process.env.MENTIONWELL_API_URL}/api/sites/${process.env.MENTIONWELL_SITE_SLUG}/feed.xml`}
        />
        <link
          rel="alternate"
          type="application/feed+json"
          title="CodeGrid Blog — JSON Feed"
          href={`${process.env.MENTIONWELL_API_URL}/api/sites/${process.env.MENTIONWELL_SITE_SLUG}/feed.json`}
        />
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="preconnect" href="https://image.mux.com" />
        <link rel="dns-prefetch" href="//stream.mux.com" />
        <link rel="dns-prefetch" href="//image.mux.com" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
        />
      </head>
      <body className="min-h-screen">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
