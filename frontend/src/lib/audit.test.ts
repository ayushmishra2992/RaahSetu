import { describe, expect, it } from "vitest";
import { describeAction, entityHref, metadataPairs } from "./audit";

describe("audit descriptions", () => {
  it("describes backend action names", () => {
    expect(describeAction("order.updated")).toBe("Order updated");
    expect(describeAction("road_edge.closed")).toBe("Road segment closed");
    expect(describeAction("road_edge.opened")).toBe("Road segment reopened");
    expect(describeAction("user.password_changed")).toBe("User password changed");
    expect(describeAction("fuel.recorded")).toBe("Fuel record logged");
    expect(describeAction("billing.paid")).toBe("Billing document paid");
    expect(describeAction("something_new")).toBe("Something new");
  });

  it("links records that have a page", () => {
    expect(entityHref("Trip", 4)).toBe("/trips/4");
    expect(entityHref("Order", 9)).toBe("/orders?open=9");
    expect(entityHref("ComplianceDocument", 2)).toBe("/documents");
    expect(entityHref("Unknown", 1)).toBeNull();
  });

  it("flattens metadata into readable pairs", () => {
    expect(metadataPairs({ fields: ["name", "phone"], isClosed: true, number: "INV-1", fromStatus: null })).toEqual([
      ["Fields", "name, phone"],
      ["Is closed", "Yes"],
      ["Number", "INV-1"],
      ["From status", "—"],
    ]);
    expect(metadataPairs(null)).toEqual([]);
  });
});
