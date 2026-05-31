import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "CodeGrid terms of service. CodeGrid is free and open source under the MIT license. Covers the license grant, acceptable use, intellectual property, warranty disclaimer, and governing law for the CodeGrid desktop application by ZipLyne LLC.",
  alternates: {
    canonical: "https://www.codegrid.app/terms",
  },
};

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-2">
          Terms of Service
        </h1>
        <p className="font-mono text-xs text-text-secondary mb-12">
          Last updated: March 26, 2026
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-text-primary">
          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using CodeGrid (&quot;the Software&quot;), the website at
              codegrid.app (&quot;the Website&quot;), or any related services provided by
              ZipLyne LLC (&quot;Company,&quot; &quot;we,&quot; &quot;us&quot;), you agree to be bound by
              these Terms of Service. If you do not agree, do not use the Software.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              2. Description of Service
            </h2>
            <p>
              CodeGrid is a desktop application for macOS that provides a 2D canvas
              for managing multiple terminal sessions. The Software is distributed as
              a downloadable binary and operates entirely on your local machine.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              3. Free &amp; Open Source
            </h2>
            <p>
              The CodeGrid desktop application is free and open source under the MIT
              license — no account, license keys, or purchase required, and its source
              code is published publicly on GitHub. We may separately offer optional
              hosted, team, or premium services in the future; any such service would be
              governed by its own terms, and the desktop application will remain free and
              open source.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              4. License Grant (MIT)
            </h2>
            <p>
              CodeGrid is licensed under the MIT License. ZipLyne LLC grants you, free
              of charge, permission to use, copy, modify, merge, publish, distribute,
              and build on the Software, subject to the conditions of the MIT License,
              including retaining the copyright and permission notice. The full license
              text is included with the source code.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              5. Acceptable Use
            </h2>
            <p>You agree to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Use the Software in compliance with all applicable laws</li>
              <li>Retain the MIT copyright and permission notice in copies you distribute</li>
              <li>Not use the Software for any unlawful purpose</li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              6. No Payments
            </h2>
            <p>
              CodeGrid is provided free of charge. We do not collect payments, process
              subscriptions, or issue license keys. If you experience technical issues,
              contact us at admin@codegrid.dev or open an issue on GitHub.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              7. Intellectual Property &amp; Open Source
            </h2>
            <p>
              CodeGrid&apos;s source code is released as open source under the MIT License,
              and your rights to the code are governed by that license. The
              &quot;CodeGrid&quot; and &quot;ZipLyne&quot; names, logos, and brand marks remain the
              property of ZipLyne LLC, and these Terms do not grant you any rights to
              those trademarks, service marks, or trade names.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              8. $GRID Token
            </h2>
            <p>
              A community token called &quot;$GRID&quot; exists today on the Base
              network. $GRID is entirely independent of the MIT-licensed CodeGrid
              application: it is not part of the Software, is not required to download
              or use the Software, and the Software&apos;s MIT license terms apply
              regardless of whether you hold any $GRID. $GRID is not an investment, a
              security, or a means of payment for CodeGrid. Holding $GRID conveys no
              ownership, equity, revenue share, profit share, governance rights, or
              entitlement to any return, dividend, or distribution of any kind. We make
              no promises regarding its price, value, liquidity, or future utility.
              Anything affecting the token is described in the public{" "}
              <a
                href="/token/treasury?view=policy"
                className="text-accent hover:underline"
              >
                $GRID treasury policy
              </a>
              . Nothing in these Terms or on this site is financial, legal, or tax
              advice.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              9. Disclaimer of Warranties
            </h2>
            <p>
              THE SOFTWARE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
              WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT
              LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, AND NON-INFRINGEMENT. ZIPLYNE LLC DOES NOT WARRANT
              THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL
              COMPONENTS.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              10. Limitation of Liability
            </h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, ZIPLYNE LLC SHALL NOT BE LIABLE
              FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
              DAMAGES, OR ANY LOSS OF PROFITS, DATA, USE, OR GOODWILL, ARISING OUT OF
              OR IN CONNECTION WITH YOUR USE OF THE SOFTWARE. BECAUSE THE SOFTWARE IS
              PROVIDED FREE OF CHARGE, OUR TOTAL LIABILITY SHALL IN NO EVENT EXCEED
              ZERO DOLLARS ($0).
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              11. Term
            </h2>
            <p>
              Your rights to the source code under the MIT License are perpetual and
              irrevocable so long as you comply with that license. Sections regarding
              intellectual property, disclaimers, limitation of liability, and
              governing law survive any discontinuation of the Software.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              12. Governing Law
            </h2>
            <p>
              These Terms shall be governed by and construed in accordance with the
              laws of the State of Delaware, United States, without regard to its
              conflict of law provisions. Any disputes arising under these Terms shall
              be resolved in the state or federal courts located in Delaware.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              13. Changes to Terms
            </h2>
            <p>
              We reserve the right to modify these Terms at any time. Changes will be
              posted on this page with an updated &quot;Last updated&quot; date. Your continued
              use of the Software after changes constitutes acceptance of the revised
              Terms.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">
              14. Contact
            </h2>
            <p>
              If you have questions about these Terms, contact us at{" "}
              <a
                href="mailto:admin@codegrid.dev"
                className="text-accent hover:underline"
              >
                admin@codegrid.dev
              </a>
              .
            </p>
          </section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
