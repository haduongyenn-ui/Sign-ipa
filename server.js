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

// 🔥 FIX BASE_URL (auto bỏ dấu / cuối)
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

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
// 🔍 Find file
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
// 🔥 READ IPA METADATA
// =====================
function getIpaMetadata(ipaPath) {
  const tempDir = path.join(UPLOAD_DIR, `ipa_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    exec(`unzip -qq "${ipaPath}" -d "${tempDir}"`, (err) => {
      if (err) return reject("❌ unzip IPA lỗi");

      try {
        const payload = path.join(tempDir, "Payload");
        const appFolder = fs.readdirSync(payload).find(f => f.endsWith(".app"));

        if (!appFolder) return reject("❌ Không tìm thấy .app");

        const plistPath = path.join(payload, appFolder, "Info.plist");
        const xmlPath = plistPath + ".xml";

        exec(`plistutil -i "${plistPath}" -o "${xmlPath}"`, (err2, stdout, stderr) => {
          if (err2) {
            console.log(stderr);
            return reject("❌ convert plist lỗi");
          }

          const xml = fs.readFileSync(xmlPath, "utf8");

          const get = (key) => {
            const reg = new RegExp(`<key>${key}</key>\\s*<string>(.*?)<\\/string>`);
            const m = xml.match(reg);
            return m ? m[1] : null;
          };

          resolve({
            bundleId: get("CFBundleIdentifier") || "unknown.bundle",
            version: get("CFBundleShortVersionString") || get("CFBundleVersion") || "1.0",
            title: get("CFBundleDisplayName") || get("CFBundleName") || "App"
          });
        });

      } catch (e) {
        reject("❌ đọc plist lỗi");
      }
    });
  });
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
    const ipa = req.files?.ipa?.[0];
    const zip = req.files?.certzip?.[0];
    const password = req.body.p12pass;

    if (!ipa) return res.send("❌ Thiếu IPA");
    if (!zip) return res.send("❌ Thiếu ZIP cert");
    if (!password) return res.send("❌ Thiếu mật khẩu p12");

    const ipaPath = ipa.path;
    const zipPath = zip.path;

    // 🔥 đọc metadata
    const meta = await getIpaMetadata(ipaPath);

    // extract cert
    const certDir = path.join(UPLOAD_DIR, `cert_${Date.now()}`);
    fs.mkdirSync(certDir);

    await extractZip(zipPath, certDir);

    const p12 = findFile(certDir, ".p12");
    const prov = findFile(certDir, ".mobileprovision");

    if (!p12) return res.send("❌ Không có file .p12");
    if (!prov) return res.send("❌ Không có file .mobileprovision");

    const outputName = `signed_${Date.now()}.ipa`;
    const outputPath = path.join(FILES_DIR, outputName);

    console.log("👉 SIGN:", outputName);

    const cmd = `"${ZSIGN_PATH}" -k "${p12}" -p "${password}" -m "${prov}" -o "${outputPath}" "${ipaPath}"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.log(stderr);
        console.log(stdout);
        return res.send(stderr || stdout || err.message);
      }

      // 🔥 check file tồn tại
      if (!fs.existsSync(outputPath)) {
        return res.send("❌ Sign xong nhưng không thấy file IPA");
      }

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

      // 🔥 KHÔNG xoá ngay → delay 10 phút
      setTimeout(() => {
        try {
          fs.unlinkSync(outputPath);
          fs.unlinkSync(plistPath);
        } catch {}
      }, 1000 * 60 * 10);

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
    res.send(e.toString());
  }
});

app.listen(PORT, () => {
  console.log("🚀 Server running");
});
