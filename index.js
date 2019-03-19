// pre-process PROXY protocol headers from tcp connections
// https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt

const proxyProtoSignature = Buffer.from('0d0a0d0a000d0a515549540a', 'hex')

const parser = require('proxy-protocol-v2');

const createServer = (server, options) => {
  if (!server) {
    throw new Error('Missing server argument - http.createServer(), https, net, tls, etc');
  }
  options = options || {};

  function onError(err) {
    if (err && err.code === 'ECONNRESET') {
      console.log('Connection interrupted');
    } else if (options.onError) {
      options.onError(err);
    } else {
      throw err;
    }
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
    connection.addListener('error', onError);
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

  proxied.on('clientError', onError);
  proxied.on('error', onError);
  server.on('clientError', onError);
  server.on('error', onError);

  // if server is tls, prepare child connection
  if (server._sharedCreds) {
    server.on('secureConnection', connection => {
      ['remoteAddress','remotePort'].forEach(property => {
        Object.defineProperty(connection, property, {
            get: () => connection._parent[property]
          });
        });
      connection.addListener('error', onError);
      connection.setKeepAlive(true); // prevent idle timeout ECONNRESET
      if (options.setNoDelay) {
        connection.setNoDelay(true); // disable nagle algorithm
      }
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
