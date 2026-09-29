const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

function config() {
  const bucket = process.env.FASTBUG_OSS_BUCKET || 'zstt-test-tmp';
  let endpoint = String(process.env.FASTBUG_OSS_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (endpoint.startsWith(`${bucket}.`)) endpoint = endpoint.slice(bucket.length + 1);
  const accessKeyId = process.env.FASTBUG_OSS_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.FASTBUG_OSS_ACCESS_KEY_SECRET || '';
  const prefix = String(process.env.FASTBUG_OSS_PREFIX || 'fastbug').replace(/^\/+|\/+$/g, '');
  const missing = [];
  if (!endpoint) missing.push('FASTBUG_OSS_ENDPOINT');
  if (!accessKeyId) missing.push('FASTBUG_OSS_ACCESS_KEY_ID');
  if (!accessKeySecret) missing.push('FASTBUG_OSS_ACCESS_KEY_SECRET');
  if (missing.length) throw new Error(`OSS 配置缺失：${missing.join('、')}`);
  return { endpoint, accessKeyId, accessKeySecret, bucket, prefix };
}

function hmac(secret, text) { return crypto.createHmac('sha1', secret).update(text).digest('base64'); }
function encodedPath(key) { return '/' + key.split('/').map(encodeURIComponent).join('/'); }

function putObject({ endpoint, bucket, accessKeyId, accessKeySecret }, objectKey, file) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const contentType = 'application/zip';
    const resource = `/${bucket}/${objectKey}`;
    const signature = hmac(accessKeySecret, `PUT\n\n${contentType}\n${date}\n${resource}`);
    const request = https.request({
      hostname: `${bucket}.${endpoint}`,
      method: 'PUT',
      path: encodedPath(objectKey),
      headers: { Date: date, 'Content-Type': contentType, Authorization: `OSS ${accessKeyId}:${signature}`, 'Content-Length': fs.statSync(file).size }
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
      if (response.statusCode >= 200 && response.statusCode < 300) resolve();
      else {
        const code = responseBody.match(/<Code>([^<]+)<\/Code>/)?.[1];
        const message = responseBody.match(/<Message>([^<]+)<\/Message>/)?.[1];
        reject(new Error(`OSS 上传失败（HTTP ${response.statusCode}${code ? `，${code}` : ''}${message ? `：${message}` : ''}）`));
      }
      });
    });
    request.on('error', reject);
    fs.createReadStream(file).on('error', reject).pipe(request);
  });
}

function signedDownloadUrl({ endpoint, bucket, accessKeyId, accessKeySecret }, objectKey, expiresInSeconds = 7 * 24 * 60 * 60) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const resource = `/${bucket}/${objectKey}`;
  const signature = hmac(accessKeySecret, `GET\n\n\n${expires}\n${resource}`);
  return `https://${bucket}.${endpoint}${encodedPath(objectKey)}?OSSAccessKeyId=${encodeURIComponent(accessKeyId)}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
}

async function uploadEvidencePackage(captureDir, folder) {
  const oss = config();
  const temporaryDir = path.join(path.dirname(path.dirname(captureDir)), 'upload-temp');
  await fsp.mkdir(temporaryDir, { recursive: true });
  const archive = path.join(temporaryDir, `${folder}.zip`);
  await fsp.rm(archive, { force: true });
  await createZip(captureDir, archive);
  const objectKey = `${oss.prefix}/${folder}/evidence.zip`;
  await putObject(oss, objectKey, archive);
  const stat = await fsp.stat(archive);
  return {
    bucket: oss.bucket,
    objectKey,
    size: stat.size,
    downloadUrl: signedDownloadUrl(oss, objectKey),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };
}

// The Windows tar executable is optional and is not bundled with Electron.
// Build a standards-compliant ZIP with Node's built-in modules instead, so
// evidence upload works on every supported Windows installation.
async function createZip(sourceDir, destination) {
  const files = await listFiles(sourceDir);
  const archiveEntries = [];
  const directoryName = path.basename(sourceDir);
  let offset = 0;

  for (const file of files) {
    const source = await fsp.readFile(file.absolutePath);
    const compressed = zlib.deflateRawSync(source);
    const useCompression = compressed.length < source.length;
    const payload = useCompression ? compressed : source;
    const name = Buffer.from(`${directoryName}/${file.relativePath}`, 'utf8');
    const { date, time } = dosDateTime(file.mtimeMs);
    const crc = crc32(source);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(useCompression ? 8 : 0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    archiveEntries.push({ name, date, time, crc, sourceSize: source.length, payload, method: useCompression ? 8 : 0, offset });
    offset += localHeader.length + name.length + payload.length;
  }

  const chunks = [];
  for (const entry of archiveEntries) {
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(entry.method, 8);
    localHeader.writeUInt16LE(entry.time, 10);
    localHeader.writeUInt16LE(entry.date, 12);
    localHeader.writeUInt32LE(entry.crc, 14);
    localHeader.writeUInt32LE(entry.payload.length, 18);
    localHeader.writeUInt32LE(entry.sourceSize, 22);
    localHeader.writeUInt16LE(entry.name.length, 26);
    chunks.push(localHeader, entry.name, entry.payload);
  }

  const centralDirectoryOffset = offset;
  for (const entry of archiveEntries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(entry.time, 12);
    header.writeUInt16LE(entry.date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.payload.length, 20);
    header.writeUInt32LE(entry.sourceSize, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    chunks.push(header, entry.name);
    offset += header.length + entry.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(archiveEntries.length, 8);
  end.writeUInt16LE(archiveEntries.length, 10);
  end.writeUInt32LE(offset - centralDirectoryOffset, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);
  await fsp.writeFile(destination, Buffer.concat(chunks));
}

async function listFiles(root, relativePath = '') {
  const entries = await fsp.readdir(path.join(root, relativePath), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relative));
    } else if (entry.isFile()) {
      const stat = await fsp.stat(path.join(root, relative));
      files.push({ absolutePath: path.join(root, relative), relativePath: relative.split(path.sep).join('/'), mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}

function dosDateTime(timestamp) {
  const value = new Date(timestamp || Date.now());
  const year = Math.max(1980, value.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2)
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { uploadEvidencePackage };
