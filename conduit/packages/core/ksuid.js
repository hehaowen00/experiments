const crypto = require('crypto');
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function generateKSUID() {
  const ts = Math.floor(Date.now() / 1000);
  const bytes = Buffer.alloc(20);

  bytes[0] = (ts >> 24) & 0xff;
  bytes[1] = (ts >> 16) & 0xff;
  bytes[2] = (ts >> 8) & 0xff;
  bytes[3] = ts & 0xff;

  crypto.randomFillSync(bytes, 4);

  const digits = [];
  const num = Array.from(bytes);

  while (num.some((b) => b > 0)) {
    let rem = 0;

    for (let i = 0; i < num.length; i++) {
      const val = rem * 256 + num[i];
      num[i] = Math.floor(val / 62);
      rem = val % 62;
    }

    digits.push(BASE62[rem]);
  }

  while (digits.length < 27) {
    digits.push('0');
  }

  return digits.reverse().join('');
}

module.exports = { generateKSUID };
