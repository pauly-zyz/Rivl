/**
 * Relay JSON-RPC ke node Robinhood Chain (server-side).
 *
 * Kenapa: RPC publik tidak selalu bisa dijangkau langsung dari browser pemain (mis. diblokir per wilayah atau
 * jaringan). Lewat relay ini browser cukup bicara ke domain Rivl, dan server Vercel yang meneruskan ke node.
 * Juga bisa dipakai wallet sebagai RPC jaringan (eth_sendRawTransaction hanya meneruskan transaksi yang sudah
 * ditandatangani). Node tujuan diatur lewat env server RPC_UPSTREAM_URL (bisa RPC berbayar dengan API key, tidak
 * pernah terlihat di browser).
 */

const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "net_version",
  "web3_clientVersion",
]);

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 50;

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const upstream = process.env.RPC_UPSTREAM_URL?.trim();
  if (!upstream) return Response.json(rpcError(null, -32603, "RPC relay is not configured"), { status: 500, headers: CORS });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return Response.json(rpcError(null, -32600, "Request too large"), { status: 413, headers: CORS });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400, headers: CORS });
  }

  const calls = (Array.isArray(body) ? body : [body]) as RpcRequest[];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return Response.json(rpcError(null, -32600, "Invalid batch size"), { status: 400, headers: CORS });
  }
  const rejected = calls.find((c) => typeof c?.method !== "string" || !ALLOWED_METHODS.has(c.method));
  if (rejected) {
    return Response.json(rpcError(rejected?.id, -32601, "Method not allowed"), { status: 200, headers: CORS });
  }

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { ...CORS, "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json(rpcError(calls[0]?.id, -32603, "Upstream RPC unreachable"), { status: 502, headers: CORS });
  }
}
