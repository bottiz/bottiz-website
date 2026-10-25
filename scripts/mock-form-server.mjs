#!/usr/bin/env node
// Local stand-in for the form backend, for testing success and failure states.
//   node scripts/mock-form-server.mjs [port]
//   POST /submit  -> 200 {"ok":true}
//   A message containing "[fail]" -> 500, "[slow]" -> 20s delay (exercises the timeout).
import { createServer } from 'node:http';

const port = Number(process.argv[2]) || 8790;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (req.method !== 'POST' || req.url !== '/submit') return res.writeHead(404, cors).end();
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { return res.writeHead(400, cors).end('{"ok":false}'); }
    console.log(new Date().toISOString(), JSON.stringify(body));
    const reply = () => {
      const failed = String(body.message).includes('[fail]');
      res.writeHead(failed ? 500 : 200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: !failed }));
    };
    String(body.message).includes('[slow]') ? setTimeout(reply, 20000) : reply();
  });
}).listen(port, () => console.log(`Mock form server on http://localhost:${port}/submit`));
