import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRenderedImage, parseRenderedImages } from "../src/lib/rendered-images.ts";

const id = "a".repeat(32);
const artifact = {
  artifact_id: id,
  width: 2400,
  height: 4200,
  files: { image: `artifacts/renderings/${id}/image.png`, top: `artifacts/renderings/${id}/top.png` },
};

test("malformed artifacts and arbitrary URLs never become preview links", () => {
  for (const value of [null, [], {}, { ...artifact, artifact_id: "../another-user" }, { ...artifact, height: Infinity }]) {
    assert.equal(parseRenderedImage(value), null);
  }
  assert.deepEqual(parseRenderedImage({ ...artifact, files: {
    image: "https://example.com/private.png",
    top: `artifacts/renderings/${"b".repeat(32)}/top.png`,
    middle: `artifacts/renderings/${id}/../../secret.png`,
  } }).files, {});
});

test("replayed tool events and final metadata keep one preview per artifact", () => {
  const second = { ...artifact, artifact_id: "b".repeat(32), files: {} };
  assert.deepEqual(parseRenderedImages([artifact, null, second, artifact]), [artifact, second]);
  assert.deepEqual(parseRenderedImages(undefined), []);
});
