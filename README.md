# h2-wrapper
An HTTP2/1.1 client with SOKCS5 support
###### VERSION
**0.0.1** - HTTP2/SOCKS5 Support
###### TODO
- [x] HTTP2/SOCKS5 Support
- [ ] HTTSP1.1 Support
- [ ] Plain HTTP Support
- [ ] .....................
###### Example
```javascript
const h2 = require('h2-wrapper');

(async () => {
	const nike = await h2.extend({
		headers: {
			"user-agent": "Mozilla/5.0 (Linux; Android 9; ZTE Blade A5 2019RU) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.117 Mobile Safari/537.36",
			"accept-encoding": "gzip, deflate, br",
			"accept-language": "en-US,en;q=0.9",
			"sec-fetch-site": "same-site",
			"sec-fetch-mode": "cors",
			"sec-fetch-dest": "empty"
		},
		proxy: { host: '127.0.0.1', port: 8888, type: 5 },
		ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256 ECDHE-RSA-AES128-GCM-SHA256 ECDHE-ECDSA-AES256-GCM-SHA384 ECDHE-RSA-AES256-GCM-SHA384 ECDHE-ECDSA-CHACHA20-POLY1305-SHA256 ECDHE-RSA-CHACHA20-POLY1305-SHA256 ECDHE-RSA-AES128-SHA ECDHE-RSA-AES256-SHA RSA-AES128-GCM-SHA256 RSA-AES256-GCM-SHA384 RSA-AES128-SHA RSA-AES256-SHA RSA-3DES-EDE-SHA",
	})
	var res = await nike('https://www.nike.com/');
	console.log(res.body);
	nike.close();
})();
```
