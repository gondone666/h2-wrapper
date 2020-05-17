const http2 = require("http2")
const https = require("https")
const tough =  require("tough-cookie");
const uri = require("url");
const querystring = require("querystring");
const zlib = require("zlib");
const merge = require("deepmerge")
const SocksClient = require("socks").SocksClient;
const tls = require("tls");

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
			}, () => resolve())
		})
	}
	reorderHeaders(options) {
		let reorder = {
			":method": options.headers[":method"] ? options.headers[":method"] : options.method,
			":authority": options.headers[":authority"] ? options.headers[":authority"] : options.host,
			":scheme": options.headers[":scheme"] ? options.headers[":scheme"] : options.protocol.slice(0, -1),
			":path": options.headers[":path"] ? options.headers[":path"] : options.path,
			"origin": options.headers["origin"] ? options.headers["origin"] : options.origin
		}
		for (var key in options.headers) {
			if (!reorder[key]) reorder[key] = options.headers[key];
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
						const socket = tls.connect({ socket: info.socket, host: options.host, port: options.port, servername: options.host, maxVersion: 'TLSv1.3', echdCurve: "X25519:secp256r1:secp384r1", ciphers:options.ciphers}, () => {
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
				const socket = tls.connect({ host: options.host, port: options.port, servername: options.host, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', echdCurve: "X25519:secp256r1:secp384r1", ciphers:options.ciphers}, () => {
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
	decodeReseponse() {
		const self = this;
		return new Promise((resolve, reject) => {
			self.res.rawBody = "";
			self.res.body = "";
			let buf = Buffer.concat(self.res.data), headers = self.res.headers ? self.res.headers : {};
			if (buf.length == 0) resolve();
			var encoding = headers['content-encoding'] ? headers['content-encoding'] : '', type = headers['content-type'] ? headers['content-type']:'';
			switch (encoding) {
				case 'gzip':
					zlib.gunzip(buf, function (error, body) {
						if (error) {
							throw new Error(error)
						} else {
							self.res.rawBody = body.toString();
							self.res.body = type.includes("application/json") ? JSON.parse(self.res.rawBody) : self.res.rawBody;
							resolve();
						}
					});
					break;
				case 'deflate':
					zlib.inflate(buf, function (error, body) {
						if (error) {
							throw new Error(error)
						} else {
							self.res.rawBody = body.toString()
							self.res.body = type.includes("application/json") ? JSON.parse(self.res.rawBody) : self.res.rawBody;
							resolve();
						}
					});
					break;
				default:
					self.res.rawBody = buf.toString();
					self.res.body = type.includes("application/json") ? JSON.parse(self.res.rawBody) : self.res.rawBody;
					resolve();
					break;
			}
		});
	}
	setCookies() {
		const self = this;
		return new Promise((resolve, reject) => {
			let headers = self.res.headers ? self.res.headers : {}, cookies=[];
			if (!headers['set-cookie']) {
				resolve();
			}
			else if (headers['set-cookie'] instanceof Array)
				cookies = headers['set-cookie'].map(tough.Cookie.parse);
			else {
				cookies = [tough.Cookie.parse(headers['set-cookie'])];
			}
			cookies.forEach((c) => {
				self.options.jar.setCookieSync(c, self.res.url, (error) => {
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
		options.servername = options.host;
		options.origin = options.protocol + '//' + options.host;
		options = merge(self.options, options, {
			clone: false
		})
		return new Promise((resolve, reject) => {
			if (!options.headers["Cookie"]) {
				options.jar.getCookieString(options.url, (error, cookie) => {
					if (error) throw new Error(error);
					if (cookie.length > 0) options.headers["Cookie"] = cookie;
				})
			}
			self.tlsSession(options).then(() => {
				if (!options.body) options.body = "";
				if (["POST", "PATCH"].includes(options.method)) {
					if (options.form) {
						options.body = querystring.stringify(options.form);
						options.headers["content-type"] = options.headers["content-type"] ? options.headers["content-type"] : "application/x-www-form-urlencoded";

					} else if (options.json) {
						options.body = JSON.stringify(options.json);
						options.headers["content-type"] = options.headers["content-type"] ? options.headers["content-type"] : "application/json";
					}
					options.headers["content-length"] = options.body.length;
				}
				options.headers = self.sessions[options.origin].reorderHeaders(options);
				var req = self.sessions[options.origin].request(options);
				if (["POST", "PATCH"].includes(options.method)) {
					req.end(options.body);
				} else {
					req.end();
				}
				req.on("response", (res) => {
					if (self.sessions[options.origin].version == 'h2') {
						self.res = { _headers:options.headers, headers: res, data: [], url: options.url, httpVersion: self.sessions[options.origin].version};
						req.on('data', function (chunk) {
							if (!self.res.data) {
								process.exit(0)
							}
							self.res.data.push(chunk);
						});
						req.on('end', () => Promise.all([self.decodeReseponse(), self.setCookies()]).then(() => resolve(self.res)));
					} else {
						self.res = { _headers: options.headers,headers: res.headers, data: [], url: options.url, httpVersion: self.sessions[options.origin].version};
						res.on('data', function (chunk) {
								self.res.data.push(chunk);
						});
						res.on('end', () =>Promise.all([self.decodeReseponse(), self.setCookies()]).then(() => resolve(self.res)));
                    }
				});
				req.on("error", function (err) {
					res.resume();
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