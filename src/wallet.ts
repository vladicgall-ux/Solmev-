import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config.js";

let current: Keypair | null = config.privateKey ? Keypair.fromSecretKey(bs58.decode(config.privateKey)) : null;

export function setWalletFromPrivateKey(base58SecretKey: string): Keypair {
  const kp = Keypair.fromSecretKey(bs58.decode(base58SecretKey.trim()));
  current = kp;
  return kp;
}

export function getWallet(): Keypair | null {
  return current;
}

export function requireWallet(): Keypair {
  if (!current) {
    throw new Error("No wallet connected — set PRIVATE_KEY in .env or use /connect in Telegram");
  }
  return current;
}

export function isWalletConnected(): boolean {
  return current !== null;
}
