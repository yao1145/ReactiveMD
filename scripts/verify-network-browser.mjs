import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const fixture = 'tests/browser/network-channels-fixture.html';
const streams = new Set();
const sockets = new Set();
const httpRequests = [];
const socketRequests = [];
let streamOpens = 0;

function networkEndpoints(server) {
  server.middlewares.use(async (request, response, next) => {
    if (request.url === '/__results') {
      streamOpens++;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.write('data: 7\n\n');
      streams.add(response);
      response.once('close', () => streams.delete(response));
      return;
    }
    if (request.method === 'POST' && request.url === '/__answers') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      httpRequests.push({
        payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        key: request.headers['idempotency-key'],
        response,
      });
      return;
    }
    next();
  });

  // Reuse Vite's loopback WebSocket upgrade. After the handshake, exchange
  // the adapter's default JSON frames on the dedicated test connection.
  server.ws.on('connection', (socket, request) => {
    if (!new URL(request.url, 'http://localhost').searchParams.has('rmd-network-test')) return;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      socketRequests.push(message);
      if (socketRequests.length !== 2) return;
      const [first, second] = socketRequests;
      socket.send(JSON.stringify({ type: 'data', value: 11 }));
      socket.send(JSON.stringify({ type: 'ack', requestId: first.requestId, padding: '😀'.repeat(26) }));
      socket.send(JSON.stringify({ type: 'ack', requestId: second.requestId }));
      socket.send(JSON.stringify({ type: 'reject', requestId: first.requestId, message: 'Vote rejected' }));
    });
  });
}

async function checkHttpAndSse(page) {
  const button = page.getByRole('button', { name: 'Send', exact: true });
  const feedback = page.locator('[data-rmd-component="submit-button"]').getByRole('status');
  const authorization = page.getByRole('button', { name: 'Toggle authorization' });
  const first = page.getByLabel('First count');
  const second = page.getByLabel('Second count');
  await expect(button).toBeDisabled();
  assert.equal(streamOpens, 0);
  await authorization.click();
  await expect(first).toHaveText('7');
  await expect(second).toHaveText('7');
  assert.equal(streamOpens, 1);

  await page.getByRole('button', { name: 'Edit source' }).click();
  await expect(page.getByText('Extra prose')).toBeVisible();
  assert.equal(streamOpens, 1);

  const choice = page.getByRole('textbox', { name: 'Choice' });
  await choice.pressSequentially('yes');
  await page.getByRole('textbox', { name: 'Extra' }).fill('not sent');
  assert.equal(httpRequests.length, 0);
  await choice.fill('x');
  await button.click();
  await expect(feedback).toHaveText('Field "choice" has an invalid value.');
  await expect(choice).toHaveValue('x');
  assert.equal(httpRequests.length, 0);

  await choice.fill('yes');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => httpRequests.length).toBe(1);
  await expect(button).toBeDisabled();
  assert.deepEqual(httpRequests[0].payload, { choice: 'yes', comment: '' });
  httpRequests[0].response.writeHead(503).end();
  await expect(feedback).toContainText('Submission result is unconfirmed');
  await expect(button).toBeEnabled();

  await button.dblclick();
  await expect.poll(() => httpRequests.length).toBe(2);
  await expect(button).toBeDisabled();
  assert.ok(httpRequests[0].key);
  assert.equal(httpRequests[1].key, httpRequests[0].key);
  assert.deepEqual(httpRequests[1].payload, httpRequests[0].payload);
  httpRequests[1].response.writeHead(204).end();
  await expect(feedback).toHaveText('Submitted.');

  await page.getByRole('button', { name: 'Toggle first' }).click();
  await expect(first).toHaveCount(0);
  for (const response of streams) response.write('data: 8\n\n');
  await expect(second).toHaveText('8');
  assert.equal(streamOpens, 1);
  const toggleLast = page.getByRole('button', { name: 'Toggle second' });
  await toggleLast.click();
  await expect(second).toHaveCount(0);
  await expect.poll(() => streams.size).toBe(0);
  await toggleLast.click();
  await expect(second).toHaveText('7');
  assert.equal(streamOpens, 2);

  await page.getByRole('button', { name: 'Switch document' }).click();
  await expect.poll(() => streamOpens).toBe(3);
  await expect(second).toHaveText('7');
  await expect.poll(() => streams.size).toBe(1);
  await authorization.click();
  await expect(second).toHaveText('offline');
  await expect(button).toBeDisabled();
  await expect.poll(() => streams.size).toBe(0);
  assert.equal(httpRequests.length, 2);
}

async function checkMappedExternalsAndReceipt(page) {
  const authorization = page.getByRole('button', { name: 'Toggle authorization' });
  const choice = page.getByRole('textbox', { name: 'Choice' });
  await page.getByRole('button', { name: 'Toggle second' }).click();
  await page.getByRole('button', { name: 'Toggle mapping' }).click();
  await expect(page.getByText('Mapped votes: 0')).toBeVisible();
  const previousOpens = streamOpens;
  await authorization.click();
  await expect(page.getByText('Mapped votes: 9')).toBeVisible();
  await expect(page.getByText('Live voting data')).toBeVisible();
  assert.equal(streamOpens, previousOpens + 1);

  await choice.fill('yes');
  await choice.fill('x');
  for (const response of streams) response.write('data: 11\n\n');
  await expect(page.getByText('Mapped votes: 13')).toBeVisible();
  await expect(choice).toHaveValue('x');

  await choice.fill('yes');
  await page.getByRole('button', { name: 'Send and show receipt' }).click();
  await expect.poll(() => httpRequests.length).toBe(3);
  httpRequests[2].response.writeHead(200, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ registrationId: 'R-1042', internalRecord: 'host-only' }));
  await expect(page.getByLabel('Registration receipt')).toHaveText('R-1042');
  await authorization.click();
  await expect(page.getByText('Mapped votes: 0')).toBeVisible();
  await expect(page.getByText('Live voting data')).toBeHidden();
  await expect.poll(() => streams.size).toBe(0);
}

async function checkWebSocket(page, endpoint) {
  const result = await page.evaluate(async (url) => {
    const { createNetworkSession } = await import('/src/runtime-services/network.ts');
    const { webSocketChannel } = await import('/src/runtime-services/browser/duplex.ts');
    const session = createNetworkSession({ channels: { survey: webSocketChannel({
      endpoint: url, protocols: ['vite-hmr'], validateSubmit: () => true,
      validateSubscribe: value => typeof value === 'number',
      maxMessageBytes: 128,
    }) } });
    try {
      let didOpen, didReceive;
      const errors = [];
      const open = new Promise(resolve => { didOpen = resolve; });
      const data = new Promise(resolve => { didReceive = resolve; });
      const off = session.network.subscribe('survey', event => {
        if (event.type === 'status' && event.state === 'open') didOpen();
        if (event.type === 'data') didReceive(event.value);
        if (event.type === 'error') errors.push(event.error.code);
      });
      await open;
      const [rejected, accepted, count] = await Promise.all([
        session.network.submit('survey', { answer: 'no' }),
        session.network.submit('survey', { answer: 'yes' }),
        data,
      ]);
      off();
      return { rejected, accepted, count, errors };
    } finally {
      session.dispose();
    }
  }, endpoint);
  assert.deepEqual(result, {
    rejected: { ok: false, error: { code: 'rejected', message: 'Vote rejected' } },
    accepted: { ok: true },
    count: 11,
    errors: ['invalid-data'],
  });
  assert.deepEqual(socketRequests.map(message => message.payload), [{ answer: 'no' }, { answer: 'yes' }]);
  assert.notEqual(socketRequests[0].requestId, socketRequests[1].requestId);
  await expect.poll(() => sockets.size).toBe(0);
}

async function checkWebRtc(page) {
  const result = await page.evaluate(async () => {
    const { createNetworkSession } = await import('/src/runtime-services/network.ts');
    const { webRtcChannel } = await import('/src/runtime-services/browser/duplex.ts');
    const local = new RTCPeerConnection({ iceServers: [] });
    const remote = new RTCPeerConnection({ iceServers: [] });
    const event = (target, name) => new Promise(resolve => target.addEventListener(name, resolve, { once: true }));
    const gather = async (peer) => {
      while (peer.iceGatheringState !== 'complete') await event(peer, 'icegatheringstatechange');
    };
    let session;
    try {
      const localChannel = local.createDataChannel('survey');
      const remoteChannelEvent = event(remote, 'datachannel');
      await local.setLocalDescription(await local.createOffer());
      await gather(local);
      await remote.setRemoteDescription(local.localDescription);
      await remote.setLocalDescription(await remote.createAnswer());
      await gather(remote);
      await local.setRemoteDescription(remote.localDescription);
      const { channel: remoteChannel } = await remoteChannelEvent;
      if (remoteChannel.readyState !== 'open') await event(remoteChannel, 'open');
      let releases = 0;
      session = createNetworkSession({ channels: { survey: webRtcChannel({
        endpoint: '/signal',
        connect: () => ({
          channel: localChannel,
          release() { releases++; local.close(); remote.close(); },
        }),
        validateSubmit: value => typeof value.answer === 'string',
        validateSubscribe: value => typeof value === 'number',
      }) } });
      let didOpen, didReceive;
      const open = new Promise(resolve => { didOpen = resolve; });
      const data = new Promise(resolve => { didReceive = resolve; });
      const off = session.network.subscribe('survey', message => {
        if (message.type === 'status' && message.state === 'open') didOpen();
        if (message.type === 'data') didReceive(message.value);
      });
      await open;
      remoteChannel.send(JSON.stringify({ type: 'data', value: 19 }));
      const count = await data;

      const request = event(remoteChannel, 'message');
      const submission = session.network.submit('survey', { answer: 'yes' });
      const message = JSON.parse((await request).data);
      off();
      const stateWhilePending = localChannel.readyState;
      remoteChannel.send(JSON.stringify({ type: 'ack', requestId: message.requestId }));
      const confirmed = await submission;
      return { confirmed, count, payload: message.payload, stateWhilePending, releases };
    } finally {
      session?.dispose();
      local.close();
      remote.close();
    }
  });
  assert.deepEqual(result, {
    confirmed: { ok: true }, count: 19, payload: { answer: 'yes' },
    stateWhilePending: 'open', releases: 1,
  });
}

async function withDeadline(name, work) {
  let timer;
  try {
    await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(name + ' timed out')), 20_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkSurveyReplay(browser) {
  const root = fileURLToPath(new URL('../examples/network-survey/', import.meta.url));
  const survey = await createServer({
    root, mode: 'http', configFile: root + 'vite.config.ts',
    server: { host: '127.0.0.1', port: 0 },
  });
  const page = await browser.newPage();
  const replies = [];
  try {
    await survey.listen();
    const base = survey.resolvedUrls.local[0];
    await page.route('**/api/survey/answers', async route => {
      const response = await route.fetch();
      replies.push({ headers: await route.request().allHeaders(), result: await response.json() });
      if (replies.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await page.goto(base);
    const tally = page.locator('[data-survey-tally]');
    const button = page.getByRole('button', { name: '提交回答' });
    const feedback = page.locator('[data-rmd-component="submit-button"]').getByRole('status');
    await expect(tally).toHaveAttribute('data-survey-yes', '3');
    await expect(page.getByText(/已有\s*4\s*人投票/)).toBeVisible();
    await button.click();
    await expect(feedback).toContainText('提交结果未确认');
    await expect(tally).toHaveAttribute('data-survey-yes', '4');
    await expect(page.getByText(/已有\s*5\s*人投票/)).toBeVisible();
    await button.click();
    await expect(feedback).toHaveText('已提交。');
    assert.equal(replies.length, 2);
    assert.ok(replies[0].headers['idempotency-key']);
    assert.equal(replies[1].headers['idempotency-key'], replies[0].headers['idempotency-key']);
    assert.deepEqual(replies.map(reply => reply.result), [
      { ok: true, counts: { yes: 4, no: 1 } },
      { ok: true, counts: { yes: 4, no: 1 } },
    ]);
    await expect(tally).toHaveAttribute('data-survey-yes', '4');

    const endpoint = new URL('/api/survey/answers', base).href;
    const headers = {
      'idempotency-key': replies[0].headers['idempotency-key'],
      'x-survey-participant': replies[0].headers['x-survey-participant'],
    };
    assert.match(headers['x-survey-participant'], /^[a-f0-9]{32}$/);
    const different = await page.request.post(endpoint, {
      headers, data: { choice: 'no', comment: '' },
    });
    assert.equal(different.status(), 409);
    const otherParticipant = {
      headers: { ...headers, 'x-survey-participant': '0'.repeat(32) },
      data: { choice: 'yes', comment: '' },
    };
    const concurrent = await Promise.all([
      page.request.post(endpoint, otherParticipant),
      page.request.post(endpoint, otherParticipant),
    ]);
    for (const response of concurrent) {
      assert.equal(response.status(), 200);
      assert.deepEqual(await response.json(), { ok: true, counts: { yes: 5, no: 1 } });
    }
    const original = await page.request.post(endpoint, { headers, data: { choice: 'yes', comment: '' } });
    assert.deepEqual(await original.json(), replies[0].result);
    await expect(tally).toHaveAttribute('data-survey-yes', '5');
  } finally {
    await page.close();
    await survey.close();
  }
}

const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  optimizeDeps: { entries: [fixture] },
  plugins: [{ name: 'rmd-network-test', configureServer: networkEndpoints }],
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = server.resolvedUrls.local[0];
  await page.goto(base + fixture);
  await checkHttpAndSse(page);
  console.log('PASS HTTP submission and React/SSE lifecycle');
  await checkMappedExternalsAndReceipt(page);
  console.log('PASS mapped Markdown, computed values, and submission receipts');

  const endpoint = new URL(base);
  endpoint.protocol = 'ws:';
  endpoint.searchParams.set('token', server.config.webSocketToken);
  endpoint.searchParams.set('rmd-network-test', '1');
  await withDeadline('WebSocket', checkWebSocket(page, endpoint.href));
  console.log('PASS local WebSocket endpoint and acknowledgement routing');

  await withDeadline('WebRTC', checkWebRtc(page));
  console.log('PASS native WebRTC data channel loopback');
  assert.deepEqual(errors, []);
  await checkSurveyReplay(browser);
  console.log('PASS survey retry after a lost response writes one vote');
} finally {
  await browser?.close();
  for (const stream of streams) stream.end();
  for (const { response } of httpRequests) if (!response.writableEnded) response.end();
  await server.close();
}
