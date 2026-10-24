import { describe, expect, it } from "vitest";
import { describeError } from "../errors";

describe("describeError", () => {
  it("translates user rejection cleanly", () => {
    expect(describeError(new Error("User rejected the request."))).toBe(
      "Transaction cancelled in wallet."
    );
    expect(describeError({ code: 4001, message: "User denied transaction" })).toBe(
      "Transaction cancelled in wallet."
    );
  });

  it("translates TooEarly error to §4.4 sentence", () => {
    const err = { data: { errorName: "TooEarly", args: [1n, 1765000000n] } };
    expect(describeError(err)).toMatch(/^This can be revealed from \d{4}-\d{2}-\d{2}\.$/);
  });

  it("translates WindowClosed error to §4.4 sentence", () => {
    const err = { data: { errorName: "WindowClosed", args: [1n, 1765000000n] } };
    expect(describeError(err)).toMatch(
      /^The window to reveal this closed on \d{4}-\d{2}-\d{2}\. It has lapsed\.$/
    );
  });

  it("translates BadReveal error to §4.4 sentence", () => {
    const err = { data: { errorName: "BadReveal" } };
    expect(describeError(err)).toBe("That isn't the text and salt that were sealed.");
  });

  it("translates NotAuthor error to §4.4 sentence", () => {
    const err = { data: { errorName: "NotAuthor", args: [1n, "0x1234"] } };
    expect(describeError(err)).toBe("Only the author can reveal.");
  });

  it("translates AlreadyRevealed error to §4.4 sentence", () => {
    const err = { data: { errorName: "AlreadyRevealed", args: [1n] } };
    expect(describeError(err)).toBe("This has already been revealed.");
  });

  it("translates AuthorCannotJudge error to §4.4 sentence", () => {
    const err = { data: { errorName: "AuthorCannotJudge", args: [1n] } };
    expect(describeError(err)).toBe("You can't judge your own prediction.");
  });

  it("translates AlreadyJudged error to §4.4 sentence", () => {
    const err = { data: { errorName: "AlreadyJudged", args: [1n, "0x1234"] } };
    expect(describeError(err)).toBe("You've already given a verdict on this.");
  });

  it("translates NotRevealed error to §4.4 sentence", () => {
    const err = { data: { errorName: "NotRevealed", args: [1n] } };
    expect(describeError(err)).toBe("There's nothing to judge until it's revealed.");
  });

  it("translates BadRevealDate error to §4.4 sentence", () => {
    const err = { data: { errorName: "BadRevealDate", args: [1000n] } };
    expect(describeError(err)).toBe(
      "Choose a reveal date between an hour and five years away."
    );
  });

  it("translates BadText error to §4.4 sentence", () => {
    const err = { data: { errorName: "BadText", args: [300n, 280n] } };
    expect(describeError(err)).toBe("Predictions run to 280 bytes; yours is 300.");
  });

  it("translates EmptyCommitment error to §4.4 sentence", () => {
    const err = { data: { errorName: "EmptyCommitment" } };
    expect(describeError(err)).toBe("Commitment cannot be empty.");
  });

  it("translates NoSuchPrediction error to §4.4 sentence", () => {
    const err = { data: { errorName: "NoSuchPrediction", args: [999n] } };
    expect(describeError(err)).toBe("Prediction not found.");
  });

  it("falls back to generic error message", () => {
    expect(describeError(new Error("RPC Timeout"))).toBe("RPC Timeout");
    expect(describeError("unexpected")).toBe("Transaction failed.");
  });
});
