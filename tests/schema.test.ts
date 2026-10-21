import { describe, expect, it } from "vitest";
import { inferScalarSchema, inferSchema } from "../src/normalize/schema.js";

describe("inferSchema", () => {
  it("marks fields required only when every sample has them", () => {
    expect(inferSchema([{ a: 1, b: "x" }, { a: 2 }])).toEqual({
      type: "object",
      properties: { a: { type: "integer" }, b: { type: "string" } },
      required: ["a"],
    });
  });

  it("widens integer + number to number and unions other types", () => {
    expect(inferSchema([1, 2.5])).toEqual({ type: "number" });
    expect(inferSchema([null, 0.1])).toEqual({ type: ["null", "number"] });
  });

  it("merges array items across and within samples", () => {
    expect(inferSchema([[{ id: 1 }], [{ id: 2, name: "x" }], []])).toEqual({
      type: "array",
      items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } }, required: ["id"] },
    });
  });

  it("keeps object properties when the value is sometimes null", () => {
    expect(inferSchema([{ user: null }, { user: { id: 1 } }])).toEqual({
      type: "object",
      properties: {
        user: { type: ["null", "object"], properties: { id: { type: "integer" } }, required: ["id"] },
      },
      required: ["user"],
    });
  });

  it("detects string formats and drops them when samples disagree", () => {
    expect(inferSchema(["2026-10-21T08:30:00Z"])).toEqual({ type: "string", format: "date-time" });
    expect(inferSchema(["2026-10-21T08:30:00Z", "tomorrow"])).toEqual({ type: "string" });
  });

  it("gives empty arrays an open item schema", () => {
    expect(inferSchema([[]])).toEqual({ type: "array", items: {} });
  });
});

describe("inferScalarSchema", () => {
  it.each([
    [["1", "20"], { type: "integer" }],
    [["1.5", "2"], { type: "number" }],
    [["true", "false"], { type: "boolean" }],
    [["2026-10-21"], { type: "string", format: "date" }],
    [["usb", "hub"], { type: "string" }],
  ])("%j", (values, expected) => expect(inferScalarSchema(values)).toEqual(expected));
});
