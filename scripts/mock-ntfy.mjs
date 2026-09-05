// Minimal stand-in for ntfy.sh used by browser-check: POST /<topic> stores a message, GET /<topic>/sse streams it (ntfy JSON event format).
import { createServer } from 'node:http';
const port = Number(process.argv[2] ?? 8790);
const topics = new Map(); // topic -> { last, subs: Set<res> }
const topic = (t) => topics.get(t) ?? topics.set(t, { last: null, subs: new Set() }).get(t);
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const [, name, sub] = req.url.split('?')[0].split('/');
  const t = topic(name);
  if (req.method === 'POST') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      t.last = JSON.stringify({ id: String(Date.now()), time: Math.floor(Date.now() / 1000), event: 'message', topic: name, message: body });
      for (const s of t.subs) s.write(`data: ${t.last}\n\n`);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(t.last);
    }); return;
  }
  if (sub === 'sse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write(`data: ${JSON.stringify({ event: 'open', topic: name })}\n\n`);
    if (t.last) res.write(`data: ${t.last}\n\n`);
    t.subs.add(res); req.on('close', () => t.subs.delete(res)); return;
  }
  if (sub === 'json' || sub === undefined) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(t.last ?? '{}'); }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1');
