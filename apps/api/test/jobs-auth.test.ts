import assert from "node:assert/strict";
import {
  extractJobAuthToken,
  isAuthorizedJobRequest,
} from "../src/lib/jobs-auth.js";

assert.equal(
  extractJobAuthToken({
    authorizationHeader: "Bearer super-secret",
    queryKey: null,
  }),
  "super-secret",
  "should extract bearer token from authorization header",
);

assert.equal(
  extractJobAuthToken({
    authorizationHeader: "Basic abc123",
    queryKey: "fallback-secret",
  }),
  "fallback-secret",
  "should ignore non-bearer authorization headers and use query fallback",
);

assert.equal(
  isAuthorizedJobRequest({
    jobsApiKey: "",
    authorizationHeader: undefined,
    queryKey: null,
  }),
  true,
  "should allow jobs requests when no shared secret is configured",
);

assert.equal(
  isAuthorizedJobRequest({
    jobsApiKey: "super-secret",
    authorizationHeader: "Bearer super-secret",
    queryKey: null,
  }),
  true,
  "should allow matching bearer tokens",
);

assert.equal(
  isAuthorizedJobRequest({
    jobsApiKey: "super-secret",
    authorizationHeader: undefined,
    queryKey: "super-secret",
  }),
  true,
  "should allow matching query tokens as a scheduler fallback",
);

assert.equal(
  isAuthorizedJobRequest({
    jobsApiKey: "super-secret",
    authorizationHeader: "Bearer wrong-secret",
    queryKey: null,
  }),
  false,
  "should reject non-matching tokens",
);

console.log("jobs-auth tests passed");
