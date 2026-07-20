/**
 * Generate an Ed25519 keypair for entitlement JWTs.
 *
 *   node scripts/gen-keys.mjs
 *
 * Prints a PRIVATE JWK (→ Worker secret JWT_PRIVATE_JWK, store in Infisical)
 * and a PUBLIC JWK (→ wrangler.toml vars PUBLIC_JWK + bundle into the desktop
 * app for offline verification). The private key NEVER leaves the Worker.
 */
import {generateKeyPair, exportJWK} from "jose";

const {publicKey, privateKey} = await generateKeyPair("EdDSA", {crv: "Ed25519", extractable: true});
const pub = await exportJWK(publicKey);
const priv = await exportJWK(privateKey);
const kid = crypto.randomUUID();
pub.kid = kid;
priv.kid = kid;
pub.alg = priv.alg = "EdDSA";

console.log("\n=== PRIVATE JWK  → `wrangler secret put JWT_PRIVATE_JWK` (store in Infisical) ===");
console.log(JSON.stringify(priv));
console.log("\n=== PUBLIC JWK   → wrangler.toml [vars] PUBLIC_JWK + desktop app bundle ===");
console.log(JSON.stringify(pub));
console.log("\nkid:", kid, "\n");
