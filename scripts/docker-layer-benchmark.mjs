#!/usr/bin/env node
/**
 * Inspect shared Docker image layer identities for #604.
 *
 * Examples:
 *   node scripts/docker-layer-benchmark.mjs image-a:tag image-b:tag
 *   ssh nova 'docker image inspect image-a:tag image-b:tag' |
 *     node scripts/docker-layer-benchmark.mjs --stdin
 *
 * Image Size is a logical size, NOT physical bytes consumed. This script
 * intentionally does not claim a space saving from layer identity alone.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mib = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

export function summarizeImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('Expected a non-empty Docker image inspect JSON array');
  }

  const countByLayer = new Map();
  const normalized = images.map((image, index) => {
    const layers = image?.RootFS?.Layers;
    if (!Array.isArray(layers) || typeof image.Size !== 'number') {
      throw new Error(`Image ${index + 1}: missing Size or RootFS.Layers`);
    }
    const unique = [...new Set(layers)];
    for (const digest of unique) {
      countByLayer.set(digest, (countByLayer.get(digest) ?? 0) + 1);
    }
    return {
      name: image.RepoTags?.find((tag) => tag !== '<none>:<none>') ?? image.Id ?? `image-${index + 1}`,
      logicalBytes: image.Size,
      layers: unique
    };
  });

  return {
    images: normalized.map((image) => ({
      name: image.name,
      logicalMiB: mib(image.logicalBytes),
      layers: image.layers.length,
      sharedLayers: image.layers.filter((digest) => countByLayer.get(digest) > 1).length,
      exclusiveLayers: image.layers.filter((digest) => countByLayer.get(digest) === 1).length
    })),
    logicalMiBSum: mib(normalized.reduce((acc, image) => acc + image.logicalBytes, 0)),
    distinctLayers: countByLayer.size,
    sharedLayerDigests: [...countByLayer.values()].filter((n) => n > 1).length
  };
}

function main() {
  const args = process.argv.slice(2);
  const fromStdin = args.includes('--stdin');
  const json = args.includes('--json');
  const refs = args.filter((arg) => arg !== '--stdin' && arg !== '--json');

  if ((!fromStdin && refs.length === 0) || (fromStdin && refs.length > 0)) {
    process.stderr.write('Usage: node scripts/docker-layer-benchmark.mjs [--json] IMAGE... | --stdin [--json]\n');
    process.exitCode = 2;
    return;
  }

  const raw = fromStdin
    ? readFileSync(0, 'utf8')
    : execFileSync('docker', ['image', 'inspect', ...refs], { encoding: 'utf8' });
  const result = summarizeImages(JSON.parse(raw));

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  for (const image of result.images) {
    process.stdout.write(
      `${image.name}: ${image.logicalMiB} MiB logical, ${image.layers} layers ` +
      `(${image.sharedLayers} shared, ${image.exclusiveLayers} exclusive)\n`
    );
  }
  process.stdout.write(
    `Total logical: ${result.logicalMiBSum} MiB; ` +
    `${result.sharedLayerDigests}/${result.distinctLayers} distinct layers used by multiple selected images.\n` +
    'Note: layer overlap does NOT measure bytes saved. Compare Docker unique/shared sizes and actual disk use before/after controlled builds.\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Docker layer benchmark: ${error.message}\n`);
    process.exitCode = 1;
  }
}
