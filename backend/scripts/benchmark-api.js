#!/usr/bin/env node
// Sequential API latency sampler. It reports timings only and never logs response bodies or cookies.
const { performance } = require('node:perf_hooks');

function parseArgs(argv) {
  const options = { base: 'http://127.0.0.1:3000', paths: [], iterations: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') options.base = argv[++index];
    else if (argv[index] === '--path') options.paths.push(argv[++index]);
    else if (argv[index] === '--iterations') options.iterations = Number(argv[++index]);
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (!options.paths.length) options.paths = ['/api/health/live', '/api/health/ready'];
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 200) {
    throw new Error('--iterations must be an integer from 1 to 200');
  }
  const base = new URL(options.base);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('--base must use HTTP or HTTPS');
  return { ...options, base };
}

function percentile(sorted, value) {
  return sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cookieValue = process.env.GROUPBUK_BENCH_COOKIE;
  const cookie = cookieValue
    ? cookieValue.includes('=') ? cookieValue : `lendwise_session=${cookieValue}`
    : null;
  for (const path of options.paths) {
    const url = new URL(path, options.base);
    const timings = [];
    const statuses = {};
    let bytes = 0;
    for (let request = -Math.min(3, options.iterations); request < options.iterations; request += 1) {
      const started = performance.now();
      const response = await fetch(url, {
        headers: cookie ? { Cookie: cookie, Accept: 'application/json' } : { Accept: 'application/json' },
      });
      const body = await response.arrayBuffer();
      const durationMs = performance.now() - started;
      if (request >= 0) {
        timings.push(durationMs);
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        bytes = body.byteLength;
      }
    }
    timings.sort((left, right) => left - right);
    const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    console.log(JSON.stringify({
      path: url.pathname,
      iterations: timings.length,
      statusCounts: statuses,
      responseBytes: bytes,
      minMs: Number(timings[0].toFixed(2)),
      medianMs: Number(percentile(timings, 0.5).toFixed(2)),
      p95Ms: Number(percentile(timings, 0.95).toFixed(2)),
      maxMs: Number(timings.at(-1).toFixed(2)),
      averageMs: Number(average.toFixed(2)),
    }));
  }
}

main().catch(error => {
  console.error(`Benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
