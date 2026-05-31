/**
 * GRID entitlement verifier — Cloudflare Worker.
 *
 * Flow:
 *   1. GET  /nonce            → issue a single-use nonce (stored in KV).
 *   2. POST /verify           → { message, signature } SIWE proof.
 *                               Verify signature → recover address → read
 *                               veGRID tier on Base → mint entitlement JWT.
 *   3. GET  /tier/:address     → public, unauthenticated tier/power read (UI).
 *   4. GET  /.well-known/jwks.json → public key for offline JWT verification.
 *
 * No secrets in code. No private keys ever leave the Worker. The entitlement
 * JWT is EdDSA-signed so the desktop app verifies it offline against PUBLIC_JWK.
 */
import {Hono} from "hono";
import {cors} from "hono/cors";
import {createPublicClient, http, getAddress, type Address, type Chain} from "viem";
import {base, baseSepolia} from "viem/chains";
import {verifySiweMessage, parseSiweMessage} from "viem/siwe";
import {SignJWT, importJWK, exportJWK, type JWK} from "jose";

type Bindings = {
  NONCES: KVNamespace;
  JWT_PRIVATE_JWK: string;
  PUBLIC_JWK: string;
  BASE_RPC_URL?: string;
  VEGRID_ADDRESS: string;
  GRID_CHAIN_ID: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  JWT_TTL_SECONDS: string;
  NONCE_TTL_SECONDS: string;
};

// Minimal ABI — only the views the verifier needs.
const VEGRID_ABI = [
  {
    type: "function",
    name: "tierOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "", type: "uint8"}],
  },
  {
    type: "function",
    name: "votingPower",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "", type: "uint256"}],
  },
] as const;

const app = new Hono<{Bindings: Bindings}>();

app.use("*", cors({origin: ["https://codegrid.app", "https://www.codegrid.app", "http://localhost:3000"]}));

function rpcClient(env: Bindings) {
  const chain: Chain = env.GRID_CHAIN_ID === "84532" ? baseSepolia : base;
  return createPublicClient({
    chain,
    transport: http(env.BASE_RPC_URL || chain.rpcUrls.default.http[0]),
  });
}

async function readTier(env: Bindings, account: Address): Promise<{tier: number; power: string}> {
  const client = rpcClient(env);
  const ve = getAddress(env.VEGRID_ADDRESS) as Address;
  const [tier, power] = await Promise.all([
    client.readContract({address: ve, abi: VEGRID_ABI, functionName: "tierOf", args: [account]}),
    client.readContract({address: ve, abi: VEGRID_ABI, functionName: "votingPower", args: [account]}),
  ]);
  return {tier: Number(tier), power: power.toString()};
}

/** Issue a single-use nonce, stored in KV with a short TTL. */
app.get("/nonce", async (c) => {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const ttl = Number(c.env.NONCE_TTL_SECONDS || "300");
  await c.env.NONCES.put(`nonce:${nonce}`, "1", {expirationTtl: ttl});
  return c.json({nonce, ttl});
});

/** Verify a SIWE signature, read tier, mint an entitlement JWT. */
app.post("/verify", async (c) => {
  let body: {message?: string; signature?: `0x${string}`; state?: string};
  try {
    body = await c.req.json();
  } catch {
    return c.json({error: "invalid_json"}, 400);
  }
  const {message, signature} = body;
  if (!message || !signature) return c.json({error: "missing message or signature"}, 400);

  // Parse to pull the nonce + address, then consume the nonce (single use).
  const fields = parseSiweMessage(message);
  if (!fields.nonce || !fields.address) return c.json({error: "malformed_siwe"}, 400);

  const nonceKey = `nonce:${fields.nonce}`;
  const seen = await c.env.NONCES.get(nonceKey);
  if (!seen) return c.json({error: "nonce_expired_or_unknown"}, 401);
  await c.env.NONCES.delete(nonceKey); // burn it now to prevent replay

  const valid = await verifySiweMessage(rpcClient(c.env), {
    message,
    signature,
    nonce: fields.nonce,
  });
  if (!valid) return c.json({error: "bad_signature"}, 401);

  const address = getAddress(fields.address) as Address;
  let tier: number;
  let power: string;
  try {
    ({tier, power} = await readTier(c.env, address));
  } catch {
    return c.json({error: "tier_read_failed"}, 502);
  }

  const ttl = Number(c.env.JWT_TTL_SECONDS || "86400");
  const now = Math.floor(Date.now() / 1000);
  const privJwk = JSON.parse(c.env.JWT_PRIVATE_JWK) as JWK;
  const key = await importJWK(privJwk, "EdDSA");

  const token = await new SignJWT({tier, power, addr: address})
    .setProtectedHeader({alg: "EdDSA", kid: privJwk.kid})
    .setIssuer(c.env.JWT_ISSUER)
    .setAudience(c.env.JWT_AUDIENCE)
    .setSubject(address)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key);

  // Relay: if the desktop opened /link with a ?state, stash the result so the
  // app can poll for it — no codegrid:// deep-link or manual switch-back needed.
  if (body.state && /^[A-Za-z0-9-]{8,64}$/.test(body.state)) {
    await c.env.NONCES.put(`link:${body.state}`, JSON.stringify({token, address, tier, power}), {
      expirationTtl: 300,
    });
  }

  return c.json({token, address, tier, power, exp: now + ttl});
});

/**
 * Relay poll. The desktop opens /link?state=… then polls this (from Rust, so no
 * CORS) until the browser sign-in completes; we return the entitlement once and
 * burn it. `{pending:true}` while not ready.
 */
app.get("/link/:state", async (c) => {
  const state = c.req.param("state");
  if (!state || !/^[A-Za-z0-9-]{8,64}$/.test(state)) return c.json({pending: true});
  const raw = await c.env.NONCES.get(`link:${state}`);
  if (!raw) return c.json({pending: true});
  await c.env.NONCES.delete(`link:${state}`); // single-use
  return c.json({pending: false, ...JSON.parse(raw)});
});

/** Public tier read for the web UI (no auth, no JWT). */
app.get("/tier/:address", async (c) => {
  let address: Address;
  try {
    address = getAddress(c.req.param("address")) as Address;
  } catch {
    return c.json({error: "invalid_address"}, 400);
  }
  try {
    const {tier, power} = await readTier(c.env, address);
    return c.json({address, tier, power});
  } catch {
    return c.json({error: "tier_read_failed"}, 502);
  }
});

/** Public JWKS so the desktop app can verify entitlement JWTs offline. */
app.get("/.well-known/jwks.json", async (c) => {
  if (!c.env.PUBLIC_JWK) return c.json({keys: []});
  const pub = JSON.parse(c.env.PUBLIC_JWK) as JWK;
  return c.json({keys: [{...pub, use: "sig", alg: "EdDSA"}]});
});

app.get("/health", (c) => c.json({ok: true}));

export default app;
