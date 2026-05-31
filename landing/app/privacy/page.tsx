import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "CodeGrid privacy policy. CodeGrid is free and open source and requires no account, purchase, or license. The desktop app collects no personal data, telemetry, or analytics. Your work stays on your machine.",
  alternates: {
    canonical: "https://www.codegrid.app/privacy",
  },
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-2">
          Privacy Policy
        </h1>
        <p className="font-mono text-xs text-text-secondary mb-12">
          Last updated: March 26, 2026
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-text-primary">
          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              1. Introduction
            </h2>
            <p>
              ZipLyne LLC (&quot;Company,&quot; &quot;we,&quot; &quot;us&quot;), a limited
              liability company organized under the laws of the State of Delaware,
              United States, is the data controller. It operates the CodeGrid desktop
              application and the website at codegrid.app. This Privacy Policy explains
              what data we collect, how we use it, and your rights regarding that data.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              2. Data We Collect
            </h2>
            <p className="mb-3">
              CodeGrid is free and open source. It requires no account, purchase, or
              license, so we collect almost nothing:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>No account or payment data</strong> &mdash; there is no sign-up,
                no purchase, and no license key. We do not collect your email, payment
                information, or a machine identifier to use the app.
              </li>
              <li>
                <strong>Support correspondence</strong> &mdash; if you choose to email us
                or open a GitHub issue, we receive whatever information you include in
                that message.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              3. Data We Do Not Collect
            </h2>
            <p>
              CodeGrid is a local-first application. The desktop app does not include
              any telemetry, analytics, tracking, or crash reporting. We do not
              collect usage data, keystrokes, terminal output, file contents, or any
              information about how you use the application. Your work stays on your
              machine.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              4. How We Use Your Data
            </h2>
            <ul className="list-disc list-inside space-y-2">
              <li>To respond to support requests you send us</li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              5. Third-Party Services
            </h2>
            <p className="mb-3">
              The CodeGrid website and downloads rely on the following third-party
              services:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>GitHub</strong> &mdash; hosts the open-source code and serves
                application downloads via GitHub Releases, under GitHub&apos;s own
                privacy policy.
              </li>
              <li>
                <strong>Vercel</strong> &mdash; hosts this website and provides
                privacy-friendly, aggregate visitor analytics for the site (not the
                desktop app), under Vercel&apos;s own privacy policy.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              6. Data Retention
            </h2>
            <p>
              We do not maintain accounts, license records, or payment records. We
              retain support correspondence only as long as needed to resolve your
              request. You may request deletion of any correspondence by contacting us
              at admin@codegrid.dev.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              7. Data Security
            </h2>
            <p>
              CodeGrid is local-first and open source — its full source code is public
              and auditable. The website is served over HTTPS. While we implement
              reasonable security measures, no method of transmission or storage is
              100% secure.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              8. Your Rights Under GDPR
            </h2>
            <p>
              If you are located in the European Economic Area (EEA), you have the
              right to:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to or restrict processing of your data</li>
              <li>Request data portability</li>
              <li>Withdraw consent at any time</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at{" "}
              <a
                href="mailto:admin@codegrid.dev"
                className="text-accent hover:underline"
              >
                admin@codegrid.dev
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              9. Your Rights Under CCPA
            </h2>
            <p>
              If you are a California resident, you have the right to:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Know what personal information we collect and how it is used</li>
              <li>Request deletion of your personal information</li>
              <li>Opt out of the sale of your personal information</li>
              <li>Not be discriminated against for exercising your rights</li>
            </ul>
            <p className="mt-3">
              We do not sell your personal information. To submit a request, contact
              us at{" "}
              <a
                href="mailto:admin@codegrid.dev"
                className="text-accent hover:underline"
              >
                admin@codegrid.dev
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              10. Children&apos;s Privacy
            </h2>
            <p>
              CodeGrid is not directed at children under the age of 13. We do not
              knowingly collect personal information from children. If we become aware
              that a child under 13 has provided us with personal data, we will take
              steps to delete it.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              11. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be
              posted on this page with an updated &quot;Last updated&quot; date. Your continued
              use of CodeGrid after changes constitutes acceptance of the revised
              policy.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              12. Contact
            </h2>
            <p>
              For privacy-related questions or requests, contact us at{" "}
              <a
                href="mailto:admin@codegrid.dev"
                className="text-accent hover:underline"
              >
                admin@codegrid.dev
              </a>
              .
            </p>
            <p className="mt-3">
              ZipLyne LLC
              <br />
              codegrid.app
            </p>
          </section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
