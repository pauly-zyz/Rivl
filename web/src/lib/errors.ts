import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const MESSAGES: Record<string, string> = {
  StakeOutOfRange: "Stake is outside the allowed range for this token.",
  TokenNotAllowed: "This token is not accepted.",
  WrongEthValue: "The ETH amount sent doesn't match the stake.",
  UnsupportedToken: "This token is not supported.",
  InvalidSide: "Pick heads or tails.",
  InvalidMove: "Pick rock, paper or scissors.",
  InvalidCommit: "Invalid commit.",
  CommitAlreadyUsed: "This commit was already used. Try again to generate a new one.",
  InvalidStatus: "This duel is no longer in a state that allows this action.",
  DuelExpired: "This duel has expired.",
  CannotJoinOwnDuel: "You can't join your own duel.",
  NotCreator: "Only the duel creator can do this.",
  RevealWindowClosed: "The reveal window has closed.",
  InvalidReveal: "Move and salt don't match your commit.",
  TooEarly: "Too early — the deadline hasn't passed yet.",
  NothingToWithdraw: "Nothing to claim.",
  EnforcedPause: "New duels are paused right now. Existing duels and claims still work.",
  ERC20InsufficientAllowance: "Token allowance is too low. Approve first.",
  ERC20InsufficientBalance: "Insufficient token balance.",
};

/** Pesan singkat untuk pengguna dari error wagmi/viem. */
export function friendlyError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "Transaction rejected in your wallet.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && MESSAGES[name]) return MESSAGES[name];
      if (name) return `Transaction would fail: ${name}.`;
    }
    if (/insufficient funds/i.test(err.message)) return "Not enough ETH to cover the stake and gas.";
    return err.shortMessage;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function isUserRejection(err: unknown): boolean {
  return err instanceof BaseError && !!err.walk((e) => e instanceof UserRejectedRequestError);
}
