import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nodeStartupError } from "../scripts/check-node.mjs";

describe("Node 22", () => {
  it("explains that node:sqlite needs Node 22", () => {
    expect(nodeStartupError("20.18.1")).toMatch(/Node\.js 22/);
    expect(nodeStartupError("20.18.1")).toMatch(/node:sqlite/);
    expect(nodeStartupError("v20.11.0")).toMatch(/Node\.js 22/);
    expect(nodeStartupError("22.14.0")).toBeNull();
    expect(nodeStartupError("24.1.0")).toBeNull();
  });

  it("declares the engine in package.json and .nvmrc", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toMatch(/>=22/);
    expect(readFileSync(".nvmrc", "utf8").trim()).toBe("22");
    expect(readFileSync("README.md", "utf8")).toMatch(/Node\.js 22/);
  });
});
