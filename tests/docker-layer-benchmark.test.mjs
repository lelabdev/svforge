import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeImages } from '../scripts/docker-layer-benchmark.mjs';

test('reports overlapping layer identities without pretending to measure saved bytes', () => {
  const result = summarizeImages([
    { RepoTags: ['example/a:1'], Size: 1024 * 1024, RootFS: { Layers: ['sha256:base', 'sha256:one'] } },
    { RepoTags: ['example/b:1'], Size: 2 * 1024 * 1024, RootFS: { Layers: ['sha256:base', 'sha256:two'] } }
  ]);
  assert.equal(result.logicalMiBSum, 3);
  assert.equal(result.distinctLayers, 3);
  assert.equal(result.sharedLayerDigests, 1);
  assert.deepEqual(result.images.map((x) => [x.sharedLayers, x.exclusiveLayers]), [[1, 1], [1, 1]]);
});

test('does not count duplicate digests within one image as cross-image sharing', () => {
  const result = summarizeImages([
    { Size: 1024, RootFS: { Layers: ['sha256:same', 'sha256:same'] } }
  ]);
  assert.equal(result.sharedLayerDigests, 0);
  assert.equal(result.images[0].layers, 1);
});

test('rejects malformed inspect data', () => {
  assert.throws(() => summarizeImages([]), /non-empty/);
  assert.throws(() => summarizeImages([{ Size: 4 }]), /RootFS/);
});
