# node-proxyproto
Pre-process PROXY protocol headers from node tcp connections

[![License: ISC](https://img.shields.io/npm/l/proxy-proto.svg)](https://opensource.org/licenses/ISC)

This will allow a regular node server to accept PROXY protocol connections

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

## Authors

fijimunkii

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE.txt) file for details.
