const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "uploads");
const FILES_DIR = path.join(ROOT, "files");
const CACHE_DIR = path.join(ROOT, "uploads", "cache");
const ZSIGN_PATH = path.join(ROOT, "zsign");
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

const IPA_LIST = {
  esign: {
    name: "ESign",
    url: "https://github.com/haduongyenn-ui/Sign-ipa/releases/download/khoindvn/ESign.ipa"
  },
  ksign: {
    name: "KSign",
    url: "https://github.com/haduongyenn-ui/Sign-ipa/releases/download/khoindvn/KSign.ipa"
  },
  gbox: {
    name: "GBox",
    url: "https://github.com/haduongyenn-ui/Sign-ipa/releases/download/khoindvn/GBox.ipa"
  },
  scarlet: {
    name: "Scarlet",
    url: "https://github.com/haduongyenn-ui/Sign-ipa/releases/download/khoindvn/Scarlet.ipa"
  }
};

const SHORT_MAP = {};

for (const dir of [UPLOAD_DIR, FILES_DIR, CACHE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(express.static("views"));
app.use("/files", express.static(FILES_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function cleanupFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function cleanupDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
}

function fileExistsAndValid(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function extractZip(zipPath, outDir) {
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: outDir }))
    .promise();
}

function findFile(dir, ext) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      const found = findFile(full, ext);
      if (found) return found;
    } else if (f.toLowerCase().endsWith(ext)) {
      return full;
    }
  }
  return null;
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadFile(res.headers.location, dest));
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Tải IPA thất bại. HTTP ${res.statusCode}`));
        }

        const file = fs.createWriteStream(dest);
        res.pipe(file);

        file.on("finish", () => {
          file.close(() => resolve(dest));
        });

        file.on("error", (err) => {
          cleanupFile(dest);
          reject(err);
        });
      }
    );

    request.on("error", (err) => {
      cleanupFile(dest);
      reject(err);
    });
  });
}

async function ensureCachedIpa(appKey, url) {
  const cachePath = path.join(CACHE_DIR, `${appKey}.ipa`);

  if (fileExistsAndValid(cachePath)) {
    console.log(`⚡ Cache OK: ${appKey}`);
    return cachePath;
  }

  console.log(`📥 Cache missing, downloading: ${appKey}`);
  cleanupFile(cachePath);
  await downloadFile(url, cachePath);

  if (!fileExistsAndValid(cachePath)) {
    throw new Error(`Tải IPA thất bại hoặc file rỗng: ${appKey}`);
  }

  console.log(`✅ Cached: ${appKey}`);
  return cachePath;
}

function getIpaMetadata(ipaPath) {
  const tempDir = path.join(
    UPLOAD_DIR,
    `ipa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    exec(
      `unzip -qq "${ipaPath}" -d "${tempDir}"`,
      { maxBuffer: 1024 * 1024 * 20 },
      (err) => {
        if (err) {
          cleanupDir(tempDir);
          return reject(new Error("unzip IPA lỗi"));
        }

        try {
          const payloadDir = path.join(tempDir, "Payload");
          if (!fs.existsSync(payloadDir)) {
            cleanupDir(tempDir);
            return reject(new Error("IPA không có Payload"));
          }

          const appFolder = fs.readdirSync(payloadDir).find((f) => f.endsWith(".app"));
          if (!appFolder) {
            cleanupDir(tempDir);
            return reject(new Error("Không tìm thấy .app trong IPA"));
          }

          const plistPath = path.join(payloadDir, appFolder, "Info.plist");
          const xmlPath = plistPath + ".xml";

          exec(
            `plistutil -i "${plistPath}" -o "${xmlPath}"`,
            { maxBuffer: 1024 * 1024 * 20 },
            (err2, stdout2, stderr2) => {
              if (err2) {
                cleanupDir(tempDir);
                return reject(new Error(stderr2 || stdout2 || "convert plist lỗi"));
              }

              let xml = "";
              try {
                xml = fs.readFileSync(xmlPath, "utf8");
              } catch {
                cleanupDir(tempDir);
                return reject(new Error("Không đọc được plist XML"));
              }

              const get = (key) => {
                const reg = new RegExp(
                  `<key>${key}</key>\\s*<string>([\\s\\S]*?)<\\/string>`
                );
                const m = xml.match(reg);
                return m ? m[1].trim() : null;
              };

              const metadata = {
                bundleId:
                  get("CFBundleIdentifier") ||
                  "unknown.bundle",
                version:
                  get("CFBundleShortVersionString") ||
                  get("CFBundleVersion") ||
                  "1.0",
                title:
                  get("CFBundleDisplayName") ||
                  get("CFBundleName") ||
                  "App"
              };

              cleanupDir(tempDir);
              resolve(metadata);
            }
          );
        } catch (e) {
          cleanupDir(tempDir);
          reject(e);
        }
      }
    );
  });
}

const upload = multer({ dest: UPLOAD_DIR });

app.get("/health", (req, res) => {
  const cacheStatus = {};

  for (const key of Object.keys(IPA_LIST)) {
    const cachePath = path.join(CACHE_DIR, `${key}.ipa`);
    cacheStatus[key] = fileExistsAndValid(cachePath);
  }

  res.json({
    ok: true,
    zsign_exists: fs.existsSync(ZSIGN_PATH),
    base_url: BASE_URL || null,
    cache: cacheStatus
  });
});

app.get("/apps", (req, res) => {
  res.json(IPA_LIST);
});

app.get("/cache-status", (req, res) => {
  const result = {};

  for (const [key] of Object.entries(IPA_LIST)) {
    const cachePath = path.join(CACHE_DIR, `${key}.ipa`);
    result[key] = {
      exists: fileExistsAndValid(cachePath),
      path: cachePath
    };
  }

  res.json(result);
});

app.get("/i/:id", (req, res) => {
  const id = req.params.id;
  const data = SHORT_MAP[id];

  if (!data || !data.plistUrl) {
    return res.status(404).send("Link hết hạn hoặc không tồn tại");
  }

  const itms = `itms-services://?action=download-manifest&url=${encodeURIComponent(data.plistUrl)}`;
  return res.redirect(itms);
});

app.post("/sign", upload.single("certzip"), async (req, res) => {
  let certDir = null;

  try {
    const zip = req.file;
    const password = req.body.p12pass;
    const appKey = (req.body.app || "").toLowerCase().trim();
    const selected = IPA_LIST[appKey];

    if (!BASE_URL) {
      return res.status(500).send("Thiếu BASE_URL");
    }

    if (!fs.existsSync(ZSIGN_PATH)) {
      return res.status(500).send("Không tìm thấy zsign");
    }

    if (!selected) {
      return res.status(400).send("App không hợp lệ");
    }

    if (!zip) {
      return res.status(400).send("Thiếu ZIP cert");
    }

    if (!password) {
      return res.status(400).send("Thiếu mật khẩu p12");
    }

    const cachedIpaPath = await ensureCachedIpa(appKey, selected.url);
    const meta = await getIpaMetadata(cachedIpaPath);

    certDir = path.join(UPLOAD_DIR, `cert_${Date.now()}`);
    fs.mkdirSync(certDir, { recursive: true });
    await extractZip(zip.path, certDir);

    const p12 = findFile(certDir, ".p12");
    const prov = findFile(certDir, ".mobileprovision");

    if (!p12) {
      cleanupFile(zip?.path);
      cleanupDir(certDir);
      return res.status(400).send("Không có file .p12");
    }

    if (!prov) {
      cleanupFile(zip?.path);
      cleanupDir(certDir);
      return res.status(400).send("Không có file .mobileprovision");
    }

    const outputName = `${appKey}_signed_${Date.now()}.ipa`;
    const outputPath = path.join(FILES_DIR, outputName);

    const cmd = `"${ZSIGN_PATH}" -k "${p12}" -p "${password}" -m "${prov}" -o "${outputPath}" "${cachedIpaPath}"`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      cleanupFile(zip?.path);
      cleanupDir(certDir);

      if (err) {
        return res.status(500).send(stderr || stdout || err.message);
      }

      if (!fs.existsSync(outputPath)) {
        return res.status(500).send("Sign xong nhưng không thấy file IPA");
      }

      const plistName = outputName.replace(".ipa", ".plist");
      const plistPath = path.join(FILES_DIR, plistName);

      const ipaUrl = `${BASE_URL}/files/${outputName}`;
      const plistUrl = `${BASE_URL}/files/${plistName}`;

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${escapeXml(ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${escapeXml(meta.bundleId)}</string>
        <key>bundle-version</key>
        <string>${escapeXml(meta.version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${escapeXml(meta.title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

      fs.writeFileSync(plistPath, plist);

      const shortId = Math.random().toString(36).substring(2, 8);

      SHORT_MAP[shortId] = {
        plistUrl,
        createdAt: Date.now()
      };

      const install = `${BASE_URL}/i/${shortId}`;

      setTimeout(() => {
        cleanupFile(outputPath);
        cleanupFile(plistPath);
        delete SHORT_MAP[shortId];
      }, 1000 * 60 * 30);

      return res.json({
        success: true,
        install,
        ipa: ipaUrl,
        plist: plistUrl,
        app: selected.name
      });
    });
  } catch (e) {
    cleanupFile(req.file?.path);
    cleanupDir(certDir);
    return res.status(500).send(e.toString());
  }
});

async function warmupCache() {
  await Promise.all(
    Object.entries(IPA_LIST).map(async ([key, item]) => {
      try {
        await ensureCachedIpa(key, item.url);
      } catch (e) {
        console.log(`Warmup failed for ${key}: ${e.message}`);
      }
    })
  );
}

app.listen(PORT, () => {
  console.log("Server running on " + PORT);
  warmupCache();
});
