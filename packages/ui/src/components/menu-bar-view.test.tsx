import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuBarView } from "@/components/menu-bar-view";
import { account, fakeService, renderWithVault } from "@/test/test-utils";

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => account({ id: `id${i}`, issuer: `Issuer${i}`, label: `l${i}` }));

describe("MenuBarView", () => {
  it("shows the empty state with no accounts", async () => {
    renderWithVault(<MenuBarView onAdd={() => {}} onEdit={() => {}} />, fakeService([]));
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByText("0 accounts")).toBeInTheDocument();
  });

  it("hides the search bar at 5 accounts", async () => {
    renderWithVault(<MenuBarView onAdd={() => {}} onEdit={() => {}} />, fakeService(many(5)));
    await screen.findByText("Issuer0");
    expect(screen.queryByPlaceholderText("Search")).toBeNull();
    expect(screen.getByText("5 accounts")).toBeInTheDocument();
  });

  it("shows the search bar past 5 accounts", async () => {
    renderWithVault(<MenuBarView onAdd={() => {}} onEdit={() => {}} />, fakeService(many(6)));
    await screen.findByText("Issuer0");
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
    expect(screen.getByText("6 accounts")).toBeInTheDocument();
  });
});
