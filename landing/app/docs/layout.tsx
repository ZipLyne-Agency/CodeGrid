import type { ReactNode } from "react";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc } from "@/components/docs-toc";

export default function DocsLayout({ children }: { children: ReactNode }) {
  // Viewport-locked docs shell — the page itself never scrolls. The nav and
  // left sidebar stay pinned; #docs-scroll is the single scroll region. The
  // structural layout lives in globals.css (.docs-shell / .docs-body / etc.).
  return (
    <div className="docs-shell bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="docs-body">
        <DocsSidebar />
        <div id="docs-scroll" className="docs-pane">
          <div className="flex flex-col" style={{ minHeight: "100%" }}>
            <div className="flex flex-1 gap-10">
              <article className="min-w-0 flex-1 xl:max-w-3xl pb-20">{children}</article>
              <DocsToc />
            </div>
            <SiteFooter />
          </div>
        </div>
      </div>
    </div>
  );
}
