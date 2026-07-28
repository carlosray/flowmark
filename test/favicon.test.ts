import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser tab uses the same FlowMark asset as the toolbar instead of the Lovable favicon", async () => {
  const rootRoute = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
  assert.match(rootRoute, /import flowmarkIcon from "\.\.\/assets\/flowmark-icon\.png"/);
  assert.match(rootRoute, /href: flowmarkIcon, type: "image\/png"/);
  assert.doesNotMatch(rootRoute, /\/favicon\.ico/);

  const icon = await readFile(new URL("../src/assets/flowmark-icon.png", import.meta.url));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 816);
  assert.equal(icon.readUInt32BE(20), 816);
  await assert.rejects(() => readFile(new URL("../public/favicon.ico", import.meta.url)));
  await assert.rejects(() => readFile(new URL("../public/flowmark-favicon.png", import.meta.url)));
});
