/* 把源文件同步到 www/（Capacitor 打包用的干净 web 资源目录）
 * 用法：node build-www.js
 * 之后 npm run sync 会先同步再 cap sync 把资源拷进安卓工程。 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dst = path.join(root, 'www');
if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });

// 顶层文件
['index.html', 'manifest.webmanifest', 'sw.js'].forEach(f => {
  fs.copyFileSync(path.join(root, f), path.join(dst, f));
});

// assets 整目录（含 db.js / shelf.js / app.js / styles.css / 图标）
const srcAssets = path.join(root, 'assets');
const dstAssets = path.join(dst, 'assets');
fs.cpSync(srcAssets, dstAssets, { recursive: true });

// 校验入口存在
const idx = path.join(dst, 'index.html');
if (!fs.existsSync(idx)) { console.error('缺少 index.html'); process.exit(1); }
console.log('www/ 同步完成：', fs.readdirSync(dst).join(', '));
