// pre-process PROXY protocol headers from tcp connections
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
        return console.log(`${source} Connection interrupted`);
      } else if (error.includes('peer did not return a certificate')) {
        return console.log(`${source} Connection dropped - Client certificate required but not presented`);
      } else if (error.includes('inappropriate fallback') ||
                 error.includes('version too low') ||
                 error.includes('no shared cipher')) {
        return console.log(`${source} Connection dropped - Client used insecure cipher`);
      } else if (error.includes('unknown protocol')) {
        return console.log(`${source} Connection dropped - Client used unknown protocol`);
      }
    }
    if (options.onError) {
      return options.onError(err, source);
    }
    throw err;
  }

  // create proxy protocol processing server
  const proxied = require('net').createServer(connection => {
    const buf = [];
    let bytesRead = 0;
    let proxyProtoLength;
    let isProxyProto;
    connection.setKeepAlive(true); // prevent idle timeout ECONNRESET
    if (options.setNoDelay) {
      connection.setNoDelay(true); // disable nagle algorithm
    }
    connection.addListener('error', err => onError(err, 'proxyproto socket'));
    connection.addListener('data', onData);
    function onData(buffer) {
      connection.pause();
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
        connection.resume();
        return;
      }
      let data = Buffer.concat(buf);
      if (isProxyProto) {
        const details = parser.decode(data.slice(0,proxyProtoLength));
        ['remoteAddress','remotePort'].forEach(property => {
          Object.defineProperty(connection, property, {
              get: () => details[property]
            });
        });
        data = data.slice(proxyProtoLength);
      }
      connection.removeListener('data', onData);
      server.emit('connection', connection);
      connection._handle.onread(data.length, data);
      connection.resume();
    }
  });

  proxied.on('clientError', err => onError(err, 'proxyproto client'));
  proxied.on('error', err => onError(err, 'proxyproto'));
  server.on('clientError', err => onError(err, 'server client'));
  server.on('error', err => onError(err, 'server'));

  // if server is tls, prepare child connection
  if (server._sharedCreds) {
    server.on('secureConnection', connection => {
      ['remoteAddress','remotePort'].forEach(property => {
        Object.defineProperty(connection, property, {
            get: () => connection._parent[property]
          });
        });
      connection.addListener('error', err => onError(err, 'secure socket'));
      connection.setKeepAlive(true); // prevent idle timeout ECONNRESET
      if (options.setNoDelay) {
        connection.setNoDelay(true); // disable nagle algorithm
      }
    });
  } else {
   server.on('connection', connection => {
     connection.addListener('error', err => onError(err, 'socket'));
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
