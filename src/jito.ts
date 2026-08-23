import bs58 from "bs58";
import type { VersionedTransaction } from "@solana/web3.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Public, static Jito tip payment accounts (mainnet). Any one of these is valid;
// spreading tips across them avoids hammering a single account. Source:
// https://jito-labs.gitbook.io/mev/searcher-resources/bundles#tip-payment-accounts
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxWPqDPZbXvvcaTeoxa48Vm7VhCFPQE",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export function pickTipAccount(): string {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

/** Submits a set of already-signed transactions as one atomic Jito bundle. */
export async function sendBundle(txs: VersionedTransaction[]): Promise<string> {
  const encoded = txs.map((tx) => bs58.encode(tx.serialize()));

  const res = await fetch(`${config.jitoBlockEngineUrl}/api/v1/bundles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [encoded],
    }),
  });

  const body = (await res.json()) as { result?: string; error?: unknown };
  if (!res.ok || body.error) {
    throw new Error(`Jito sendBundle failed: ${JSON.stringify(body.error ?? body)}`);
  }
  const bundleId = body.result as string;
  logger.info(`Jito bundle submitted: ${bundleId}`);
  return bundleId;
}
