import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api-client";

import { recommendationActionErrorMessage } from "../recommendation-action-error-message";

describe("recommendationActionErrorMessage", () => {
  it("explains that no other book can be selected", () => {
    expect(recommendationActionErrorMessage(new ApiRequestError(409, "no_random_candidate"))).toBe(
      "ほかに選べる本がありません。"
    );
  });

  it("explains that the requested book is no longer in the list", () => {
    expect(recommendationActionErrorMessage(new ApiRequestError(404, "book_not_found"))).toBe(
      "この本は現在のリストにありません。"
    );
  });

  it("reports other API request failures", () => {
    expect(recommendationActionErrorMessage(new ApiRequestError(500, "internal_error"))).toBe(
      "操作に失敗しました。少し時間をおいて再度お試しください。"
    );
  });

  it("reports errors outside the API request boundary", () => {
    expect(recommendationActionErrorMessage(new Error("Network unavailable"))).toBe(
      "操作に失敗しました。少し時間をおいて再度お試しください。"
    );
  });
});
