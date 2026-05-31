import { redirect } from "next/navigation";

/**
 * The policy now lives inside the unified treasury terminal at
 * /token/treasury (press `5` or click "$ cat POLICY.md"). This route is
 * preserved as a 308 permanent redirect for inbound links and SEO, landing
 * bookmarked policy URLs directly on the policy view.
 */
export default function PolicyRedirect(): never {
  redirect("/token/treasury?view=policy");
}
