import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ruleActionOptions,
  ruleConditionOptions,
  ruleDueStateOptions,
  ruleTriggerOptions,
} from "../src/lib/rules-ui.ts";

test("visual editor exposes every new date-driven rule primitive", () => {
  assert.equal(
    ruleTriggerOptions().some(([kind]) => kind === "card.dueStateChanged"),
    true,
  );
  assert.deepEqual(
    ruleConditionOptions(true).map(([kind]) => kind),
    ["column", "tag", "completed", "dueState", "createdAgeDays", "completedAgeDays"],
  );
  assert.deepEqual(
    ruleDueStateOptions().map(([value]) => value),
    ["none", "overdue", "today", "tomorrow", "future"],
  );
  assert.equal(
    ruleActionOptions(false).some(([kind]) => kind === "sortByDueDate"),
    true,
  );
  assert.equal(
    ruleActionOptions(false).some(([kind]) => kind === "archiveCard"),
    true,
  );
});

test("rules editor renders composed condition controls with accessible labels", async () => {
  const source = await readFile(
    new URL("../src/components/board/RulesButton.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<ConditionsEditor rule=\{rule\} board=\{board\} \/>/);
  assert.match(source, /aria-label="Add condition"/);
  assert.match(source, /ariaLabel="Condition type"/);
  assert.match(source, /ariaLabel="Column condition operator"/);
  assert.match(source, /Sort every column by due date/);
});
