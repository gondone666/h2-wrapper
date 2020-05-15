# h2-wrapper
An HTTP2/1.1 client with SOKCS5 support
###### VERSION
**0.0.4** - Normalize request arguments (url, options) or (url) or (options)
**0.0.3** - Tough Cookie support
**0.0.2** - HTTP1.1 support
**0.0.1** - HTTP2/SOCKS5 Support

###### TODO
- [x] HTTP2/SOCKS5 Support
- [x] HTTPS/1.1 Support
- [ ] Plain HTTP Support
- [ ] .....................
###### Example
```javascript
const h2 = require('h2-wrapper');
const tough = require("tough-cookie");

(async () => {
	const jar = new tough.CookieJar();
	const nike = new h2({
		headers: {
			"user-agent": "Mozilla/5.0 (Linux; Android 9; ZTE Blade A5 2019RU) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.117 Mobile Safari/537.36",
			"accept-encoding": "gzip, deflate, br",
			"accept-language": "en-US,en;q=0.9",
			"sec-fetch-site": "same-site",
			"sec-fetch-mode": "cors",
			"sec-fetch-dest": "empty"
		},
		jar: jar,
		proxy: { host: '127.0.0.1', port: 54989, type: 5 },
		ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256 ECDHE-RSA-AES128-GCM-SHA256 ECDHE-ECDSA-AES256-GCM-SHA384 ECDHE-RSA-AES256-GCM-SHA384 ECDHE-ECDSA-CHACHA20-POLY1305-SHA256 ECDHE-RSA-CHACHA20-POLY1305-SHA256 ECDHE-RSA-AES128-SHA ECDHE-RSA-AES256-SHA RSA-AES128-GCM-SHA256 RSA-AES256-GCM-SHA384 RSA-AES128-SHA RSA-AES256-SHA RSA-3DES-EDE-SHA",
	})
	var res1 = await nike.request('https://www.nike.com/ru/');
	console.log(res1.httpVersion);
	console.log(res1.jar);
	var res2 = await nike.request('https://secure-global.nike.com/');
	console.log(res2.httpVersion);
	console.log(res2.jar);
	nike.close();
})();
```