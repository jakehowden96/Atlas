import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import ConnectorLogo from "../components/ui/ConnectorLogo.svelte";
import { connectorLogo } from "../connector-logos";

describe("connector logos", () => {
  it("covers linear and github with currentColor svgs", () => {
    for (const id of ["linear", "github"]) {
      expect(connectorLogo(id)).toContain('fill="currentColor"');
    }
  });

  it("falls back to the initial for an unknown id", () => {
    expect(connectorLogo("acme")).toBeUndefined();
    const { body } = render(ConnectorLogo, { props: { connector: "acme" } });
    expect(body).toContain("A");
    expect(body).not.toContain("<svg");
  });

  it("label toggles the role", () => {
    const hidden = render(ConnectorLogo, { props: { connector: "linear" } }).body;
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).not.toContain('role="img"');
    const named = render(ConnectorLogo, { props: { connector: "linear", label: "Linear" } }).body;
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Linear"');
  });
});
