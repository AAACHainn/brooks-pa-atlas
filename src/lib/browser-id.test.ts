import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserId } from "./browser-id";

test("browser IDs prefer native randomUUID when available", () => {
  const cryptoApi = {
    randomUUID: () => "native-id",
  } as unknown as Crypto;

  assert.equal(createBrowserId(cryptoApi), "native-id");
});

test("browser IDs use getRandomValues when randomUUID is unavailable", () => {
  const cryptoApi = {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    },
  } as unknown as Crypto;

  assert.equal(createBrowserId(cryptoApi), "abababab-abab-4bab-abab-abababababab");
});

test("browser IDs still work when the Web Crypto API is unavailable", () => {
  assert.equal(createBrowserId(null, () => 0), "00000000-0000-4000-8000-000000000000");
});
