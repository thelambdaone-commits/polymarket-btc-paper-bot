import { createServer } from 'node:http';

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

export function handleStatusRequest(request, response, { getStatus, getMetrics } = {}) {
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
  if (request.url === '/health') return sendJson(response, 200, { ok: true });
  if (request.url === '/status') return sendJson(response, 200, getStatus?.() ?? {});
  if (request.url === '/metrics') return sendJson(response, 200, getMetrics?.() ?? {});
  return sendJson(response, 404, { error: 'not_found' });
}

export function createStatusServer({ port = 8787, host = '127.0.0.1', getStatus, getMetrics } = {}) {
  const server = createServer((request, response) => {
    return handleStatusRequest(request, response, { getStatus, getMetrics });
  });
  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        const onError = (error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(server.address()); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    stop() {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
