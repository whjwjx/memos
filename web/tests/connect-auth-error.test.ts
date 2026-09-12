import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { isAuthFailureError } from "@/connect";

describe("isAuthFailureError", () => {
  it("recognizes direct unauthenticated Connect errors", () => {
    expect(isAuthFailureError(new ConnectError("user not authenticated", Code.Unauthenticated))).toBe(true);
  });

  it("recognizes grpc unauthenticated errors wrapped as unknown streaming errors", () => {
    const error = new ConnectError("rpc error: code = Unauthenticated desc = user not authenticated", Code.Unknown);

    expect(isAuthFailureError(error)).toBe(true);
  });

  it("does not treat unrelated unknown errors as auth failures", () => {
    expect(isAuthFailureError(new ConnectError("rpc error: code = Internal desc = failed", Code.Unknown))).toBe(false);
  });
});
