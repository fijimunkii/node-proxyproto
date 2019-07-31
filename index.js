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

  function prepareSocket(socket, name) {
    socket.setKeepAlive(true); // prevent idle timeout ECONNRESET
    if (options.setNoDelay) {
      socket.setNoDelay(true); // disable nagle algorithm
    }
    if (server.timeout) {
      socket.setTimeout(server.timeout, () => closeSocket(socket));
    }
    socket.addListener('error', err => onError(err, name, socket));
  }

  function closeSocket(socket, err) {
    // let the server destroy the connection
    // https://github.com/nodejs/node/blob/c30ef3cbd2e42ac1d600f6bd78a601a5496b0877/lib/https.js#L69
    server.emit(server._sharedCreds?'tlsClientError':'clientError', err, socket);
  }

  function onError(err, source, socket) {
    if (socket) {
      closeSocket(socket, err);
    }
    // handle common network errors
    if (options.handleCommonErrors) {
      const errCodes = new Set(['ECONNRESET', 'EPIPE', 'HPE_INVALID_EOF_STATE', 'HPE_HEADER_OVERFLOW']);
      if (err && err.code && errCodes.has(err.code)) {
        return;
      }
      const errRegex = /SSL\sroutines|TLS\shandshake/;
      if (errRegex.test(String(err))) {
        return;
      }
    }
    if (options.onError) {
      return options.onError(err, source);
    }
    throw err;
  }

  function listen(proxy, server) {
    const port = server.address().port;
    server.close();
    proxied.listen(port, () => console.log(`PROXY protocol parser listening to port ${port}`));
  }

  // create proxy protocol processing server
  const proxied = require('net').createServer(socket => {
    const buf = [];
    let bytesRead = 0;
    let proxyProtoLength;
    let isProxyProto;
    prepareSocket(socket, 'proxyproto socket');
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
      prepareSocket(socket, 'secure socket');
    });
  } else {
   server.on('connection', socket => {
     prepareSocket(socket, 'socket');
   });
  }

  // listen to listening event
  server.on('listening', () => listen(proxied, server));
  // if server is already listening, use that port
  if (server.listening) {
    listen(proxied, server);
  }

  return proxied;

};

module.exports = { createServer, parser };
