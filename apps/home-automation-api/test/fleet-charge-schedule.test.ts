import { describe, expect, it } from "vitest";
import { addChargeScheduleBody, removeChargeScheduleBody, sendCarSchedule } from "../src/services/fleet-charge-schedule.js";

describe("fleet charge schedule", () => {
  it("builds a one-time schedule for the booked slot", () => {
    expect(addChargeScheduleBody({
      date: "2026-11-22",
      from: "02:30",
      to: "03:45",
      lat: 50.6920036,
      lon: 15.2203556
    })).toEqual({
      id: 1,
      enabled: true,
      one_time: true,
      days_of_week: "Sunday",
      start_enabled: true,
      start_time: 150,
      end_enabled: true,
      end_time: 225,
      lat: 50.6920036,
      lon: 15.2203556
    });
  });

  it("sends an end at midnight as minute 0", () => {
    const body = addChargeScheduleBody({
      date: "2026-11-22",
      from: "22:45",
      to: "24:00",
      lat: 50.6920036,
      lon: 15.2203556
    });
    expect(body.start_time).toBe(22 * 60 + 45);
    expect(body.end_time).toBe(0);
    expect(body.one_time).toBe(true);
  });

  it("removes schedule 1", () => {
    expect(removeChargeScheduleBody()).toEqual({ id: 1 });
  });

  it("posts add_charge_schedule and returns the schedule that was accepted", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const sent = await sendCarSchedule({
      proxyUrl: "http://proxy.example",
      vin: "VIN",
      action: { action: "add", slot: { from: "02:30", to: "03:45" } },
      date: "2026-11-22",
      lat: 50.6920036,
      lon: 15.2203556,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ response: { result: true } }), { status: 200 });
      }
    });
    expect(calls[0].url).toBe("http://proxy.example/api/1/vehicles/VIN/command/add_charge_schedule");
    expect(calls[0].body).toMatchObject({ one_time: true, id: 1, start_time: 150 });
    expect(sent).toEqual({ id: 1, from: "02:30", to: "03:45" });
  });

  it("returns null when the proxy rejects the command", async () => {
    const sent = await sendCarSchedule({
      proxyUrl: "http://proxy.example",
      vin: "VIN",
      action: { action: "remove" },
      date: "2026-11-22",
      lat: 50.6920036,
      lon: 15.2203556,
      fetchImpl: async () => new Response("no", { status: 500 })
    });
    expect(sent).toBeNull();
  });

  it("returns null when the proxy never answers", async () => {
    const sent = await sendCarSchedule({
      proxyUrl: "http://proxy.example",
      vin: "VIN",
      action: { action: "add", slot: { from: "02:30", to: "03:45" } },
      date: "2026-11-22",
      lat: 50.6920036,
      lon: 15.2203556,
      timeoutMs: 50,
      fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal)
          return;
        const fail = () => reject(signal.reason ?? new Error("aborted"));
        if (signal.aborted)
          fail();
        else
          signal.addEventListener("abort", fail, { once: true });
      })
    });
    expect(sent).toBeNull();
  });
});
