import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupView } from "@/components/setup-view";
import { fakeService, renderWithVault } from "@/test/test-utils";

describe("SetupView", () => {
  it("creates the vault once the passphrase is long enough and confirmed", () => {
    const svc = fakeService([]);
    const unlock = vi.spyOn(svc, "unlock");
    renderWithVault(<SetupView />, svc);

    const [pass, confirm] = screen.getAllByPlaceholderText(/passphrase/i);
    fireEvent.change(pass, { target: { value: "short" } });
    expect(screen.getByText(/at least 8/i)).toBeInTheDocument();

    fireEvent.change(pass, { target: { value: "longenough" } });
    fireEvent.change(confirm, { target: { value: "longenough" } });
    fireEvent.click(screen.getByRole("button", { name: /create vault/i }));
    expect(unlock).toHaveBeenCalledWith("longenough");
  });

  it("blocks creation when the confirmation doesn't match", () => {
    const svc = fakeService([]);
    const unlock = vi.spyOn(svc, "unlock");
    renderWithVault(<SetupView />, svc);

    const [pass, confirm] = screen.getAllByPlaceholderText(/passphrase/i);
    fireEvent.change(pass, { target: { value: "longenough" } });
    fireEvent.change(confirm, { target: { value: "different1" } });
    expect(screen.getByText(/don.t match/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create vault/i }));
    expect(unlock).not.toHaveBeenCalled();
  });
});
