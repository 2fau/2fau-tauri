import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountRow } from "@/components/account-row";
import { account, fakeService, renderWithVault } from "@/test/test-utils";

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  // jsdom's navigator.clipboard is getter-only; defineProperty overrides it.
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

describe("AccountRow", () => {
  it("shows the half-split code plus label and dimmed issuer", async () => {
    const a = account();
    renderWithVault(<AccountRow account={a} onEdit={() => {}} />, fakeService([a], { a: "492810" }));
    expect(await screen.findByText("492 810")).toBeInTheDocument();
    expect(screen.getByText("alice@gmail")).toBeInTheDocument(); // primary (label)
    expect(screen.getByText("Google")).toBeInTheDocument(); // secondary (issuer)
  });

  it("copies the raw (unformatted) code on click", async () => {
    const a = account();
    renderWithVault(<AccountRow account={a} onEdit={() => {}} />, fakeService([a], { a: "492810" }));
    fireEvent.click(await screen.findByText("492 810"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("492810"));
  });

  it("omits the secondary name when there is no label", async () => {
    const a = account({ label: "" });
    renderWithVault(<AccountRow account={a} onEdit={() => {}} />, fakeService([a], { a: "000000" }));
    await screen.findByText("000 000");
    // primary is now the issuer; it should appear exactly once (no dimmed copy)
    expect(screen.queryAllByText("Google")).toHaveLength(1);
  });
});
