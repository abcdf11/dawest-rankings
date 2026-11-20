import assert from "node:assert/strict";
import test from "node:test";
import { allowsOrigin } from "./origins.js";

test("accepts explicitly configured local origins and health checks", () => {
  assert.equal(allowsOrigin({ headers: {} }, [], false), true);
  assert.equal(
    allowsOrigin({ headers: { origin: "http://localhost:5173" } }, ["http://localhost:5173"], false),
    true,
  );
});

test("accepts the public HTTPS origin behind the private proxy", () => {
  const request = { headers: { origin: "https://dawest-123.onrender.com", host: "dawest-123.onrender.com", "x-forwarded-proto": "https" } };
  assert.equal(allowsOrigin(request, [], true), true);
  assert.equal(allowsOrigin(request, [], false), false);
  assert.equal(allowsOrigin({ headers: { ...request.headers, origin: "https://other.onrender.com" } }, [], true), false);
  assert.equal(allowsOrigin({ headers: { ...request.headers, origin: "http://dawest-123.onrender.com" } }, [], true), false);
  assert.equal(allowsOrigin({ headers: { ...request.headers, "x-forwarded-proto": undefined } }, [], true), false);
});
