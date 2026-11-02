/**
 * Polyfills nécessaires au moteur Git (isomorphic-git) sous React Native / Hermes.
 * Ce fichier doit être importé EN PREMIER (voir app/_layout.tsx).
 */
import { Buffer } from "buffer";

const g = globalThis as any;

if (!g.Buffer) g.Buffer = Buffer;

if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = class TextDecoderPolyfill {
    encoding = "utf-8";
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) return "";
      const u8 =
        input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString("utf8");
    }
  };
}

if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = class TextEncoderPolyfill {
    encoding = "utf-8";
    encode(input = ""): Uint8Array {
      return new Uint8Array(Buffer.from(input, "utf8"));
    }
  };
}

export {};
