import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFlowmarkCardUrl,
  buildSessionCardUrl,
  parseFlowmarkCardUrl,
} from "../src/lib/card-links.ts";

test("builds a port-independent custom URL for an immutable card ID", () => {
  assert.equal(
    buildFlowmarkCardUrl("/Users/example/Work Tasks", "card_jnuuoqv59qjk"),
    "flowmark://open?workspace=%2FUsers%2Fexample%2FWork+Tasks&card=card_jnuuoqv59qjk",
  );
});

test("parses only the supported absolute-workspace card URL", () => {
  assert.deepEqual(
    parseFlowmarkCardUrl(
      "flowmark://open?workspace=%2FUsers%2Fexample%2FWork+Tasks&card=card_jnuuoqv59qjk",
    ),
    {
      workspacePath: "/Users/example/Work Tasks",
      cardId: "card_jnuuoqv59qjk",
    },
  );

  for (const invalid of [
    "https://open?workspace=%2Ftmp%2Ftasks&card=card_example",
    "flowmark://unknown?workspace=%2Ftmp%2Ftasks&card=card_example",
    "flowmark://open?workspace=relative&card=card_example",
    "flowmark://open?workspace=%2Ftmp%2Ftasks&card=not_a_card",
    "flowmark://open?workspace=%2Ftmp%2Ftasks&card=card_UPPER",
  ]) {
    assert.throws(() => parseFlowmarkCardUrl(invalid), /Invalid Flowmark card link/);
  }
});

test("builds the HTTP deep link from the selected live session", () => {
  assert.equal(
    buildSessionCardUrl("http://127.0.0.1:4789/", "card_jnuuoqv59qjk"),
    "http://127.0.0.1:4789/?card=card_jnuuoqv59qjk",
  );
});
