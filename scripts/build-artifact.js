// claude.ai で公開する版（1ファイル）を dist/index.html に作る
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('index.html');
const between = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b));

const head = between(html, '<!-- build:head -->', '<!-- /build:head -->')
  .replace(/<link rel="stylesheet" href="style.css">/, '<style>\n' + read('style.css') + '</style>');
let body = between(html, '<body>', '</body>');
const scripts = [...between(html, '<!-- build:scripts -->', '<!-- /build:scripts -->').matchAll(/src="([^"]+)"/g)]
  .map((m) => '<script>\n' + read(m[1]).replace(/<\/script/gi, '<\\/script') + '\n</script>').join('\n');
body = body.replace(/<!-- build:scripts -->[\s\S]*<!-- \/build:scripts -->/, scripts);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), head.trim() + '\n' + body.trim() + '\n');
console.log('wrote dist/index.html');
