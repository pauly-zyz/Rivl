/** Pohon Merkle untuk RivlRewards (pasangan diurutkan = OpenZeppelin MerkleProof). */
import { concat, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export type Entry = { account: Address; token: Address; amount: bigint };

export function leafOf(e: Entry): Hex {
  return keccak256(
    keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [e.account, e.token, e.amount])),
  );
}

const pair = (a: Hex, b: Hex) => keccak256(BigInt(a) < BigInt(b) ? concat([a, b]) : concat([b, a]));

export function buildTree(entries: Entry[]): { root: Hex; proofs: Hex[][] } {
  const leaves = entries.map(leafOf);
  if (leaves.length === 0) return { root: `0x${"0".repeat(64)}`, proofs: [] };
  const proofs: Hex[][] = leaves.map(() => []);
  // pos[i] = indeks daun i di lapisan saat ini
  let pos = leaves.map((_, i) => i);
  let layer = leaves;
  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) next.push(i + 1 < layer.length ? pair(layer[i]!, layer[i + 1]!) : layer[i]!);
    pos = pos.map((p, leaf) => {
      const sib = p ^ 1;
      if (sib < layer.length) proofs[leaf]!.push(layer[sib]!);
      return p >> 1;
    });
    layer = next;
  }
  return { root: layer[0]!, proofs };
}

export function verify(proof: Hex[], root: Hex, leaf: Hex): boolean {
  return proof.reduce((h, p) => pair(h, p), leaf) === root;
}
