import { BaseError, ContractFunctionRevertedError } from "viem";

export interface RevertDetails {
  errorName?: string;
  args?: readonly unknown[];
}

export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Traverses an error to extract the custom revert error name and arguments.
 */
export function extractRevert(err: unknown): RevertDetails | undefined {
  if (typeof err !== "object" || err === null) return undefined;

  // Direct property check
  if (
    "data" in err &&
    (err as any).data &&
    typeof (err as any).data === "object" &&
    (err as any).data.errorName
  ) {
    return {
      errorName: (err as any).data.errorName,
      args: (err as any).data.args,
    };
  }
  if ("errorName" in err && typeof (err as any).errorName === "string") {
    return {
      errorName: (err as any).errorName,
      args: (err as any).args,
    };
  }

  // Viem BaseError walk
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => {
      if (e instanceof ContractFunctionRevertedError) return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "data" in e &&
        Boolean((e as { data?: { errorName?: string } }).data?.errorName)
      ) {
        return true;
      }
      return false;
    });

    if (reverted) {
      if (reverted instanceof ContractFunctionRevertedError) {
        return {
          errorName: reverted.data?.errorName,
          args: reverted.data?.args,
        };
      }
      const errorObj = reverted as any;
      if (errorObj.data?.errorName) {
        return {
          errorName: errorObj.data.errorName,
          args: errorObj.data.args,
        };
      }
      if (errorObj.errorName) {
        return {
          errorName: errorObj.errorName,
          args: errorObj.args,
        };
      }
    }
  }

  return undefined;
}

/**
 * Checks whether an error represents the user rejecting the prompt in their wallet.
 */
export function isUserRejection(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("User rejected") ||
    msg.includes("User denied") ||
    msg.includes("user rejected") ||
    msg.includes("ACTION_REJECTED") ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: number }).code === 4001)
  );
}

/**
 * Formats a UNIX timestamp into a YYYY-MM-DD or readable date string.
 */
function formatDate(timestamp: number | bigint): string {
  const d = Number(timestamp);
  return new Date(d * 1000).toISOString().split("T")[0];
}

/**
 * Translates contract and client errors into formal, clear sentences (§4.4).
 */
export function describeError(err: unknown): string {
  if (isUserRejection(err)) {
    return "Transaction cancelled in wallet.";
  }

  const rev = extractRevert(err);
  if (rev?.errorName) {
    switch (rev.errorName) {
      case "TooEarly": {
        const t = rev.args?.[1];
        if (t !== undefined) {
          return `This can be revealed from ${formatDate(t as number | bigint)}.`;
        }
        return "This prediction cannot be revealed yet.";
      }
      case "WindowClosed": {
        const t = rev.args?.[1];
        if (t !== undefined) {
          return `The window to reveal this closed on ${formatDate(t as number | bigint)}. It has lapsed.`;
        }
        return "The window to reveal this has closed. It has lapsed.";
      }
      case "BadReveal":
        return "That isn't the text and salt that were sealed.";
      case "NotAuthor":
        return "Only the author can reveal.";
      case "AlreadyRevealed":
        return "This has already been revealed.";
      case "AuthorCannotJudge":
        return "You can't judge your own prediction.";
      case "AlreadyJudged":
        return "You've already given a verdict on this.";
      case "NotRevealed":
        return "There's nothing to judge until it's revealed.";
      case "BadRevealDate":
        return "Choose a reveal date between an hour and five years away.";
      case "BadText": {
        const l = rev.args?.[0];
        const m = rev.args?.[1] ?? 280;
        return `Predictions run to ${m} bytes; yours is ${l}.`;
      }
      case "EmptyCommitment":
        return "Commitment cannot be empty.";
      case "NoSuchPrediction":
        return "Prediction not found.";
      default:
        return `Contract reverted: ${rev.errorName}`;
    }
  }

  if (err instanceof Error) {
    if (err.message.length > 140) {
      return `${err.message.slice(0, 137)}...`;
    }
    return err.message;
  }

  return "Transaction failed.";
}
