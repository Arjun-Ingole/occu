import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OccuVisualizer, createClickEvent, parseObservation } from "../src/visualizer.js";

const OBSERVATION = {
  content: [
    {
      type: "text" as const,
      text: [
        "Snapshot ID: snapshot-1",
        "B1 - checkbox at (100, 200) size 40×20 - identifier: occu.checkbox",
        "T2 - text field at (300.5, 400.5) size 100x30 - identifier: occu.input"
      ].join("\n")
    }
  ]
};

describe("software cursor visualizer", () => {
  it("maps snapshot element IDs to their centers", () => {
    const observation = parseObservation(OBSERVATION);

    expect(observation.elements.get("B1")).toEqual({ x: 120, y: 210 });
    expect(observation.elements.get("T2")).toEqual({ x: 350.5, y: 415.5 });
  });

  it("converts top-left screen coordinates into AppKit coordinates", () => {
    const event = createClickEvent(
      { x: 120, y: 210 },
      982,
      { button: "right" },
      "event-id",
      "2026-08-17T00:00:00.000Z"
    );

    expect(event).toEqual({
      id: "event-id",
      createdAt: "2026-08-17T00:00:00.000Z",
      payload: {
        clickFeedback: { type: "right", point: [120, 772] }
      }
    });
  });

  it("writes and announces a targeted mutation event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "occu-visualizer-test-"));
    const notifications: string[] = [];
    const visualizer = new OccuVisualizer({
      eventDirectory: directory,
      displayHeight: async () => 982,
      animationDuration: 0,
      notify: (descriptor) => {
        notifications.push(descriptor);
      }
    });
    visualizer.recordObservation(OBSERVATION);

    await visualizer.previewMutation("click", { on: "B1" });

    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatch(/^[0-9a-f-]+\|mouseMovement$/);
    expect(notifications[1]).toMatch(/^[0-9a-f-]+\|clickFeedback$/);
    const movementId = notifications[0]?.split("|")[0];
    const clickId = notifications[1]?.split("|")[0];
    const movement = JSON.parse(
      await readFile(join(directory, `${movementId}.json`), "utf8")
    );
    const click = JSON.parse(await readFile(join(directory, `${clickId}.json`), "utf8"));
    expect(movement.payload.mouseMovement).toEqual({
      duration: 0,
      from: [20, 722],
      to: [120, 772]
    });
    expect(click.payload.clickFeedback).toEqual({ type: "single", point: [120, 772] });
  });

  it("does not visualize ungrounded keyboard or drag mutations", async () => {
    const notifications: string[] = [];
    const visualizer = new OccuVisualizer({
      displayHeight: async () => 982,
      animationDuration: 0,
      notify: (descriptor) => {
        notifications.push(descriptor);
      }
    });

    await visualizer.previewMutation("press_key", { key: "Return" });
    await visualizer.previewMutation("drag", { from_coords: "1,2", to_coords: "3,4" });

    expect(notifications).toEqual([]);
  });
});
