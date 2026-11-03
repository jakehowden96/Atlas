// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import BarChart from "../components/stats/charts/BarChart.svelte";
import ChartCard from "../components/stats/charts/ChartCard.svelte";
import Heatmap from "../components/stats/charts/Heatmap.svelte";
import type { Point } from "../stats-chart";

const pts: Point[] = [
  { key: "a", label: "Mon", value: 2 },
  { key: "b", label: "Tue", value: 18.4 },
  { key: "c", label: "Wed", value: 4 },
];

describe("stats charts", () => {
  afterEach(cleanup);

  it("bars are labelled, one tab stop, and arrows/Home/End move focus", async () => {
    render(BarChart, { points: pts, unit: "usd", label: "Spend", emptyText: "None" });
    expect(screen.getByRole("group", { name: "Spend" })).toBeTruthy();
    const marks = screen.getAllByRole("button") as [HTMLElement, HTMLElement, HTMLElement];
    expect(marks[1].getAttribute("aria-label")).toContain("Tue: $18.40");
    expect(marks.map((m) => m.tabIndex)).toEqual([0, -1, -1]);
    marks[0].focus();
    await fireEvent.keyDown(marks[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(marks[1]);
    await fireEvent.keyDown(marks[1], { key: "End" });
    expect(document.activeElement).toBe(marks[2]);
    await fireEvent.keyDown(marks[2], { key: "Home" });
    expect(document.activeElement).toBe(marks[0]);
  });

  it("draws the empty message inside the plot", () => {
    render(BarChart, { points: [], unit: "usd", label: "Spend", emptyText: "No sessions" });
    expect(screen.getByText("No sessions")).toBeTruthy();
  });

  it("heatmap cells carry their value in aria-label", () => {
    render(Heatmap, {
      cells: [{ key: "x", label: "Tue 14 Oct", value: 6 }],
      noun: "session",
      label: "Sessions",
      emptyText: "None",
    });
    expect(screen.getByLabelText("Tue 14 Oct, 6 sessions")).toBeTruthy();
  });

  it("table mode shows the same data", async () => {
    render(ChartCard, {
      id: "t",
      title: "Spend",
      summary: "s",
      rows: pts,
      unit: "usd",
      children: (() => {}) as never,
    });
    await fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(screen.getByRole("cell", { name: "$18.40" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
});
