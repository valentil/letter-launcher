// LLF-68: tiny static server for the browser smoke suite. Serves the repo root on a free port.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain',
  '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
function start(port = 0) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    p = p.replace(/^\/LetterLauncher\//, '/');   // game hardcodes /LetterLauncher/combo_dino_fixed.glb (letters.js); mimic that mount
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port })));
}
module.exports = { start };
if (require.main === module) start(+process.env.PORT || 0).then(x => console.log('http://127.0.0.1:' + x.port));
