const proxyproto = require('../index');

// TODO: generate header
// - proxy-protocol-v2 encode has a bug
const proxyprotoHeader = Buffer.from('0d0a0d0a000d0a515549540a211100542399e1ca0a002485cb3201bb030004c4fb1a1b04003e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', 'hex');

const PORT = 5555;

const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const createCert = require('util').promisify(require('pem').createCertificate);
const autocannon = require('autocannon');
const autocannonConfig = { url: `https://localhost:${PORT}`, connections: 10, duration: 1 };

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


module.exports = async t => {

  const httpsConfig = await createCert({ days: 1, selfSigned: true })
    .then(d => { return { key: d.serviceKey, cert: d.certificate }; });

  const httpResponse = (req,res) => {
    const body = 'OK';
    res.writeHead(200, {
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'text/plain'
    });
    res.end(body);
  };
  const httpServer = http.createServer(httpResponse);
  const httpsServer = https.createServer(httpsConfig, httpResponse);

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

  // first load test has ~.2ms added latency
  t.test('load test vanilla server', async (t) => {
    await new Promise(resolve => {
      const server = httpsServer;
      server.listen(PORT);
      autocannon(autocannonConfig, (err, result) => {
        t.notOk(err);
        t.same(result.non2xx, 0);
        t.notEqual(result['2xx'], 0);
        server.close();
        resolve();
      });
    });
  });

  t.test('load test proxied server', async (t) => {
    await new Promise(resolve => {
      const server = proxyproto.createServer(httpsServer);
      server.listen(PORT);
      autocannon(autocannonConfig, (err, result) => {
        t.notOk(err);
        t.same(result.non2xx, 0);
        t.notEqual(result['2xx'], 0);
        server.close();
        resolve();
      });
    });
  });

  t.test('load test injected proxied server', async (t) => {
    await new Promise(resolve => {
      const server = injectProxyHeaders(proxyproto.createServer(httpsServer));
      server.listen(PORT);
      autocannon(autocannonConfig, (err, result) => {
        t.notOk(err);
        t.same(result.non2xx, 0);
        t.notEqual(result['2xx'], 0);
        server.close();
        resolve();
      });
    });
  });

  t.test('handleCommonErrors - ECONNRESET', async (t) => {
    await new Promise(resolve => {
      let shouldNotErr = true;
      const server = proxyproto.createServer(httpsServer, {
        onError: () => shouldNotErr = false
      });
      server.listen(PORT);
      const client = net.connect(PORT, () => {
        client.destroy();
        setTimeout(() => {
          t.ok(shouldNotErr);
          server.close();
          resolve();
        });
      });
    });
  });

  t.test('handleCommonErrors - EPIPE', async (t) => {
    await new Promise(resolve => {
      let shouldNotErr = true;
      const server = net.createServer(socket =>
        socket.on('end', () => {
          socket.write('foo\n');
          socket.end();
        }));
      const proxied = proxyproto.createServer(server, {
        onError: () => shouldNotErr = false
      });
      proxied.listen(PORT);
      const client = net.connect(PORT, () => {
        client.end('yolo');
        setTimeout(() => {
          t.ok(shouldNotErr);
          proxied.close();
          resolve();
        });
      });
    });
  });

  t.test('handleCommonErrors - HPE_INVALID_EOF_STATE', async (t) => {
    await new Promise(resolve => {
      let shouldNotErr = true;
      const server = proxyproto.createServer(httpServer, {
        onError: () => shouldNotErr = false
      });
      server.listen(PORT);
      const client = net.connect(PORT, () => {
        client.write('GET /foo HTTP/1.1\r\nContent-Length:');
        client.end();
        setTimeout(() => {
          t.ok(shouldNotErr);
          server.close();
          resolve();
        });
      });
    });
  });

  t.test('handleCommonErrors - HPE_HEADER_OVERFLOW', async (t) => {
    await new Promise(resolve => {
      let shouldNotErr = true;
      const server = proxyproto.createServer(httpServer, {
        onError: () => shouldNotErr = false
      });
      server.listen(PORT);
      const client = net.connect(PORT, () => {
        const CRLF = '\r\n';
        const DUMMY_HEADER_NAME = 'Cookie: ';
        const DUMMY_HEADER_VALUE = 'a'.repeat(
          http.maxHeaderSize - DUMMY_HEADER_NAME.length - (2 * CRLF.length) + 1
        );
        const PAYLOAD = 'GET /foo HTTP/1.1' + CRLF +
          DUMMY_HEADER_NAME + DUMMY_HEADER_VALUE + CRLF.repeat(2);
        client.write(PAYLOAD);
        client.end();
        setTimeout(() => {
          t.ok(shouldNotErr);
          server.close();
          resolve();
        });
      });
    });
  });

  t.test('handleCommonErrors - SSL routines', async (t) => {
    await new Promise(resolve => {
      let shouldNotErr = true;
      const server = tls.createServer(httpsConfig, socket => socket.pipe(socket));
      const proxied = proxyproto.createServer(server, {
        onError: () => shouldNotErr = false
      });
      server.listen(PORT);
      const socket = net.connect(PORT);
      const client = tls.connect({
        socket,
        rejectUnauthorized: false
      }, () => {
        const BAD_RECORD = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        client.write('x');
        client.on('error', () => { /* ignore client error */ });
        client.on('data', () => {
          socket.end(BAD_RECORD);
          setTimeout(() => {
            t.ok(shouldNotErr);
            server.close();
            resolve();
          });
        });
      });
    });
  });

};

if (!module.parent) module.exports(require('tap'));
