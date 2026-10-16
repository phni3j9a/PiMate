// Standalone asset generator. Does not modify the mobile application.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const geometry = JSON.parse(await fs.readFile(path.join(root, 'source/geometry.json'), 'utf8'));
const { palettes, shapes } = geometry;
const records = [];

async function write(name, data) {
  const dest = path.join(root, name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, data);
  records.push({ path: name, bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') });
}
const json = (x) => JSON.stringify(x, null, 2) + '\n';
const svg = (body, size = 1024, height = size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 ${size} ${height}">${body}</svg>`;
const polygonPath = (points) => `M${points.map((p) => p.join(',')).join('L')}Z`;
function mark(theme = 'light', mono) {
  // Merge polygons of the same color into one path to keep recoloring simple.
  return ['blue', 'coral', 'yellow'].map((color) => `<path fill="${mono || palettes[theme][color]}" d="${shapes.filter((s) => s.color === color).map((s) => polygonPath(s.points)).join('')}"/>`).join('');
}
function placed(theme, width, canvas = 1024, mono) {
  const scale = width / 460;
  return `<g transform="translate(${(canvas - width) / 2} ${(canvas - 408 * scale) / 2}) scale(${scale})">${mark(theme, mono)}</g>`;
}
function body(theme, mode = 'app', mono) {
  if (mode === 'mark') return placed(theme, 920, 1024, mono);
  if (mode === 'adaptive') return placed(theme, 1024 * 48 / 108, 1024, mono);
  if (mode === 'desktop') return `<rect x="100" y="100" width="824" height="824" rx="180" fill="${palettes[theme].background}"/>${placed(theme, 536, 1024, mono)}`;
  return `<rect width="1024" height="1024" fill="${palettes[theme].background}"/>${placed(theme, mode === 'maskable' ? 594 : 660, 1024, mono)}`;
}
function icon(theme, mode = 'app', mono) { return svg(body(theme, mode, mono)); }
async function png(name, image, size, opaque = false) {
  // Render SVG at high resolution, then downsample. PNGs carry an sRGB profile.
  let pipeline = sharp(Buffer.from(image), { density: 216 }).resize(size, size).withIccProfile('srgb');
  if (opaque) pipeline = pipeline.removeAlpha();
  const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  await write(name, buffer);
  return buffer;
}
async function ico(name, theme, sizes, mode = 'desktop') {
  const images = [];
  for (const size of sizes) images.push(await sharp(Buffer.from(icon(theme, mode)), { density: 216 }).resize(size, size).png().toBuffer());
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let i = 0; i < sizes.length; i++) {
    const p = 6 + i * 16;
    header[p] = sizes[i] === 256 ? 0 : sizes[i]; header[p + 1] = header[p];
    header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(images[i].length, p + 8); header.writeUInt32LE(offset, p + 12);
    offset += images[i].length;
  }
  await write(name, Buffer.concat([header, ...images]));
}
async function icns(name, theme) {
  const chunks = [];
  for (const [type, size] of [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]]) {
    const image = await sharp(Buffer.from(icon(theme, 'desktop')), { density: 216 }).resize(size, size).png().toBuffer();
    const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(image.length + 8, 4);
    chunks.push(header, image);
  }
  const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(8 + chunks.reduce((sum, b) => sum + b.length, 0), 4);
  await write(name, Buffer.concat([header, ...chunks]));
}

// Source vectors and clean transparent exports.
for (const theme of ['light', 'dark']) {
  await write(`source/mark-${theme}.svg`, svg(mark(theme), 460, 408));
  await write(`source/app-icon-${theme}.svg`, icon(theme));
  await png(`logo/mark-${theme}-1024.png`, icon(theme, 'mark'), 1024);
  await png(`splash/mark-${theme}-1024.png`, icon(theme, 'mark'), 1024);
  // Aligned SVG layers for a future Icon Composer document; no guessed .icon metadata.
  for (const color of ['blue', 'coral', 'yellow']) {
    const layer = shapes.filter((s) => s.color === color).map((s) => `<path fill="${palettes[theme][color]}" d="${polygonPath(s.points)}"/>`).join('');
    await write(`ios/icon-composer-layers/${theme}/${color}.svg`, svg(`<g transform="translate(182 ${((1024 - 408 * 660 / 460) / 2)}) scale(${660 / 460})">${layer}</g>`));
  }
}
for (const [name, color] of [['black','#000000'],['white','#FFFFFF']]) {
  await write(`source/mark-${name}.svg`, svg(mark('light', color), 460, 408));
  await png(`logo/mark-${name}-1024.png`, icon('light', 'mark', color), 1024);
}

// iOS asset catalog: source PNGs stay square, opaque, and without pre-rounded corners.
const iosEntries = [];
for (const theme of ['light', 'dark', 'tinted']) {
  const filename = `icon-${theme}-1024.png`;
  await png(`ios/AppIcon.appiconset/${filename}`, icon(theme), 1024, true);
  const entry = { filename, idiom: 'universal', platform: 'ios', size: '1024x1024' };
  if (theme !== 'light') entry.appearances = [{ appearance: 'luminosity', value: theme }];
  iosEntries.push(entry);
}
await write('ios/AppIcon.appiconset/Contents.json', json({ images: iosEntries, info: { author: 'xcode', version: 1 } }));

// Android: 108 dp layers, mark fits within a 66 dp diameter safe circle.
const androidScale = 48 / 460;
const ax = (108 - 48) / 2;
const ay = (108 - 408 * androidScale) / 2;
const maxRadius = Math.max(...shapes.flatMap((s) => s.points.map(([x,y]) => Math.hypot(ax + x * androidScale - 54, ay + y * androidScale - 54))));
if (maxRadius >= 33) throw new Error('Android mark exceeds safe circle');
const vector = (theme, mono) => `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><group android:translateX="${ax}" android:translateY="${ay}" android:scaleX="${androidScale}" android:scaleY="${androidScale}">${shapes.map((s) => `<path android:fillColor="${mono || palettes[theme][s.color]}" android:pathData="${polygonPath(s.points)}"/>`).join('')}</group></vector>\n`;
for (const theme of ['light', 'dark']) {
  await write(`android/adaptive/foreground-${theme}.svg`, icon(theme, 'adaptive'));
  await png(`android/adaptive/foreground-${theme}-1024.png`, icon(theme, 'adaptive'), 1024);
  await png(`android/adaptive/background-${theme}-1024.png`, svg(`<rect width="1024" height="1024" fill="${palettes[theme].background}"/>`), 1024, true);
  await png(`android/play-store-${theme}-512.png`, icon(theme), 512, true);
  const res = `android/native-${theme}/res`;
  await write(`${res}/drawable/ic_launcher_foreground.xml`, vector(theme));
  await write(`${res}/drawable/ic_launcher_monochrome.xml`, vector(theme, '#FFFFFF'));
  await write(`${res}/values/pimate_icon_colors.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="pimate_icon_background">${palettes[theme].background}</color></resources>\n`);
  for (const version of [26,33]) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/pimate_icon_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/>${version === 33 ? '<monochrome android:drawable="@drawable/ic_launcher_monochrome"/>' : ''}</adaptive-icon>\n`;
    await write(`${res}/mipmap-anydpi-v${version}/ic_launcher.xml`, xml);
    await write(`${res}/mipmap-anydpi-v${version}/ic_launcher_round.xml`, xml);
  }
  for (const [density, size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]) {
    await png(`${res}/mipmap-${density}/ic_launcher.png`, icon(theme, 'desktop'), size);
    await png(`${res}/mipmap-${density}/ic_launcher_round.png`, svg(`<defs><clipPath id="round"><circle cx="512" cy="512" r="460"/></clipPath></defs><g clip-path="url(#round)">${body(theme)}</g>`), size);
  }
}
await write('android/adaptive/monochrome.svg', icon('light', 'adaptive', '#FFFFFF'));
await png('android/adaptive/monochrome-1024.png', icon('light', 'adaptive', '#FFFFFF'), 1024);
for (const size of [24,36,48,72,96]) await png(`android/notification/notification-${size}.png`, icon('light', 'mark', '#FFFFFF'), size);

// Web: normal app icon and separately padded maskable icons.
for (const theme of ['light', 'dark']) {
  await write(`web/favicon-${theme}.svg`, icon(theme));
  for (const size of [16,32,48,180,192,512]) await png(`web/icon-${theme}-${size}.png`, icon(theme), size, true);
  for (const size of [192,512]) await png(`web/maskable-${theme}-${size}.png`, icon(theme, 'maskable'), size, true);
  await ico(`web/favicon-${theme}.ico`, theme, [16,32,48], 'app');
}
await write('web/site.webmanifest', json({ name:'PiMate', short_name:'PiMate', start_url:'./', display:'standalone', background_color:palettes.light.background, theme_color:palettes.light.background, icons:[
  ...[192,512].map((size)=>({src:`icon-light-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any'})),
  ...[192,512].map((size)=>({src:`maskable-light-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'maskable'}))
]}));
await write('web/head-snippet.html', '<!-- Serve this directory at /icons. Move the manifest to your app root and update its src paths before installing a PWA. -->\n<link rel="icon" href="/icons/favicon-light.ico" sizes="any">\n<link rel="icon" href="/icons/favicon-light.svg" type="image/svg+xml" media="(prefers-color-scheme: light)">\n<link rel="icon" href="/icons/favicon-dark.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)">\n<link rel="apple-touch-icon" href="/icons/icon-light-180.png">\n<!-- Add <link rel="manifest"> after configuring start_url, scope and icon paths. -->\n');

// Desktop: complete ICO/ICNS containers and transparent PNG exports.
for (const theme of ['light', 'dark']) {
  await ico(`desktop/windows/pimate-${theme}.ico`, theme, [16,24,32,48,64,128,256]);
  await icns(`desktop/macos/pimate-${theme}.icns`, theme);
  for (const size of [16,24,32,48,64,128,256,512,1024]) await png(`desktop/png/pimate-${theme}-${size}.png`, icon(theme, 'desktop'), size);
  for (const [point, scale] of [[16,1],[16,2],[32,1],[32,2],[128,1],[128,2],[256,1],[256,2],[512,1],[512,2]]) {
    await png(`desktop/macos/pimate-${theme}.iconset/icon_${point}x${point}${scale === 2 ? '@2x' : ''}.png`, icon(theme, 'desktop'), point * scale);
  }
}
for (const [tone,color] of [['black','#000000'],['white','#FFFFFF']]) {
  for (const size of [16,22,24,32,44,48]) await png(`desktop/tray/template-${tone}-${size}.png`, icon('light', 'mark', color), size);
}

// Review sheet: icon masks are preview-only; platform exports retain required geometry.
const preview = [];
const label = (x,y,text,size=18,color='#657080',weight=400) => `<text x="${x}" y="${y}" fill="${color}" font-family="DejaVu Sans,sans-serif" font-size="${size}" font-weight="${weight}">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text>`;
const box = (x,y,size,theme,shape='rounded') => {
  const id = `clip-${x}-${y}`;
  const mask = shape === 'circle' ? '<circle cx="512" cy="512" r="512"/>' : '<rect width="1024" height="1024" rx="224"/>';
  return `<g transform="translate(${x} ${y}) scale(${size / 1024})"><defs><clipPath id="${id}">${mask}</clipPath></defs><g clip-path="url(#${id})">${body(theme)}</g></g>`;
};
preview.push('<rect width="1440" height="1130" fill="#F8F8F5"/>', label(72,78,'PiMate',42,'#172338',700), label(72,113,'ICON KIT  /  01   ·   iOS, Android, web & desktop',17));
preview.push('<rect x="56" y="152" width="652" height="423" rx="28" fill="#ECE9E3"/>','<rect x="732" y="152" width="652" height="423" rx="28" fill="#0D1523"/>');
preview.push(box(270,190,224,'light'),box(946,190,224,'dark'),label(92,485,'LIGHT',15,'#657080',700),label(768,485,'DARK',15,'#B0BDD0',700));
for (const [theme,x] of [['light',92],['dark',768]]) {
  let i=0;
  for (const color of ['blue','coral','yellow','background']) {
    const c=palettes[theme][color];
    preview.push(`<rect x="${x+i*145}" y="510" width="26" height="26" rx="6" fill="${c}"/>`,label(x+36+i*145,529,c,12,theme==='light'?'#526071':'#B0BDD0')); i++;
  }
}
preview.push(label(72,632,'ADAPTIVE & TINTED',16,'#657080',700));
preview.push(box(72,665,132,'light','circle'),box(240,665,132,'dark','circle'),box(408,665,132,'tinted'),label(72,829,'Android light',15),label(240,829,'Android dark',15),label(408,829,'iOS tinted',15));
preview.push(`<g transform="translate(604 665) scale(${132/1024})">${body('light','mark','#172338')}</g>`,label(604,829,'Monochrome',15));
preview.push(label(824,632,'SMALL SIZES',16,'#657080',700));
for (const [i,size] of [16,24,32,48,64].entries()) {preview.push(box(824+i*105,705-size/2,size,'light'),label(824+i*105,780,`${size}px`,14));}
preview.push('<line x1="72" y1="880" x2="1368" y2="880" stroke="#DADDE0"/>',label(72,936,'ONE GEOMETRY. TWO PALETTES.',22,'#172338',700),label(72,978,'Editable SVG · Layered Android assets · AppIcon catalog · ICO / ICNS · Favicon / PWA',18),label(72,1020,'Rebuilt from the supplied Mt mark. Flat fills and a transparent central cutout.',17),label(72,1082,'PiMate  /  Asset handoff v1.0',14));
const sheet = svg(preview.join(''),1440,1130);
await write('preview.svg',sheet);
await write('preview.png',await sharp(Buffer.from(sheet)).png().toBuffer());
await write('manifest.json',json({name:'PiMate icon kit',version:'1.0.0',geometry: 'source/geometry.json',androidSafeCircle:{canvasDp:108,diameterDp:66,markWidthDp:48,maxVertexRadiusDp:Math.round(maxRadius*1000)/1000},files:records.slice()}));
console.log(`Generated ${records.length} files. Android maximum radius ${maxRadius.toFixed(3)} dp / 33 dp.`);
