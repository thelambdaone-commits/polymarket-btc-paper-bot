import test from 'node:test';
import assert from 'node:assert/strict';

import { handleStatusRequest } from '../src/status-server.js';

test('serves health, status and metrics responses', () => {
  const responses = [];
  const response = {
    writeHead: (status, headers) => { response.status = status; response.headers = headers; },
    end: (body) => responses.push({ status: response.status, body: JSON.parse(body) }),
  };
  const providers = { getStatus: () => ({ paperOnly: true }), getMetrics: () => ({ samples: 3 }) };
  handleStatusRequest({ method: 'GET', url: '/health' }, response, providers);
  handleStatusRequest({ method: 'GET', url: '/status' }, response, providers);
  handleStatusRequest({ method: 'GET', url: '/metrics' }, response, providers);
  assert.deepEqual(responses, [
    { status: 200, body: { ok: true } },
    { status: 200, body: { paperOnly: true } },
    { status: 200, body: { samples: 3 } },
  ]);
});
