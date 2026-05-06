import assert from "node:assert/strict";
import { mergeDbAgentsWithFallbackAgents, orderGhlAgentsForAssignment } from "../src/lib/ghl-agents.js";

const fallbackAgents = [
  { name: "Fallback One", ghlUserId: "fallback-1", transferNumber: "+525500000001", priority: 1 },
  { name: "Fallback Two", ghlUserId: "fallback-2", transferNumber: "+525500000002", priority: 2 },
];

const dbAgents = [
  { name: "Marina Agent", ghlUserId: "marina-1", transferNumber: "+525511111111", priority: 1, active: true },
  { name: "Inactive Agent", ghlUserId: "inactive-1", transferNumber: "+525522222222", priority: 2, active: false },
  { name: "Assigned Agent", ghlUserId: "assigned-1", transferNumber: "+525533333333", priority: 3, active: true },
];

const merged = mergeDbAgentsWithFallbackAgents(dbAgents, fallbackAgents);

assert.deepEqual(
  merged.map((agent) => agent.ghlUserId),
  ["marina-1", "assigned-1"],
  "active database agents should replace fallback agents and ignore inactive rows",
);

const ordered = orderGhlAgentsForAssignment(merged, "assigned-1");

assert.deepEqual(
  ordered.map((agent) => agent.ghlUserId),
  ["assigned-1", "marina-1"],
  "assignedTo should be first in the transfer/failover pool",
);

console.log("ghl-agents tests passed");
