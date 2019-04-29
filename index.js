// pre-process PROXY protocol headers from tcp sockets
// https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt

const proxyProtoSignature = Buffer.from('0d0a0d0a000d0a515549540a', 'hex')

const parser = require('proxy-protocol-v2');

const createServer = (server, options) => {
  if (!server) {
    throw new Error('Missing server argument - http.createServer(), https, net, tls, etc');
  }
  options = options || {};
  if (!options.hasOwnProperty('handleCommonErrors')) {
    options.handleCommonErrors = true;
  }

  function onError(err, source) {
    // handle common socket errors
    if (options.handleCommonErrors) {
      const error = String(err);
      if (err && err.code === 'ECONNRESET') {
        return;
      } else if (error.includes('SSL routines')) {
        return;
      } else if (error.includes('TLS handshake timeout')) {
        return;
      }
    }
    if (options.onError) {
      return options.onError(err, source);
    }
    throw err;
  }

  // create proxy protocol processing server
  const proxied = require('net').createServer(socket => {
    const buf = [];
    let bytesRead = 0;
    let proxyProtoLength;
    let isProxyProto;
    socket.setKeepAlive(true); // prevent idle timeout ECONNRESET
    if (options.setNoDelay) {
      socket.setNoDelay(true); // disable nagle algorithm
    }
    socket.addListener('error', err => onError(err, 'proxyproto socket'));
    socket.addListener('data', onData);
    function onData(buffer) {
      socket.pause();
      bytesRead += buffer.length;
      buf.push(buffer);
      if (bytesRead > 16 && Buffer.concat(buf).slice(0,12).equals(proxyProtoSignature)) {
        isProxyProto = true;
      }
      if (isProxyProto && !proxyProtoLength) {
        proxyProtoLength = 16 + buffer.readUInt16BE(14);
      }
      // consume data for proxy proto
      if (isProxyProto && bytesRead < proxyProtoLength) {
        socket.resume();
        return;
      }
      let data = Buffer.concat(buf);
      if (isProxyProto) {
        const details = parser.decode(data.slice(0,proxyProtoLength));
        ['remoteAddress','remotePort'].forEach(property => {
          Object.defineProperty(socket, property, {
              get: () => details[property],
              configurable: true
            });
        });
        data = data.slice(proxyProtoLength);
      }
      socket.removeListener('data', onData);
      // pass socket to server, mimic onconnection
      // https://github.com/nodejs/node/blob/5de804e636ce577b46027a24941163a421ada472/lib/net.js#L1472
      socket.server = server;
      socket._server = server;
      server._connections++;
      server.emit('connection', socket);
      // socket.emit('data' does not start handshake for tls or https server
      // call private method for onStreamRead to start handshake
      // https://github.com/nodejs/node/blob/5de804e636ce577b46027a24941163a421ada472/lib/net.js#L224
      socket._handle.onread(data.length, data);
      socket.resume();
    }
  });

  proxied.on('clientError', err => onError(err, 'proxyproto client'));
  proxied.on('error', err => onError(err, 'proxyproto'));
  server.on('clientError', err => onError(err, 'server client'));
  server.on('error', err => onError(err, 'server'));

  // if server is tls, prepare child socket
  if (server._sharedCreds) {
    server.on('secureConnection', socket => {
      ['remoteAddress','remotePort'].forEach(property => {
        Object.defineProperty(socket, property, {
            get: () => socket._parent[property],
            configurable: true
          });
        });
      socket.addListener('error', err => onError(err, 'secure socket'));
      socket.setKeepAlive(true); // prevent idle timeout ECONNRESET
      if (options.setNoDelay) {
        socket.setNoDelay(true); // disable nagle algorithm
      }
    });
  } else {
   server.on('connection', socket => {
     socket.addListener('error', err => onError(err, 'socket'));
   });
  }

  // if server is already listening, use that port
  if (server.listening) {
    const port = server.address().port;
    server.close();
    proxied.listen(port, () => `PROXY protocol parser listening to port ${port}`);
  }

  return proxied;

};

module.exports = { createServer, parser };
