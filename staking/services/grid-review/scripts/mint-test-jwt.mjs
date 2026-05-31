/**
 * Mint a self-contained test entitlement JWT for LOCAL grid-review testing.
 *
 * Generates a throwaway Ed25519 keypair, prints the matching PUBLIC_JWK (to drop
 * into `.dev.vars`) and a signed tier-1 token, so you can exercise the worker's
 * auth + review loop without staking on-chain or holding the real signing key.
 *
 *   node scripts/mint-test-jwt.mjs [tier]
 *
 * Then:
 *   echo 'PUBLIC_JWK={...}'  >> .dev.vars     # the printed public JWK (one line)
 *   echo 'REVIEW_DRY_RUN=1'  >> .dev.vars     # skip the provider call
 *   wrangler dev
 *   curl -s localhost:8787/review \
 *     -H "Authorization: Bearer <TOKEN>" -H 'content-type: application/json' \
 *     -d '{"diff":"--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new"}'
 */
import {generateKeyPair, exportJWK, SignJWT} from "jose";

const tier = Number(process.argv[2] ?? "1");
const ISSUER = "https://codegrid.app";
const AUDIENCE = "codegrid-desktop";
const ADDRESS = "0x000000000000000000000000000000000000dEaD";

const {publicKey, privateKey} = await generateKeyPair("EdDSA", {crv: "Ed25519", extractable: true});
const pub = await exportJWK(publicKey);
const kid = crypto.randomUUID();
pub.kid = kid;
pub.alg = "EdDSA";

const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({tier, power: "0", addr: ADDRESS})
  .setProtectedHeader({alg: "EdDSA", kid})
  .setIssuer(ISSUER)
  .setAudience(AUDIENCE)
  .setSubject(ADDRESS)
  .setIssuedAt(now)
  .setExpirationTime(now + 3600)
  .sign(privateKey);

console.log("# Add this line to .dev.vars (single line):");
console.log(`PUBLIC_JWK=${JSON.stringify(pub)}`);
console.log("");
console.log("# Tier-" + tier + " bearer token (valid 1h):");
console.log(token);
