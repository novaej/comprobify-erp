import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MockSri } from '../sri';

// The mock behind real HTTP, so tests go through the client's fetch, timeouts included.
// `hang` keeps every request open, to test the client's timeout.
export async function serveMockSri(
  mock: MockSri | 'hang',
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    if (mock === 'hang') return;
    let body = '';
    request.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      mock
        .transport({ url: request.url ?? '', body, timeoutMs: 0 })
        .then((answer) => {
          response.writeHead(answer.status, { 'Content-Type': 'text/xml; charset=utf-8' });
          response.end(answer.body);
        })
        .catch(() => request.socket.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/comprobantes-electronicos-ws`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
