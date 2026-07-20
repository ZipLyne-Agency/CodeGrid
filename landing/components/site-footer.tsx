import { BrandLogo } from "@/components/brand-logo";

const GITHUB = "https://github.com/ZipLyne-Agency/CodeGrid";
const LINKEDIN = "https://www.linkedin.com/in/iowitz/";

const columns: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Docs", href: "/docs" },
      { label: "Changelog", href: "/changelog" },
      { label: "Download for Mac", href: "/download" },
      { label: "Source on GitHub", href: GITHUB, external: true },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About ZipLyne", href: "/about" },
      { label: "Founder", href: "/founder" },
      { label: "Careers", href: "/careers" },
      { label: "Blog", href: "/blog" },
      { label: "Press & Brand", href: "/press" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { label: "Security", href: "/security" },
      { label: "Responsible AI", href: "/responsible-ai" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border bg-bg-secondary">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px rule-accent opacity-60" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div className="flex flex-col gap-3">
            <BrandLogo size="sm" />
            <p className="text-text-secondary text-xs leading-relaxed max-w-[14rem]">
              A native macOS workspace for running many AI coding agents in parallel. Free, open
              source, local-first.
            </p>
            <div className="mt-1 inline-flex items-center gap-2 font-mono text-[11px] text-text-secondary w-fit">
              <span className="round-full w-1.5 h-1.5 bg-status-running" />
              Free &amp; open source · local-first
            </div>
            <div className="flex gap-4 mt-1 text-xs font-mono text-text-secondary">
              <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">GitHub</a>
              <a href={LINKEDIN} target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">LinkedIn</a>
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3">
              <div className="font-mono text-[10px] font-bold tracking-widest text-text-secondary uppercase">
                {col.heading}
              </div>
              <ul className="flex flex-col gap-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="font-mono text-xs text-text-secondary hover:text-accent transition-colors"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Legal line */}
        <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-mono text-[11px] text-text-secondary">
          <span>&copy; {new Date().getFullYear()} ZipLyne LLC. A Wyoming limited liability company.</span>
          <span className="flex items-center gap-4">
            <span>Built with Tauri + React</span>
            <a href="mailto:admin@codegrid.dev" className="hover:text-accent transition-colors">admin@codegrid.dev</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
