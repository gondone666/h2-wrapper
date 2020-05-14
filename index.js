const http2 = require("http2")
const tough =  require("tough-cookie");
const uri = require("url");
const querystring = require("querystring");
const zlib = require("zlib");
const merge = require("deepmerge")
const SocksClient = require("socks").SocksClient;
const tls = require("tls");

class H2Agent {
	constructor(options){
		this.sessions = [];
		this.options = options || {};
		if (!this.options.jar) {
			this.options.jar = new tough.CookieJar();
		}
		this.options.ALPNProtocols = ['h2'];
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
						options.socket = info.socket;
						options.settings = {};
						const socket = tls.connect(options, () => {
							self.sessions[options.origin] = http2.connect(options, {
								createConnection: () => socket
							}, () => resolve(self.sessions[options.origin]))
						});
					});
				} catch (err) {
					reject(err)
				}
			} else {
				const socket = tls.connect(options, () => {
					self.sessions[options.origin] = http2.connect(options, {
						createConnection: () => socket
					}, () => resolve(self.sessions[options.origin]))
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
							self.res.body = type == "application/json" ? JSON.parse(self.res.rawBody) : self.res.rawBody;
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
							self.res.body = type == "application/json" ? JSON.parse(self.res.rawBody) : self.res.rawBody;
							resolve();
						}
					});
					break;
				default:
					self.res.rawBody = buf.toString();
					self.res.body = type == "application/json" ? JSON.parse(self.res.rawBody) : self.res.rawBody;
					resolve();
					break;
			}
		});
	}
	setCookies() {
		const self = this;
		return new Promise((resolve, reject) => {
			let headers = self.res.headers ? self.res.headers : {};
			if (!headers['set-cookie']) {
				resolve();
			}
			else if (headers['set-cookie'] instanceof Array)
				cookies = headers['set-cookie'].map(tough.Cookie.parse);
			else {
				cookies = [tough.Cookie.parse(headers['set-cookie'])];
			}
			cookies.forEach((c) => {
				self.options.jar.setCookieSync(c, self.options.url, (error) => {
					if (error) throw new Error(error)
				})
			})
			resolve();
		});
	}


	request(options) {
		const self = this;
		this.res = new Promise((resolve, reject) => {
			function finish() {
				Promise.all([self.decodeReseponse(), self.setCookies()]).then(() => resolve(self.res));
			}
			options = merge(options, self.options, {
				clone: false
			})
			options = { ...uri.parse(options.url), ...options };
			if (!options.port) options.port = options.protocol.slice(0, -1) === 'https' ? 443 : 80;
			options.servername = options.host;
			options.origin = options.protocol + '//' + options.host;
			var headers = {
				":method": options.headers[":method"] ? options.headers[":method"] : options.method,
				":authority": options.headers[":authority"] ? options.headers[":authority"] : options.host,
				":scheme": options.headers[":scheme"] ? options.headers[":scheme"] : options.protocol.slice(0, -1),
				":path": options.headers[":path"] ? options.headers[":path"] : options.path,
				"origin": options.headers["origin"] ? options.headers["origin"] : options.origin
			}
			for (var key in options.headers) {
				if (!headers[key]) headers[key] = options.headers[key];
			}
			options.jar.getCookieString(options.url, (error, cookie) => {
				if (error) throw new Error(error);
				if (cookie.length > 0) headers["cookie"] = cookie;
			})
			self.tlsSession(options).then((session) => {
				if (!options.body) options.body = "";
				if (["POST", "PATCH"].includes(options.method)) {
					if (options.form) {
						options.body = querystring.stringify(options.form);
						headers["content-type"] = headers["content-type"] ? headers["content-type"] : "application/x-www-form-urlencoded";

					} else if (options.json) {
						options.body = JSON.stringify(options.json);
						headers["content-type"] = headers["content-type"] ? headers["content-type"] : "application/json";
					}
					headers["content-length"] = options.body.length;
				}
				options.headers = headers;
				console.log(headers, options.body)
				var req = session.request(headers);
				if (["POST", "PATCH"].includes(options.method)) {
					req.end(options.body);
				} else {
					req.end();
				}
				req.on("response", (headers) => {
					self.res = { headers, req, data:[]};
					req.on('data', function (chunk) {
						self.res.data.push(chunk);
					});
					req.on('end', finish);
				});
				req.on("error", function (err) {
					throw new Error(err)
				})
			})
		});
		return self.res;
	}
	close() {
		const self = this;
		for (let host in self.sessions) {
			self.sessions[host].close();
		}
    }
}

const request = async function (url, opts = {}) {
	let options = {};
	if (typeof url === "string" && typeof opts === "object") {
		options = { ...opts, url };
		
	} else if (typeof url === "object") {
		options = { ...url };
	}
	if (!options.method) {
		options.method = 'GET';
    }
	if (!options.url) {
		throw new Error("Missing URL param");
	}
	return request.agent.request(options);
}

request.extend = (defaults = {}) => {
	let req = request;
	req.agent = new H2Agent(defaults);
	return req;
}
request.close=() => {
	request.agent.close();
}

module.exports = request