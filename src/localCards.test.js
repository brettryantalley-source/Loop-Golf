/*
 * localCards.test.js — v22.12: the hand-verified Ironwood card (src/localCards.js) and the club
 * matcher Setup uses to swap the API's routings for it. The module's own import-time check already
 * throws on a transcription slip; these pin the matcher and the shape Setup reads.
 * Run: node --test src/localCards.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_CLUBS, localClubFor } from "./localCards.js";

test("Ironwood card: three nines of nine holes, par 36 each, 1–9 handicaps, yards for all six tees", () => {
  const c = LOCAL_CLUBS.find((x) => x.key === "ironwood-fishers");
  assert.ok(c);
  assert.deepEqual(c.nines.map((n) => n.label), ["Valley", "Lakes", "Ridge"]);
  assert.deepEqual(c.tees, ["Blue", "Ironwood", "White", "Green", "Red", "Family"]);
  for (const n of c.nines) {
    assert.equal(n.pars.length, 9); assert.equal(n.si.length, 9);
    assert.equal(n.pars.reduce((a, b) => a + b, 0), 36, n.label);
    assert.deepEqual([...n.si].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9], n.label);
    for (const t of c.tees) assert.equal(n.yards[t].length, 9, `${n.label} ${t}`);
  }
  // the card's OUT totals, per tee, in nine order
  c.tees.forEach((t) => c.nines.forEach((n, i) => assert.equal(n.yards[t].reduce((a, b) => a + b, 0), c.check[t][i], `${n.label} ${t}`)));
});

test("localClubFor: matches on club name + city/state, tolerates a missing location, rejects another state", () => {
  const fishers = { city: "Fishers", state: "IN" };
  assert.equal(localClubFor("Ironwood Golf Club", fishers)?.key, "ironwood-fishers");
  assert.equal(localClubFor("IRONWOOD GOLF CLUB", { city: "fishers", state: "Indiana" })?.key, "ironwood-fishers");
  assert.equal(localClubFor("Ironwood Golf Club", null)?.key, "ironwood-fishers", "no location in the result: the name decides");
  assert.equal(localClubFor("Ironwood Golf Club", { state: "IN" })?.key, "ironwood-fishers");
  assert.equal(localClubFor("Ironwood Golf Club", { city: "Byron", state: "MI" }), null, "another Ironwood");
  assert.equal(localClubFor("Ironwood Golf Club", { city: "Noblesville", state: "IN" }), null, "same state, another town");
  assert.equal(localClubFor("Hampton Golf Village", { city: "Hampton", state: "GA" }), null);
  assert.equal(localClubFor("", fishers), null);
  assert.equal(localClubFor(null, null), null);
});
