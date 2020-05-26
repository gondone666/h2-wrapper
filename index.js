const http2 = require("http2")
const https = require("https")
const tough =  require("tough-cookie");
const uri = require("url");
const querystring = require("querystring");
const zlib = require("zlib");
const merge = require("deepmerge")
const SocksClient = require("socks").SocksClient;
const tls = require("tls");

const chrome_ciphers = "GREASE:TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA:DES-CBC3-SHA";

class Session {
	constructor(version) {
		this.socket = false;
		this.version = version;
	}
	close() {
		this.socket.destroy();
	}
}

class H1Session extends Session {
	constructor() {
		super('http1.1');
	}
	request(options) {
		let opts = { ...options }
		opts.createConnection = () => this.socket;
		return https.request(opts);
	}
	connect(options, socket)  {
		return new Promise((resolve, reject) => {
			this.socket = socket;
			this.options = options
			resolve();
		})
	}
	reorderHeaders(options) {
		const chrome = [
			"User-Agent",
			"DNT",
			"Accept",
			"Sec-Fetch-Site",
			"Sec-Fetch-Mode",
			"Sec-Fetch-Dest",
			"Referer",
			"Accept-Encoding",
			"Accept-Language",
			"Cookie"
		];
		let reorder = {
			"Host": options.headers["host"] ? options.headers["host"] : options.host,
			"Connection": "keep-alive",
		}
		for (let i = 0; i < chrome.length; i++) {
			let key = chrome[i];
			if (!reorder[key] && options.headers[key]) reorder[key] = options.headers[key];
		}
		for (var key in options.headers) {
			if (!reorder[key]) reorder[key] = options.headers[key];
		}
		return reorder;
	}
}

class H2Session extends Session {
	constructor() {
		super('h2');
	}
	request(options) {
		return this.socket.request(options.headers);
	}
	connect(options, socket) {
		return new Promise((resolve, reject) => {
			this.socket = http2.connect(options, {
				createConnection: () => socket
			}, () => {
				resolve()
			})
		})
	}
	reorderHeaders(options) {
		const chrome = [
			":method",
			":authority",
			":scheme",
			":path",
			"x-sec-clge-req-type",
			"dnt",
			"request-id",
			"user-agent",
			"accept",
			"origin",
			"sec-fetch-site",
			"sec-fetch-mode",
			"sec-fetch-dest",
			"referer",
			"accept-encoding",
			"accept-language",
			"cookie"
		];
		let reorder = {
			":method": options.headers[":method"] ? options.headers[":method"] : options.method,
			":authority": options.headers[":authority"] ? options.headers[":authority"] : options.host,
			":scheme": options.headers[":scheme"] ? options.headers[":scheme"] : options.protocol.slice(0, -1),
			":path": options.headers[":path"] ? options.headers[":path"] : options.path
		}
		for (let i = 0; i < chrome.length; i++) {
			let key = chrome[i];
			if (!reorder[key.toLowerCase()] && options.headers[key]) reorder[key.toLowerCase()] = options.headers[key];
		}
		for (var key in options.headers) {
			if (!reorder[key]) reorder[key.toLowerCase()] = options.headers[key];
		}
		return reorder;
	}
}

class HWrapper {
	constructor(options){
		this.sessions = [];
		this.options = options || {};
		if (!this.options.jar) {
			this.options.jar = new tough.CookieJar();
		}
		this.options.ALPNProtocols = ['h2', 'http/1.1', 'http/1.0'];
		if (!this.options.ciphers) {
			this.options.ciphers = chrome_ciphers;
		}
		this.res = false;
	}	
	tlsSession(options) {
		const self = this;
		return new Promise((resolve, reject) => {
			if (self.sessions[options.origin]) resolve(self.sessions[options.origin]);
			if (options.proxy) {
				const socksOpts = {
					proxy: options.proxy,
					destination: { host: options.host, port: options.port },
					command: 'connect'
				};
				try {
					SocksClient.createConnection(socksOpts).then(info => {
						const socket = tls.connect({ ALPNProtocols: ['h2', 'http/1.1', 'http/1.0'], rejectUnauthorized: false, socket: info.socket, host: options.hostname, port: options.port, servername: options.hosthame, echdCurve: "GREASE:X25519", ciphers:options.ciphers}, () => {
							if (socket.alpnProtocol == 'h2') {
								self.sessions[options.origin] = new H2Session();
							} else {
								self.sessions[options.origin] = new H1Session();
							}
							self.sessions[options.origin].connect(options, socket).then(()=>resolve());
						});
					});
				} catch (err) {
					reject(err)
				}
			} else {
				const socket = tls.connect({ ALPNProtocols: ['h2', 'http/1.1', 'http/1.0'], rejectUnauthorized: false, host: options.hostname, port: options.port, servername: options.hostname, echdCurve: "GREASE:X25519", ciphers:options.ciphers}, () => {
					if (socket.alpnProtocol == 'h2') {
						self.sessions[options.origin] = new H2Session();
					} else {
						self.sessions[options.origin] = new H1Session();
					}
					self.sessions[options.origin].connect(options, socket).then(() => resolve());
				});
			}
		});
	}
	decodeReseponse(res) {
		const self = this;
		return new Promise((resolve, reject) => {
			res.rawBody = "";
			res.body = "";
			let buf = Buffer.concat(res.data), headers = res.headers ? res.headers : {};
			if (buf.length == 0) resolve();
			var encoding = headers['content-encoding'] ? headers['content-encoding'] : '', type = headers['content-type'] ? headers['content-type']:'';
			switch (encoding) {
				case 'gzip':
					zlib.gunzip(buf, function (error, body) {
						if (error) {
							console.log(res)
							throw new Error(error)
						} else {
							res.rawBody = body.toString();
							res.body = type.includes("application/json") ? JSON.parse(res.rawBody) : res.rawBody;
							resolve();
						}
					});
					break;
				case 'deflate':
					zlib.inflate(buf, function (error, body) {
						if (error) {
							throw new Error(error)
						} else {
							res.rawBody = body.toString()
							res.body = type.includes("application/json") ? JSON.parse(res.rawBody) : res.rawBody;
							resolve();
						}
					});
					break;
				default:
					res.rawBody = buf.toString();
					res.body = type.includes("application/json") ? JSON.parse(res.rawBody) : res.rawBody;
					resolve();
					break;
			}
		});
	}
	setCookies(res) {
		const self = this;
		return new Promise((resolve, reject) => {
			let headers = res.headers ? res.headers : {}, cookies=[];
			if (!headers['set-cookie']) {
				resolve();
			}
			else if (headers['set-cookie'] instanceof Array)
				cookies = headers['set-cookie'].map(tough.Cookie.parse);
			else {
				cookies = [tough.Cookie.parse(headers['set-cookie'])];
			}
			cookies.forEach((c) => {
				self.options.jar.setCookieSync(c, res.url, (error) => {
					if (error) throw new Error(error)
				})
			})
			resolve();
		});
	}

	request(url, opts = {}) {
		const self = this;
		let options = {};
		if (typeof url === "string" && typeof opts === "object") {
			options = { ...opts, ...uri.parse(url), url };

		} else if (typeof url === "object") {
			if (typeof url.url === "string") options = { ...opts, ...url,...uri.parse(url.url)};
			else options = { ...opts, ...url, url: url.toString() };
		}
		if (!options.method) {
			options.method = 'GET';
		}
		if (!options.url) {
			throw new Error("Missing URL param");
		}
		if (!options.port) options.port = options.protocol.slice(0, -1) === 'https' ? 443 : 80;
		options.origin = options.protocol + '//' + options.host;
		options = merge(self.options, options, {
			clone: false
		})
		return new Promise((resolve, reject) => {
			if (!options.headers["cookie"]) {
				options.jar.getCookieString(options.url, (error, cookie) => {
					if (error) throw new Error(error);
					if (cookie.length > 0) options.headers["cookie"] = cookie;
				})
			}
			self.tlsSession(options).then(() => {
				if (!options.body) options.body = "";
				if (["POST", "PATCH", "PUT"].includes(options.method)) {
					if (options.form) {
						options.body = querystring.stringify(options.form);
						options.headers["content-type"] = options.headers["content-type"] ? options.headers["content-type"] : "application/x-www-form-urlencoded";
					} else if (options.json) {
						options.body = new Buffer(JSON.stringify(options.json));
						options.headers["content-type"] = options.headers["content-type"] ? options.headers["content-type"] : "application/json";
					}
					options.headers["content-length"] = options.body.length;
				}
				options.headers["origin"] ? options.headers["origin"] : options.origin;
				options.headers = self.sessions[options.origin].reorderHeaders(options);
				var req = self.sessions[options.origin].request(options);
				if (["POST", "PATCH", "PUT"].includes(options.method)) {
					if (options.debug) console.log(options.body)
					req.write(options.body);
					req.end();
				} else {
					req.end();
				}
				req.once('drain', function () {
					console.log('drain', arguments);
				})
				req.once("response", (response) => {
					if (self.sessions[options.origin].version == 'h2') {
						let res = { _headers:options.headers, headers: response, data: [], url: options.url, httpVersion: self.sessions[options.origin].version};
						req.on('data', function (chunk) {
							res.data.push(chunk);
						});
						req.once('end', () => Promise.all([self.decodeReseponse(res), self.setCookies(res)]).then(() => resolve(res)));
					} else {
						let res = { _headers: options.headers, headers: response.headers, data: [], url: options.url, httpVersion: self.sessions[options.origin].version };
						response.on('data', function (chunk) {
							res.data.push(chunk);
						});
						response.once('end', () => Promise.all([self.decodeReseponse(res), self.setCookies(res)]).then(() => resolve(res)));
					}
				});
				req.once("error", function (err) {
					console.log(err)
				})
			})
		});
	}
	close() {
		const self = this;
		for (let host in self.sessions) {
			self.sessions[host].close();
		}
	}
}

module.exports = HWrapper