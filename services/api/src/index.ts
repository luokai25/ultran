/**
 * Cloud control-plane entry point.
 *
 * Deliberately minimal at this stage: a health endpoint and a stub router.
 * Everything here is optional infrastructure - the local agent never depends
 * on this process being reachable.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8080);

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (req.method === 'GET' && url === '/v1/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'ultran-api',
        version: '0.1.0',
        time: new Date().toISOString(),
      }),
    );
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
