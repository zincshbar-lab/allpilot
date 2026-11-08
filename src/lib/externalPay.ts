"use client";

// Pay a NEAR Intents deposit address straight from the payer's own wallet on another chain:
//  • EVM (MetaMask, Rabby, Coinbase Wallet… any injected EIP-1193 wallet): native coin or ERC-20 transfer
//  • Solana (Phantom): native SOL or SPL token transfer (creates the deposit's token account if needed)
// The wallet shows the exact amount and recipient and asks the user to confirm — nothing is sent without that.

export const EVM_CHAIN_IDS: Record<string, number> = {
  eth: 1,
  base: 8453,
  arb: 42161,
  op: 10,
  pol: 137,
  bsc: 56,
  avax: 43114,
  gnosis: 100,
  bera: 80094,
  scroll: 534352,
  monad: 143,
};

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
type Phantom = {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }>;
};

export function evmWallet(): Eip1193 | null {
  return (typeof window !== "undefined" && (window as unknown as { ethereum?: Eip1193 }).ethereum) || null;
}
export function phantomWallet(): Phantom | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: Phantom }; solana?: Phantom };
  return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null);
}

const hex = (n: bigint) => `0x${n.toString(16)}`;
const pad32 = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");

export async function payWithEvm(o: { chainCode: string; to: string; amountBase: string; tokenAddress: string | null }): Promise<string> {
  const eth = evmWallet();
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask (or another browser wallet) and refresh.");
  const chainId = EVM_CHAIN_IDS[o.chainCode];
  if (!chainId) throw new Error(`Paying on ${o.chainCode} from a browser wallet isn't supported yet — copy the deposit address instead.`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(o.to)) throw new Error("Unexpected deposit address format.");
  const [from] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (parseInt(current, 16) !== chainId) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(BigInt(chainId)) }] });
    } catch (e) {
      throw new Error(`Please switch your wallet to the right network (chain id ${chainId}) and try again. ${(e as Error).message ?? ""}`.trim());
    }
  }
  const amount = BigInt(o.amountBase);
  const tx = o.tokenAddress
    ? { from, to: o.tokenAddress, value: "0x0", data: `0xa9059cbb${pad32(o.to)}${pad32(amount.toString(16))}` } // ERC-20 transfer(to, amount)
    : { from, to: o.to, value: hex(amount) };
  return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as string;
}

export async function payWithPhantom(o: { to: string; amountBase: string; tokenAddress: string | null; decimals: number }): Promise<string> {
  const ph = phantomWallet();
  if (!ph) throw new Error("Phantom not found. Install Phantom and refresh.");
  const web3 = await import("@solana/web3.js");
  const spl = await import("@solana/spl-token");
  // public Solana RPCs reject browser origins, so reads go through our small allow-listed proxy
  const conn = new web3.Connection(`${window.location.origin}/api/solana-rpc`, "confirmed");
  const { publicKey } = await ph.connect();
  const owner = new web3.PublicKey(publicKey.toString());
  const dest = new web3.PublicKey(o.to);
  const amount = BigInt(o.amountBase);
  const tx = new web3.Transaction();
  if (!o.tokenAddress) {
    tx.add(web3.SystemProgram.transfer({ fromPubkey: owner, toPubkey: dest, lamports: amount }));
  } else {
    const mint = new web3.PublicKey(o.tokenAddress);
    const mintInfo = await conn.getAccountInfo(mint);
    const programId = mintInfo?.owner.equals(spl.TOKEN_2022_PROGRAM_ID) ? spl.TOKEN_2022_PROGRAM_ID : spl.TOKEN_PROGRAM_ID;
    const fromAta = spl.getAssociatedTokenAddressSync(mint, owner, false, programId);
    const toAta = spl.getAssociatedTokenAddressSync(mint, dest, true, programId);
    tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(owner, toAta, dest, mint, programId));
    tx.add(spl.createTransferCheckedInstruction(fromAta, mint, toAta, owner, amount, o.decimals, [], programId));
  }
  tx.feePayer = owner;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const { signature } = await ph.signAndSendTransaction(tx);
  return signature;
}
