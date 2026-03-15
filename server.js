const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "uploads");
const FILES_DIR = path.join(ROOT, "files");
const ZSIGN_PATH = path.join(ROOT, "zsign");
const BASE_URL = process.env.BASE_URL;

for (const dir of [UPLOAD_DIR, FILES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(express.static("views"));
app.use("/files", express.static(FILES_DIR));
app.use(express.urlencoded({ extended: true }));

// =====================
// 📦 Extract ZIP
// =====================
async function extractZip(zipPath, outDir) {
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: outDir }))
    .promise();
}

// =====================
// 🔍 Read IPA metadata (FIX CHUẨN)
// =====================
function getIpaMetadata(ipaPath) {
  const tempDir = path.join(UPLOAD_DIR, `ipa_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    exec(`unzip -qq "${ipaPath}" -d "${tempDir}"`, (err) => {
      if (err) return reject("Giải nén IPA lỗi");

      try {
        const payload = path.join(tempDir, "Payload");
        const appFolder = fs.readdirSync(payload).find(f => f.endsWith(".app"));

        const plistPath = path.join(payload, appFolder, "Info.plist");
        const xmlPath = plistPath + ".xml";

        // 🔥 convert binary → XML
        exec(`plutil -convert xml1 "${plistPath}" -o "${xmlPath}"`, (err2) => {
          if (err2) return reject("Convert plist lỗi");

          const xml = fs.readFileSync(xmlPath, "utf8");

          const get = (key) => {
            const regex = new RegExp(`<key>${key}</key>\\s*<string>(.*?)<\\/string>`);
            const match = xml.match(regex);
            return match ? match[1] : null;
          };

          const bundleId = get("CFBundleIdentifier");
          const version = get("CFBundleShortVersionString") || get("CFBundleVersion");
          const name = get("CFBundleDisplayName") || get("CFBundleName");

          resolve({
            bundleId: bundleId || "com.example.app",
            version: version || "1.0",
            title: name || "Signed App"
          });
        });
      } catch (e) {
        reject("Lỗi đọc Info.plist");
      }
    });
  });
}

// =====================
// 🔍 Find file trong ZIP
// =====================
function findFile(dir, ext) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      const res = findFile(full, ext);
      if (res) return res;
    } else if (f.toLowerCase().endsWith(ext)) {
      return full;
    }
  }
  return null;
}

// =====================
// 🚀 SIGN API
// =====================
const upload = multer({ dest: UPLOAD_DIR });

app.post("/sign", upload.fields([
  { name: "ipa" },
  { name: "certzip" }
]), async (req, res) => {

  try {
    const ipaPath = req.files.ipa[0].path;
    const zipPath = req.files.certzip[0].path;
    const password = req.body.p12pass;

    // 🔥 đọc metadata IPA
    const meta = await getIpaMetadata(ipaPath);

    // extract cert
    const certDir = path.join(UPLOAD_DIR, `cert_${Date.now()}`);
    fs.mkdirSync(certDir);
    await extractZip(zipPath, certDir);

    const p12 = findFile(certDir, ".p12");
    const prov = findFile(certDir, ".mobileprovision");

    if (!p12 || !prov) {
      return res.send("Thiếu cert hoặc provision");
    }

    const outputName = `signed_${Date.now()}.ipa`;
    const outputPath = path.join(FILES_DIR, outputName);

    const cmd = `"${ZSIGN_PATH}" -k "${p12}" -p "${password}" -m "${prov}" -o "${outputPath}" "${ipaPath}"`;

    exec(cmd, (err) => {
      if (err) return res.send("Sign lỗi");

      // tạo plist chuẩn
      const plistName = outputName.replace(".ipa", ".plist");
      const plistPath = path.join(FILES_DIR, plistName);

      const ipaUrl = `${BASE_URL}/files/${outputName}`;
      const plistUrl = `${BASE_URL}/files/${plistName}`;

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN">
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
<string>${ipaUrl}</string>
</dict>
</array>
<key>metadata</key>
<dict>
<key>bundle-identifier</key>
<string>${meta.bundleId}</string>
<key>bundle-version</key>
<string>${meta.version}</string>
<key>kind</key>
<string>software</string>
<key>title</key>
<string>${meta.title}</string>
</dict>
</dict>
</array>
</dict>
</plist>`;

      fs.writeFileSync(plistPath, plist);

      const install = `itms-services://?action=download-manifest&url=${plistUrl}`;

      res.json({
        success: true,
        install,
        ipa: ipaUrl,
        plist: plistUrl,
        metadata: meta
      });
    });

  } catch (e) {
    console.log(e);
    res.send("Lỗi server");
  }
});

app.listen(PORT, () => {
  console.log("Server chạy");
});
