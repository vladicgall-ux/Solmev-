import {
  Connection,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  PublicKey,
} from "@solana/web3.js";
import { config } from "./config.js";
import { getSwapTransaction } from "./jupiter.js";
import { pickTipAccount, sendBundle } from "./jito.js";
import { logger } from "./logger.js";
import type { Opportunity } from "./types.js";

function decodeSwapTx(base64Tx: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
}

async function buildTipTx(
  connection: Connection,
  payer: Keypair,
  blockhash: string,
): Promise<VersionedTransaction> {
  const ix = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: new PublicKey(pickTipAccount()),
    lamports: config.jitoTipLamports,
  });
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  return tx;
}

export interface ExecutionResult {
  executed: boolean;
  reason?: string;
  buySig?: string;
  sellSig?: string;
  bundleId?: string;
}

/**
 * Builds both legs of the arbitrage via Jupiter, signs them, and lands them
 * atomically as a single Jito bundle (plus a small tip tx) so a failed
 * second leg can never leave the wallet holding an unwanted position.
 */
export async function executeOpportunity(
  connection: Connection,
  wallet: Keypair,
  opp: Opportunity,
): Promise<ExecutionResult> {
  logger.trade(
    `${opp.pair.mintA.slice(0, 4)}../${opp.pair.mintB.slice(0, 4)}.. ` +
      `buy@${opp.buyDex} -> sell@${opp.sellDex} | ` +
      `in=${opp.inAmount} out=${opp.outAmount} profit=${opp.profitLamports} (${opp.profitBps}bps)`,
  );

  const [buySwapB64, sellSwapB64] = await Promise.all([
    getSwapTransaction({
      quoteResponse: opp.buyQuote,
      userPublicKey: wallet.publicKey.toBase58(),
      priorityFeeMaxLamports: config.priorityFeeMaxLamports,
    }),
    getSwapTransaction({
      quoteResponse: opp.sellQuote,
      userPublicKey: wallet.publicKey.toBase58(),
      priorityFeeMaxLamports: config.priorityFeeMaxLamports,
    }),
  ]);

  const buyTx = decodeSwapTx(buySwapB64);
  const sellTx = decodeSwapTx(sellSwapB64);
  buyTx.sign([wallet]);
  sellTx.sign([wallet]);

  // Simulate both legs against current bank state before risking a real send.
  for (const [label, tx] of [["buy", buyTx], ["sell", sellTx]] as const) {
    const sim = await connection.simulateTransaction(tx, { sigVerify: false });
    if (sim.value.err) {
      logger.warn(`Simulation failed for ${label} leg, aborting trade`, sim.value.err, sim.value.logs);
      return { executed: false, reason: `simulation failed on ${label} leg` };
    }
  }

  if (config.dryRun) {
    logger.info("DRY_RUN=true — simulation passed, not sending. Set DRY_RUN=false to go live.");
    return { executed: false, reason: "dry_run" };
  }

  if (config.jitoEnabled) {
    const { blockhash } = await connection.getLatestBlockhash();
    const tipTx = await buildTipTx(connection, wallet, blockhash);
    const bundleId = await sendBundle([buyTx, sellTx, tipTx]);
    logger.trade(`bundle landed request sent, id=${bundleId}`);
    return { executed: true, bundleId };
  } else {
    logger.warn("JITO_ENABLED=false — sending legs sequentially, NOT atomic.");
    const buySig = await connection.sendRawTransaction(buyTx.serialize());
    await connection.confirmTransaction(buySig, "confirmed");
    logger.trade(`buy leg confirmed: ${buySig}`);
    const sellSig = await connection.sendRawTransaction(sellTx.serialize());
    await connection.confirmTransaction(sellSig, "confirmed");
    logger.trade(`sell leg confirmed: ${sellSig}`);
    return { executed: true, buySig, sellSig };
  }
}
