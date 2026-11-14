const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { checkTcp } = require('../scripts/integration-preflight');

test('TCP preflight reports successful local test endpoint connectivity', async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await checkTcp('127.0.0.1', port, 500);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('TCP preflight reports an unreachable non-listening local endpoint cleanly', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(() => checkTcp('127.0.0.1', port, 500), error => {
    assert.ok(['ECONNREFUSED', 'ETIMEDOUT'].includes(error.code));
    return true;
  });
});
