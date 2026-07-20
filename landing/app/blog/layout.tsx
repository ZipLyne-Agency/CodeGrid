import type { ReactNode } from "react";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import "./blog-content.css";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="pt-12">{children}</div>
      <SiteFooter />
    </div>
  );
}
