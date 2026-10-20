import { beforeEach, describe, expect, it } from "vitest";
import { incidentDiff, lookupDeploy } from "@/lib/incident";
import { resetStore } from "@/lib/meeting-store";
import { executeTool } from "@/lib/tools";

describe("incident tools", () => {
  beforeEach(() => {
    resetStore();
  });

  it("looks up batch-reconcile v2.3 and ignores the earlier orders deploy", () => {
    const hit = executeTool("deploy_lookup", { query: "the reconciliation one" });
    expect(hit.ok).toBe(true);
    expect(hit.summary).toMatch(/batch-reconcile v2\.3/);
    expect(hit.summary).toMatch(/11:40 PM/);
    const decoy = lookupDeploy("orders checkout");
    expect(decoy?.service).toBe("orders-api");
  });

  it("fetches the pool shrink and the missing timeout", () => {
    const diff = executeTool("diff_fetch", {});
    expect(diff.ok).toBe(true);
    const highlights = incidentDiff().flatMap((file) => file.lines.map((line) => line.highlight));
    expect(highlights).toContain("shrink");
    expect(highlights).toContain("missing-timeout");
    const text = JSON.stringify(diff.data);
    expect(text).toContain("max_connections: 50");
    expect(text).toContain("max_connections: 20");
    expect(text).toContain("command_timeout_ms: 200");
  });

  it("scaffolds three files and the tests go green", () => {
    executeTool("scaffold_code", {});
    executeTool("pr_draft", {});
    const tests = executeTool("run_tests", {});
    expect(tests.ok).toBe(true);
    expect(tests.summary).toBe("Tests passing.");
    const data = tests.data as { passed: boolean; tests: { passed: boolean }[] };
    expect(data.passed).toBe(true);
    expect(data.tests).toHaveLength(4);
    expect(data.tests.every((test) => test.passed)).toBe(true);
  });

  it("parks chatter outside the requirement pool and rolls back to the checkpoint", () => {
    executeTool("timeline_add", {
      speaker: "A",
      timeLabel: "02:17",
      title: "orders API 500 40%",
      detail: "PagerDuty",
    });
    const store = resetStore();
    store.ensure("demo");
    executeTool("timeline_add", {
      speaker: "A",
      timeLabel: "02:17",
      title: "orders API 500 40%",
      detail: "PagerDuty",
    });
    store.checkpoint("demo");
    executeTool("chatter_park", { speaker: "B", text: "Did anyone order lunch yet?" });
    expect(store.get("demo").chatter).toHaveLength(1);
    expect(store.get("demo").requirements).toHaveLength(0);
    const rolled = executeTool("checkpoint_rollback", {});
    expect(rolled.ok).toBe(true);
    expect(store.get("demo").chatter).toHaveLength(0);
    expect(store.get("demo").timeline).toHaveLength(1);
  });

  it("correlates 02:15 with 02:17", () => {
    executeTool("timeline_add", {
      speaker: "A",
      timeLabel: "02:17",
      title: "orders API 500 40%",
      detail: "errors",
    });
    executeTool("timeline_add", {
      speaker: "B",
      timeLabel: "02:15",
      title: "Redis connections climbing",
      detail: "Grafana",
    });
    const linked = executeTool("timeline_correlate", {
      fromTime: "02:15",
      toTime: "02:17",
      note: "Redis pressure started two minutes before the errors.",
    });
    expect(linked.ok).toBe(true);
    const timeline = resetStore();
    void timeline;
  });
});

describe("design_draft outside the scripted billing demo", () => {
  beforeEach(() => {
    resetStore();
    delete process.env.LLM_PROVIDER;
  });
  it("sketches what was actually said instead of the billing-export template", () => {
    const text = "A static signup page posts to the bakery mailing list";
    const out = executeTool("design_draft", { meetingId: "design-real", speaker: "Chris", text });
    expect(out.ok).toBe(true);
    expect(out.summary).toBe(`Architecture sketch: ${text}`);
    expect(out.summary).not.toMatch(/CSV|export/);
  });
  it("keeps the template for the scripted billing-export demo", () => {
    const out = executeTool("design_draft", { meetingId: "design-demo", speaker: "Chris", text: "nightly billing export" });
    expect(out.summary).toMatch(/export worker/);
  });
});
