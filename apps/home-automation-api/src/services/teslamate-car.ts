/*
Reads Obluda from the TeslaMate MQTT topics that are already retained.
The API subscribes. It does not publish a command.
*/

import net from "node:net";
import type { CarReading } from "./car-energy.js";

export type MqttMessage = {
  topic: string;
  payload: string;
};

const CAR_TOPICS = [
  "teslamate/cars/1/usable_battery_level",
  "teslamate/cars/1/charge_limit_soc",
  "teslamate/cars/1/plugged_in",
  "teslamate/cars/1/geofence"
];

/* Read one MQTT remaining-length field. A short buffer returns null. */
function readRemainingLength(packet: Buffer, offset: number): { length: number; next: number } | null {
  let multiplier = 1;
  let value = 0;
  let cursor = offset;
  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    if (cursor >= packet.length)
      return null;
    const byte = packet[cursor];
    cursor += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0)
      return { length: value, next: cursor };
    multiplier *= 128;
  }
  throw new Error("TeslaMate message is too long");
}

/* Take every complete publish in the buffer and leave the unfinished tail. */
export function takeMqttPublishes(packet: Buffer): { messages: MqttMessage[]; rest: Buffer } {
  const messages: MqttMessage[] = [];
  let offset = 0;
  while (offset < packet.length) {
    const remaining = readRemainingLength(packet, offset + 1);
    if (!remaining)
      break;
    const end = remaining.next + remaining.length;
    if (end > packet.length)
      break;
    if ((packet[offset] >> 4) === 3) {
      let cursor = remaining.next;
      const topicLength = packet.readUInt16BE(cursor);
      cursor += 2;
      const topic = packet.subarray(cursor, cursor + topicLength).toString("utf8");
      cursor += topicLength;
      messages.push({ topic, payload: packet.subarray(cursor, end).toString("utf8") });
    }
    offset = end;
  }
  return { messages, rest: packet.subarray(offset) };
}

/* Split a buffer of retained publishes into topic and payload. */
export function decodeMqttPublishes(packet: Buffer): MqttMessage[] {
  return takeMqttPublishes(packet).messages;
}

/* The retained values the plan needs. A missing topic throws. */
export function carReadingFromMessages(messages: MqttMessage[]): CarReading {
  const payload = (suffix: string) => {
    const message = messages.find((item) => item.topic.endsWith(`/${suffix}`));
    if (!message)
      throw new Error(`TeslaMate did not publish ${suffix}`);
    return message.payload;
  };
  const usablePercent = Number(payload("usable_battery_level"));
  const limitPercent = Number(payload("charge_limit_soc"));
  if (!Number.isFinite(usablePercent) || !Number.isFinite(limitPercent))
    throw new Error("TeslaMate charge is not a number");
  return {
    usablePercent,
    limitPercent,
    pluggedIn: payload("plugged_in") === "true",
    atHome: payload("geofence") === "Home"
  };
}

/* MQTT CONNECT for an anonymous session. The broker on the TeslaMate network has no password. */
function encodeConnect(): Buffer {
  const protocol = Buffer.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x0f]);
  const clientId = Buffer.from("home-automation");
  const remaining = Buffer.concat([
    protocol,
    Buffer.from([clientId.length >> 8, clientId.length & 0xff]),
    clientId
  ]);
  return Buffer.concat([Buffer.from([0x10, remaining.length]), remaining]);
}

/* MQTT remaining-length bytes. Lengths past 127 use more than one byte. */
function encodeRemainingLength(length: number): Buffer {
  const bytes: number[] = [];
  let value = length;
  do {
    let encoded = value % 128;
    value = Math.floor(value / 128);
    if (value > 0)
      encoded |= 0x80;
    bytes.push(encoded);
  } while (value > 0);
  return Buffer.from(bytes);
}

/* MQTT SUBSCRIBE for the retained car topics. */
function encodeSubscribe(): Buffer {
  const parts = [Buffer.from([0x00, 0x01])];
  for (const topic of CAR_TOPICS) {
    const bytes = Buffer.from(topic);
    parts.push(Buffer.from([bytes.length >> 8, bytes.length & 0xff]), bytes, Buffer.from([0x00]));
  }
  const remaining = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([0x82]), encodeRemainingLength(remaining.length), remaining]);
}

/* Subscribe and return the retained usable charge, limit, plugged-in flag, and Home. */
export function readTeslaMateCar(host: string, port = 1883, timeoutMs = 4000): Promise<CarReading> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let pending: Buffer = Buffer.alloc(0);
    let settled = false;
    const messages: MqttMessage[] = [];
    const timer = setTimeout(() => {
      settle(new Error("TeslaMate did not answer"));
    }, timeoutMs);
    const settle = (error?: Error, reading?: CarReading) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      if (reading)
        resolve(reading);
      else
        reject(error ?? new Error("TeslaMate did not answer"));
    };
    socket.on("connect", () => {
      socket.write(encodeConnect());
      socket.write(encodeSubscribe());
    });
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.from(Buffer.concat([pending, chunk]));
      const taken = takeMqttPublishes(pending);
      pending = Buffer.from(taken.rest);
      messages.push(...taken.messages);
      try {
        const reading = carReadingFromMessages(messages);
        settle(undefined, reading);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("TeslaMate charge"))
          settle(error);
      }
    });
    socket.on("error", (error) => settle(error));
    socket.on("close", () => settle(new Error("TeslaMate did not answer")));
  });
}
