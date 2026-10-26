// dev-server.js: a tiny local web server for trying the site without Vercel. Run it with: node scripts/dev-server.js
// It serves the static files and sends /api/ask to the same function Vercel would run.

import http from 'node:http'; // the built in web server
import { readFile } from 'node:fs/promises'; // reads files from disk
import { extname, join, normalize } from 'node:path'; // helps build safe file paths
import { fileURLToPath, pathToFileURL } from 'node:url'; // converts between file paths and URLs

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..'); // the project folder, one level above scripts
const PORT = Number(process.env.PORT || 3000); // the port to listen on, 3000 unless set
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.in': 'text/plain; charset=utf-8', '.UPF': 'text/plain; charset=utf-8', '.upf': 'text/plain; charset=utf-8' }; // file types the browser needs to know about

async function readBody(req) { // collects the body of a POST request into text
  const chunks = []; // pieces of the body as they arrive
  for await (const c of req) chunks.push(c); // wait for each piece
  return Buffer.concat(chunks).toString('utf8'); // join them into one string
}

const server = http.createServer(async (req, res) => { // runs for every request
  const url = new URL(req.url, `http://${req.headers.host}`); // a parsed copy of the address
  if (url.pathname === '/api/ask') { // the function route
    const { default: handler } = await import(pathToFileURL(join(ROOT, 'api/ask.js')).href); // load the same code Vercel runs
    const raw = await readBody(req); // read the request body
    const fake = { method: req.method, body: raw }; // a request shaped like the one Vercel passes in
    const out = { // a response shaped like the one Vercel passes in
      headers: {}, code: 200, // the headers and status collected so far
      setHeader(k, v) { this.headers[k] = v; }, // stores a header
      status(c) { this.code = c; return this; }, // stores a status code
      json(o) { res.writeHead(this.code, { ...this.headers, 'content-type': 'application/json' }); res.end(JSON.stringify(o)); }, // sends the JSON reply
    };
    await handler(fake, out); // run the function
    return; // done with this request
  }
  let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''); // clean the path so it cannot climb out of the folder
  if (path === '/' || path === '\\') path = '/index.html'; // the home page
  try { // try to read the file
    const data = await readFile(join(ROOT, path)); // read it from disk
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); // send the right type
    res.end(data); // send the file
  } catch (e) { // the file does not exist
    res.writeHead(404, { 'content-type': 'text/plain' }); // not found
    res.end('Not found'); // a short message
  }
});

server.listen(PORT, () => console.log(`SorbLab running at http://localhost:${PORT}`)); // tell the user where to look
