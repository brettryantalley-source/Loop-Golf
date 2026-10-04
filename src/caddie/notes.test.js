/*
 * notes.test.js — round notes (notes.js): build, save / edit, load per round, delete; storage is an
 * in-memory stub shaped like localStorage. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { NOTES_KEY, newNote, saveNote, loadNotes, deleteNote } from "./notes.js";

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

test("newNote: trimmed text, normalised gps and time, nulls where nothing is known", () => {
  const n = newNote({ roundId: "r1", courseId: 123, hole: 7, shotNo: 2, text: "  pin tucked behind the left bunker ",
    gps: { lat: 34.25, lon: -83.85, acc: 5 }, t: Date.UTC(2026, 9, 4, 14, 0) });
  assert.equal(n.schema, 1);
  assert.ok(n.id);
  assert.equal(n.courseId, "123");
  assert.equal(n.text, "pin tucked behind the left bunker");
  assert.deepEqual(n.gps, { lat: 34.25, lng: -83.85, accuracyM: 5 });
  assert.equal(n.t, "2026-10-04T14:00:00.000Z");
  const bare = newNote({ text: "windy" });
  assert.deepEqual([bare.roundId, bare.courseId, bare.hole, bare.shotNo, bare.gps], [null, null, null, null, null]);
  assert.ok(!Number.isNaN(Date.parse(bare.t)), "now when no time is given");
  assert.equal(newNote({ gps: { lat: 34 } }).gps, null, "half a fix is no fix");
  assert.equal(NOTES_KEY, "bogeyman-matches:notes:v1");
});

test("saveNote / loadNotes / deleteNote: one array under the key, per round, in time order; edits replace in place", () => {
  const st = makeStorage();
  assert.deepEqual(loadNotes(st, "r1"), []);
  const a = saveNote(st, newNote({ id: "a", roundId: "r1", hole: 3, text: "second", t: "2026-10-04T14:20:00Z" }));
  saveNote(st, newNote({ id: "b", roundId: "r1", hole: 1, text: "first", t: "2026-10-04T14:00:00Z" }));
  saveNote(st, newNote({ id: "c", roundId: "r2", hole: 1, text: "other round", t: "2026-10-05T14:00:00Z" }));
  assert.ok(Array.isArray(JSON.parse(st.getItem(NOTES_KEY))), "stored as an array");
  assert.deepEqual(loadNotes(st, "r1").map((n) => n.id), ["b", "a"]);
  assert.deepEqual(loadNotes(st).map((n) => n.id), ["b", "a", "c"], "every note without a round");
  // edit
  saveNote(st, { ...a, text: "second, edited" });
  assert.equal(loadNotes(st, "r1").find((n) => n.id === "a").text, "second, edited");
  assert.equal(JSON.parse(st.getItem(NOTES_KEY)).length, 3, "an edit is not a new note");
  // delete
  assert.equal(deleteNote(st, "a"), true);
  assert.equal(deleteNote(st, "a"), false);
  assert.deepEqual(loadNotes(st, "r1").map((n) => n.id), ["b"]);
});

test("notes storage: unreadable or foreign data reads as no notes", () => {
  assert.deepEqual(loadNotes(makeStorage({ [NOTES_KEY]: "{not json" })), []);
  assert.deepEqual(loadNotes(makeStorage({ [NOTES_KEY]: JSON.stringify({ a: 1 }) })), []);
  assert.deepEqual(loadNotes(makeStorage({ [NOTES_KEY]: JSON.stringify([null, 3, { text: "no id" }]) })), []);
  assert.deepEqual(loadNotes(null), []);
  const st = makeStorage({ [NOTES_KEY]: "{not json" });
  saveNote(st, newNote({ id: "x", roundId: "r", text: "fresh start" }));
  assert.deepEqual(loadNotes(st, "r").map((n) => n.id), ["x"]);
});
