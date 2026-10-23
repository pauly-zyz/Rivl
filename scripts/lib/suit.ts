import { bytesToHex, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export const ROCK = 1;
export const PAPER = 2;
export const SCISSORS = 3;
/** Nilai `move` di commit Coinflip/Dice (DuelArena.NO_MOVE). */
export const NO_MOVE = 0;

/** Salt 32 byte acak, baru untuk setiap duel (docs/spec.md bagian 5.3). */
export function randomSalt(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Angka acak Coinflip/Dice = keccak256(abi.encode(bytes32 salt, bytes32 joinerSeed)) (docs/spec.md 2.1–2.2). */
export function randomWordOf(salt: Hex, seed: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [salt, seed])));
}

/**
 * commit = keccak256(abi.encode(uint256 chainId, address arena, address creator, uint8 move, bytes32 salt))
 * Dihitung lokal, bukan lewat RPC (docs/spec.md bagian 2.3).
 */
export function computeSuitCommit(args: {
  chainId: number | bigint;
  arena: Address;
  creator: Address;
  move: number;
  salt: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint8" }, { type: "bytes32" }],
      [BigInt(args.chainId), args.arena, args.creator, args.move, args.salt],
    ),
  );
}
