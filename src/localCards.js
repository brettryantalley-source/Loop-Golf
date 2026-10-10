/*
 * localCards.js — scorecards Brett has verified by hand for clubs the course API gets wrong.
 *
 * Ironwood Golf Club (Fishers, IN), 27 holes, transcribed from the printed card Sep 29 2026: after
 * the first round there the API's "… / Ridge" routing did not match the Ridge nine as played,
 * and each nine's handicaps run 1–9, so a composed 18 needs the odd/even rule
 * (`normalizeStrokeIndex` in routing.js) before the ghost can take strokes on it.
 *
 * Every nine: `label`, `pars` (9), `si` (the card's 1–9 handicap), `yards` per tee name (9 each).
 * Rating and slope are NOT on the card — Setup takes them from the API routing whose two nines
 * match (see routing.js `localRoutingFor`). Pure data plus a sanity check; no DOM, no fetch.
 */

export const LOCAL_CLUBS = [
  {
    key: "ironwood-fishers",
    name: "Ironwood Golf Club",
    // v22.31 (C5, D102): the club's own golfcourseapi entry (c2qw5c2h) has a location; its routing
    // entries don't (latitude null), so the caddie had no anchor for test mode or the weather
    location: { lat: 39.9465811, lon: -85.9787805 },
    match: { name: /ironwood/i, state: /^(IN|Indiana)$/i, city: /fishers/i },
    tees: ["Blue", "Ironwood", "White", "Green", "Red", "Family"],
    nines: [
      {
        label: "Valley",
        pars: [4, 5, 3, 4, 5, 4, 4, 3, 4],
        si:   [8, 9, 6, 3, 7, 4, 1, 5, 2],
        yards: {
          Blue:     [365, 532, 185, 365, 530, 390, 364, 205, 432],
          Ironwood: [365, 532, 150, 365, 530, 390, 350, 146, 391],
          White:    [340, 480, 150, 348, 495, 370, 350, 146, 391],
          Green:    [320, 398, 120, 330, 398, 301, 265, 115, 334],
          Red:      [305, 398, 120, 265, 398, 301, 265, 115, 334],
          Family:   [257, 300,  88, 196, 312, 215, 190,  70, 216],
        },
      },
      {
        label: "Lakes",
        pars: [4, 4, 4, 4, 5, 4, 3, 5, 3],
        si:   [3, 2, 9, 4, 8, 1, 6, 7, 5],
        yards: {
          Blue:     [431, 390, 373, 347, 488, 410, 165, 530, 203],
          Ironwood: [390, 390, 373, 347, 467, 410, 135, 530, 156],
          White:    [390, 373, 354, 340, 467, 395, 135, 499, 156],
          Green:    [354, 358, 312, 317, 416, 307, 134, 421, 105],
          Red:      [354, 345, 266, 317, 391, 285,  99, 421, 105],
          Family:   [239, 226, 203, 202, 295, 247,  94, 295,  72],
        },
      },
      {
        label: "Ridge",
        pars: [4, 4, 4, 4, 3, 5, 3, 5, 4],
        si:   [4, 7, 3, 2, 9, 6, 5, 8, 1],
        yards: {
          Blue:     [365, 333, 371, 403, 146, 511, 160, 521, 350],
          Ironwood: [365, 333, 355, 379, 132, 511, 150, 521, 350],
          White:    [345, 310, 355, 379, 132, 476, 150, 492, 330],
          Green:    [302, 280, 333, 318, 119, 425, 106, 392, 250],
          Red:      [281, 194, 244, 318,  87, 425, 107, 392, 250],
          Family:   [207, 194, 181, 207,  87, 316, 107, 330, 210],
        },
      },
    ],
    /* the card's OUT totals per tee, in nine order — checked below so a transcription slip fails at import */
    check: {
      Blue: [3368, 3337, 3160], Ironwood: [3219, 3198, 3096], White: [3070, 3109, 2969],
      Green: [2581, 2724, 2525], Red: [2501, 2583, 2298], Family: [1844, 1873, 1839],
    },
  },
  {
    /* v22.43 (D114): The Golf Club at Bradshaw Farm (Woodstock, GA), 27 holes, from the printed card
       (rev. 4/23) Brett sent Oct 10. The API has the same pars and handicaps but older yardages, and
       only three routings in one order each (Red/White, White/Blue, Blue/Red); the card plays any
       two nines in either order. Ratings and slopes come from the API routing with both nines
       (they match the card's). "Red" is the forward tee (the card's women's row). */
    key: "bradshaw-woodstock",
    name: "The Golf Club at Bradshaw Farm",
    match: { name: /bradshaw/i, state: /^(GA|Georgia)$/i, city: /woodstock/i },
    tees: ["Gold", "Blue", "White", "Red"],
    nines: [
      {
        label: "Red",
        pars: [4, 5, 4, 4, 3, 4, 5, 3, 4],
        si:   [3, 7, 6, 5, 9, 2, 4, 8, 1],
        yards: {
          Gold:  [435, 498, 409, 361, 150, 410, 495, 154, 428],
          Blue:  [409, 460, 393, 343, 133, 381, 471, 132, 406],
          White: [361, 425, 372, 334, 111, 304, 432, 115, 379],
          Red:   [295, 342, 290, 265,  96, 265, 392,  95, 279],
        },
      },
      {
        label: "White",
        pars: [4, 5, 4, 3, 4, 3, 5, 4, 4],
        si:   [5, 8, 2, 6, 3, 9, 4, 1, 7],
        yards: {
          Gold:  [396, 509, 394, 219, 422, 178, 573, 425, 382],
          Blue:  [368, 484, 381, 190, 396, 163, 549, 400, 355],
          White: [332, 460, 368, 155, 360, 140, 482, 388, 294],
          Red:   [253, 387, 326, 119, 303, 102, 442, 240, 264],
        },
      },
      {
        label: "Blue",
        pars: [4, 4, 5, 4, 3, 4, 3, 5, 4],
        si:   [2, 8, 4, 6, 9, 1, 5, 3, 7],
        yards: {
          Gold:  [415, 387, 547, 408, 162, 418, 214, 509, 378],
          Blue:  [381, 337, 512, 362, 143, 389, 196, 475, 358],
          White: [351, 306, 473, 326, 129, 353, 163, 430, 334],
          Red:   [276, 279, 432, 274, 106, 305, 100, 370, 283],
        },
      },
    ],
    check: {
      Gold: [3340, 3498, 3438], Blue: [3128, 3286, 3153], White: [2833, 2979, 2865], Red: [2319, 2436, 2425],
    },
  },
];

/** The local card for an API club (search result or full course), or null. */
export function localClubFor(clubName, location) {
  const name = String(clubName || "");
  const st = String(location?.state || ""), city = String(location?.city || "");
  return LOCAL_CLUBS.find((c) =>
    c.match.name.test(name) &&
    (!c.match.state || !st || c.match.state.test(st)) &&
    (!c.match.city || !city || c.match.city.test(city))) || null;
}

for (const c of LOCAL_CLUBS) {
  if (c.nines.length !== 3) throw new Error(`localCards: ${c.name} has ${c.nines.length} nines`);
  c.nines.forEach((n, i) => {
    for (const k of ["pars", "si"]) if (n[k].length !== 9) throw new Error(`localCards: ${c.name} ${n.label} ${k} has ${n[k].length} holes`);
    if (n.pars.reduce((a, b) => a + b, 0) !== 36) throw new Error(`localCards: ${c.name} ${n.label} par is not 36`);
    if ([...n.si].sort((a, b) => a - b).join() !== "1,2,3,4,5,6,7,8,9") throw new Error(`localCards: ${c.name} ${n.label} handicaps are not 1–9`);
    for (const t of c.tees) {
      const y = n.yards[t];
      if (!y || y.length !== 9) throw new Error(`localCards: ${c.name} ${n.label} ${t} yards missing`);
      const sum = y.reduce((a, b) => a + b, 0);
      if (c.check?.[t] && sum !== c.check[t][i]) throw new Error(`localCards: ${c.name} ${n.label} ${t} adds to ${sum}, card says ${c.check[t][i]}`);
    }
  });
}
