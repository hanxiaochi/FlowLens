import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {teamJsonRequest} from './team-http.mjs';

test('JSON transport preserves successful responses and explicit HTTP errors', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(request.url === '/ok' ? 200 : 409, {'Content-Type': 'application/json'});
    response.end(JSON.stringify(request.url === '/ok' ? {saved: true} : {error: 'Changed revision'}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.deepEqual(await teamJsonRequest(base + '/ok'), {saved: true});
    await assert.rejects(teamJsonRequest(base + '/conflict'), error => error.status === 409 && error.message === 'Changed revision');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('JSON transport timeout covers both response headers and an incomplete body', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/body') {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.write('{');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/headers', '/body']) {
      await assert.rejects(teamJsonRequest(base + path, {}, 50), error => /超时/.test(error.message) && error.status === undefined);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('invalid response content is not mistaken for a definite business rejection', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(502, {'Content-Type': 'text/html'});
    response.end('<h1>Gateway failure</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(teamJsonRequest('http://127.0.0.1:' + server.address().port), error => error.status === undefined);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
