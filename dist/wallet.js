import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config.js";
let current = config.privateKey ? Keypair.fromSecretKey(bs58.decode(config.privateKey)) : null;
export function setWalletFromPrivateKey(base58SecretKey) {
    const kp = Keypair.fromSecretKey(bs58.decode(base58SecretKey.trim()));
    current = kp;
    return kp;
}
export function getWallet() {
    return current;
}
export function requireWallet() {
    if (!current) {
        throw new Error("No wallet connected — set PRIVATE_KEY in .env or use /connect in Telegram");
    }
    return current;
}
export function isWalletConnected() {
    return current !== null;
}
