# node-proxyproto
Pre-process PROXY protocol headers from node tcp sockets

[![License: ISC](https://img.shields.io/npm/l/proxyproto.svg)](https://opensource.org/licenses/ISC)

This will allow a regular node server to accept PROXY protocol v2 connections

Just pass in your server to get running:

```js
const server = require('http').createServer((req,res) => res.end('OK'));
server.listen(5555);

const proxied = require('proxyproto').createServer(server);
```

Server can be net, http, https, tls, etc

All available options:
```js
require('proxyproto').createServer(server, {
  setNoDelay: true, // diable nagle algorithm
  handleCommonErrors: false, // handle common socket errors (default: true)
  onError: err => log.error(err) // error handler for servers and sockets
});
```

## Performance

Load test shows neglible latency difference with a vanilla http server

## Authors

fijimunkii

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE.txt) file for details.
