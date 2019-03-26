const proxyproto = require('../index');

// TODO: generate header
// - proxy-protocol-v2 encode has a bug
const proxyprotoHeader = Buffer.from('0d0a0d0a000d0a515549540a211100542399e1ca0a002485cb3201bb030004c4fb1a1b04003e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', 'hex');

const net = require('net');
const http = require('http');
const https = require('https');
const createCert = require('util').promisify(require('pem').createCertificate);

const httpRequestOptions = { agent: false, rejectUnauthorized: false };

// simple socket middleman for injecting PROXY proto headers
const injectProxyHeaders = app => net.createServer(socket => {
  socket.pause();
  socket.server = app;
  socket._server = app;
  app._connections++;
  app.emit('connection', socket);
  socket._handle.onread(proxyprotoHeader.length, proxyprotoHeader);
  socket.resume();
});

const PORT = 5555;

module.exports = async t => {

  const httpsConfig = await createCert({ days: 1, selfSigned: true })
    .then(d => { return { key: d.serviceKey, cert: d.certificate }; });

  const httpServer = http.createServer((req,res) => res.end('OK'));
  const httpsServer = https.createServer(httpsConfig, (req,res) => res.end('OK'));

  t.test('returns a net.Server instance', async (t) => {
    t.type(proxyproto.createServer(httpServer), 'Server');
  });

  t.test('server interface must be supplied', async (t) => {
    t.throws(() => proxyproto.createServer());
    t.doesNotThrow(() => proxyproto.createServer(httpServer));
  });

  t.test('vanilla http connections are untouched', async (t) => {
    await Promise.all([
      // ensure connection info is untouched
      new Promise(resolve => {
        const server = http.createServer((req,res) => {
          t.same(req.connection.remoteAddress, '::ffff:127.0.0.1');
          res.end('OK');
          proxied.close();
          resolve();
        });
        const proxied = proxyproto.createServer(server);
        proxied.listen(PORT);
      }),
      // ensure data is untouched
      new Promise(resolve => {
        http.get(`http://localhost:${PORT}`, httpRequestOptions, res => {
          res.setEncoding('utf8');
          let rawData = '';
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            t.same(rawData, 'OK');
            resolve();
          });
        });
      })
    ]);
  });

  t.test('vanilla https connections are untouched', async (t) => {
    await Promise.all([
      // ensure connection info is untouched
      new Promise(resolve => {
        const server = https.createServer(httpsConfig, (req,res) => {
          t.same(req.connection.remoteAddress, '::ffff:127.0.0.1');
          res.end('OK');
          proxied.close();
          resolve();
        });
        const proxied = proxyproto.createServer(server);
        proxied.listen(PORT);
      }),
      // ensure data is untouched
      new Promise(resolve => {
        https.get(`https://localhost:${PORT}`, httpRequestOptions, res => {
          res.setEncoding('utf8');
          let rawData = '';
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            t.same(rawData, 'OK');
            resolve();
          });
        });
     })
    ]);
  });

  t.test('http - PROXY protocol headers are parsed', async (t) => {
    await new Promise(resolve => {
      const server = http.createServer((req,res) => {
        t.same(req.connection.remoteAddress, '35.153.225.202');
        res.end('OK');
        proxied.close();
        resolve();
      });
      const proxied = injectProxyHeaders(proxyproto.createServer(server));
      proxied.listen(PORT);
      http.get(`http://localhost:${PORT}`, httpRequestOptions);
    });
  });

  t.test('https - PROXY protocol headers are parsed', async (t) => {
     await new Promise(resolve => {
      const server = https.createServer(httpsConfig, (req,res) => {
        t.same(req.connection.remoteAddress, '35.153.225.202');
        res.end('OK');
        proxied.close();
        resolve();
      });
      const proxied = injectProxyHeaders(proxyproto.createServer(server));
      proxied.listen(PORT);
      https.get(`https://localhost:${PORT}`, httpRequestOptions);
    });
  });

  t.test('listening port is re-used', async (t) => {
    const server = http.createServer();
    server.listen(PORT);
    const proxied = proxyproto.createServer(server);
    t.ok(proxied.listening);
    t.notOk(server.listening);
    t.same(proxied.address().port, PORT);
    proxied.close();
  });

};

if (!module.parent) module.exports(require('tap'));
