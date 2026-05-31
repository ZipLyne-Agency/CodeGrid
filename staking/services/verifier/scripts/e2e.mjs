/**
 * Headless backend E2E. Drives the deployed staging Workers exactly as the
 * browser/desktop would, minus the wallet UI: signs a SIWE message with a test
 * key, exchanges it for an entitlement JWT, verifies the JWT offline, then
 * accrues + reads points.
 *
 * Env: PK (test private key), VERIFIER, POINTS, PUBLIC_JWK_JSON, EXPECT_TIER
 */
import {privateKeyToAccount} from "viem/accounts";
import {createSiweMessage} from "viem/siwe";
import {jwtVerify, importJWK} from "jose";

const {PK, VERIFIER, POINTS, PUBLIC_JWK_JSON, EXPECT_TIER} = process.env;
const account = privateKeyToAccount(PK);
const addr = account.address;
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

// 1. health
const vh = await (await fetch(`${VERIFIER}/health`)).json();
const ph = await (await fetch(`${POINTS}/health`)).json();
check("verifier /health", vh.ok === true);
check("points /health", ph.ok === true);

// 2. public tier read
const tierRead = await (await fetch(`${VERIFIER}/tier/${addr}`)).json();
check("verifier /tier reads on-chain tier", tierRead.tier === Number(EXPECT_TIER), `got tier ${tierRead.tier}, power ${tierRead.power}`);

// 3. nonce → SIWE → verify
const {nonce} = await (await fetch(`${VERIFIER}/nonce`)).json();
check("verifier /nonce issues nonce", typeof nonce === "string" && nonce.length > 0);

const message = createSiweMessage({
  address: addr,
  chainId: 84532,
  domain: "codegrid.app",
  nonce,
  uri: "https://codegrid.app",
  version: "1",
  statement: "Sign in to link your CodeGrid premium entitlement.",
});
const signature = await account.signMessage({message});
const verifyRes = await fetch(`${VERIFIER}/verify`, {
  method: "POST",
  headers: {"content-type": "application/json"},
  body: JSON.stringify({message, signature}),
});
const verifyJson = await verifyRes.json();
check("verifier /verify accepts valid SIWE", verifyRes.ok && !!verifyJson.token, JSON.stringify(verifyJson).slice(0, 120));
check("verify returns correct tier", verifyJson.tier === Number(EXPECT_TIER), `tier ${verifyJson.tier}`);

// 4. offline JWT verification (what the desktop app does)
const token = verifyJson.token;
let decoded = null;
try {
  const key = await importJWK(JSON.parse(PUBLIC_JWK_JSON), "EdDSA");
  const {payload} = await jwtVerify(token, key, {issuer: "https://codegrid.app", audience: "codegrid-desktop"});
  decoded = payload;
} catch (e) {
  /* leave null */
}
check("JWT verifies offline against public key", !!decoded);
check("JWT subject = signer address", decoded?.sub?.toLowerCase() === addr.toLowerCase());
check("JWT tier claim matches", Number(decoded?.tier) === Number(EXPECT_TIER));

// 5. nonce replay is rejected
const replay = await fetch(`${VERIFIER}/verify`, {
  method: "POST",
  headers: {"content-type": "application/json"},
  body: JSON.stringify({message, signature}),
});
check("nonce replay is rejected", replay.status === 401);

// 6. tampered token rejected
const tampered = token.slice(0, -3) + (token.slice(-3) === "aaa" ? "bbb" : "aaa");
const badTier = await fetch(`${POINTS}/heartbeat`, {
  method: "POST",
  headers: {"content-type": "application/json", authorization: `Bearer ${tampered}`},
  body: JSON.stringify({usageUnits: 5}),
});
check("points rejects tampered JWT", badTier.status === 401);

// 7. points heartbeat with valid JWT
const hb = await fetch(`${POINTS}/heartbeat`, {
  method: "POST",
  headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
  body: JSON.stringify({usageUnits: 5}),
});
const hbJson = await hb.json();
check("points /heartbeat accrues", hb.ok && hbJson.accrued > 0, `accrued ${hbJson.accrued?.toFixed?.(2)} (mult ${hbJson.multiplier?.toFixed?.(2)})`);

// 8. leaderboard + points read
const lb = await (await fetch(`${POINTS}/leaderboard`)).json();
check("leaderboard includes signer", (lb.leaderboard ?? []).some((r) => r.address?.toLowerCase() === addr.toLowerCase()));
const pts = await (await fetch(`${POINTS}/points/${addr}`)).json();
check("points read returns total + rank", pts.points > 0 && pts.rank >= 1, `points ${pts.points?.toFixed?.(2)}, rank ${pts.rank}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
