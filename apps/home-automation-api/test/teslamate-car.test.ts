/*
Tests for the TeslaMate values the plan reads.
*/

import { describe, expect, it } from "vitest";
import net from "node:net";
import { carReadingFromMessages, decodeMqttPublishes, readTeslaMateCar } from "../src/services/teslamate-car.js";

function publish(topic: string, payload: string): Buffer {
  const topicBytes = Buffer.from(topic);
  const payloadBytes = Buffer.from(payload);
  const remaining = 2 + topicBytes.length + payloadBytes.length;
  return Buffer.concat([
    Buffer.from([0x31, remaining, topicBytes.length >> 8, topicBytes.length & 0xff]),
    topicBytes,
    payloadBytes
  ]);
}

function carPacket(geofence: string): Buffer {
  return Buffer.concat([
    publish("teslamate/cars/1/usable_battery_level", "50"),
    publish("teslamate/cars/1/charge_limit_soc", "80"),
    publish("teslamate/cars/1/plugged_in", "true"),
    publish("teslamate/cars/1/geofence", geofence)
  ]);
}

describe("TeslaMate car", () => {
  it("reads usable charge, limit, plugged in, and Home from retained publishes", () => {
    const reading = (geofence: string) => carReadingFromMessages(decodeMqttPublishes(carPacket(geofence)));
    expect(reading("Home")).toEqual({ usablePercent: 50, limitPercent: 80, pluggedIn: true, atHome: true });
    expect(reading("")).toEqual({ usablePercent: 50, limitPercent: 80, pluggedIn: true, atHome: false });
    expect(reading("Work")).toEqual({ usablePercent: 50, limitPercent: 80, pluggedIn: true, atHome: false });
  });

  it("throws when the geofence topic is missing", () => {
    const packet = Buffer.concat([
      publish("teslamate/cars/1/usable_battery_level", "50"),
      publish("teslamate/cars/1/charge_limit_soc", "80"),
      publish("teslamate/cars/1/plugged_in", "true")
    ]);
    expect(() => carReadingFromMessages(decodeMqttPublishes(packet))).toThrow(/geofence/);
  });

  it("reads the three values from a broker that answers with retained publishes", async () => {
    let subscribed = Buffer.alloc(0);
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        subscribed = Buffer.concat([subscribed, chunk]);
        socket.write(Buffer.concat([
          Buffer.from([0x20, 0x02, 0x00, 0x00]),
          carPacket("Home")
        ]));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("The test broker has no port");
    const reading = await readTeslaMateCar("127.0.0.1", address.port, 2000);
    expect(reading).toEqual({ usablePercent: 50, limitPercent: 80, pluggedIn: true, atHome: true });
    const subscription = subscribed.toString("utf8");
    expect(subscription).toContain("teslamate/cars/1/geofence");
    expect(subscription).not.toContain("latitude");
    expect(subscription).not.toContain("longitude");
    server.close();
  });
});
