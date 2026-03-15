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
const VIEWS_DIR = path.join(ROOT, "views");
const ZSIGN_PATH = path.join(ROOT, "zsign");
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

for (const dir of [UPLOAD_DIR, FILES_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error("unlink error:", e.message);
  }
}

function safeRemoveDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("rm dir error:", e.message);
  }
}

function findFileRecursive(dir, matcher) {
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      const found = findFileRecursive(fullPath, matcher);
      if (found) return found;
    } else if (matcher(item.name)) {
      return fullPath;
    }
  }

  return null;
}

async function extractZip(zipPath, outDir) {
  await fs
    .createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: outDir }))
    .promise();
}

function xmlDecode(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractPlistValue(plistText, keyName) {
  const escapedKey = keyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<key>${escapedKey}</key>\\s*<(string|integer|real)>([\\s\\S]*?)<\\/\\1>`, "i");
  const match = plistText.match(regex);
  if (!match) return null;
  return xmlDecode(match[2].trim());
}

function getIpaMetadata(ipaPath) {
  const tempDir = path.join(UPLOAD_DIR, `ipa_extract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const unzipCmd = `unzip -qq "${ipaPath}" -d "${tempDir}"`;

    exec(unzipCmd, { maxBuffer: 1024 * 1024 * 20 }, (err) => {
      try {
        if (err) {
          safeRemoveDir(tempDir);
          return reject(new Error("Không giải nén được IPA."));
        }

        const payloadDir = path.join(tempDir, "Payload");
        if (!fs.existsSync(payloadDir)) {
          safeRemoveDir(tempDir);
          return reject(new Error("IPA không có thư mục Payload."));
        }

        const apps = fs.readdirSync(payloadDir).filter((name) => name.endsWith(".app"));
        if (!apps.length) {
          safeRemoveDir(tempDir);
          return reject(new Error("Không tìm thấy app trong IPA."));
        }

        const infoPlistPath = path.join(payloadDir, apps[0], "Info.plist");
        if (!fs.existsSync(infoPlistPath)) {
          safeRemoveDir(tempDir);
          return reject(new Error("Không tìm thấy Info.plist trong IPA."));
        }

        let plistText = "";
        try {
          plistText = fs.readFileSync(infoPlistPath, "utf8");
        } catch (readErr) {
          safeRemoveDir(tempDir);
          return reject(new Error("Không đọc được Info.plist dạng XML."));
        }

        const bundleId =
          extractPlistValue(plistText, "CFBundleIdentifier") || "com.example.app";
        const version =
          extractPlistValue(plistText, "CFBundleShortVersionString") ||
          extractPlistValue(plistText, "CFBundleVersion") ||
          "1.0";
        const title =
          extractPlistValue(plistText, "CFBundleDisplayName") ||
          extractPlistValue(plistText, "CFBundleName") ||
          "Signed App";

        safeRemoveDir(tempDir);
        return resolve({ bundleId, version, title });
      } catch (e) {
        safeRemoveDir(tempDir);
        return reject(e);
      }
    });
  });
}

function makePlist({ ipaUrl, bundleId, version, title }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
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
          <string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${bundleId}</string>
        <key>bundle-version</key>
        <string>${version}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${title}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const cleanName = (file.originalname || "file")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${cleanName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024
  }
});

app.use(express.static(VIEWS_DIR));
app.use("/files", express.static(FILES_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    zsign_exists: fs.existsSync(ZSIGN_PATH),
    base_url: BASE_URL || null
  });
});

app.post(
  "/sign",
  upload.fields([
    { name: "ipa", maxCount: 1 },
    { name: "certzip", maxCount: 1 }
  ]),
  async (req, res) => {
    let ipaPath = null;
    let zipPath = null;
    let tempCertDir = null;

    try {
      if (!BASE_URL) {
        return res.status(500).json({
          success: false,
          error: "Thiếu biến môi trường BASE_URL."
        });
      }

      if (!fs.existsSync(ZSIGN_PATH)) {
        return res.status(500).json({
          success: false,
          error: "Thiếu zsign. Kiểm tra build Render."
        });
      }

      const ipaFile = req.files?.ipa?.[0];
      const zipFile = req.files?.certzip?.[0];
      const p12Password = req.body?.p12pass || "";

      if (!ipaFile) {
        return res.status(400).json({ success: false, error: "Thiếu file IPA." });
      }

      if (!zipFile) {
        return res.status(400).json({
          success: false,
          error: "Thiếu file ZIP chứa p12 và mobileprovision."
        });
      }

      if (!p12Password) {
        return res.status(400).json({
          success: false,
          error: "Thiếu mật khẩu p12."
        });
      }

      ipaPath = ipaFile.path;
      zipPath = zipFile.path;

      const ipaMeta = await getIpaMetadata(ipaPath);

      tempCertDir = path.join(UPLOAD_DIR, `cert_${Date.now()}`);
      fs.mkdirSync(tempCertDir, { recursive: true });

      await extractZip(zipPath, tempCertDir);

      const p12Path = findFileRecursive(tempCertDir, (name) =>
        name.toLowerCase().endsWith(".p12")
      );

      const mobileProvisionPath = findFileRecursive(tempCertDir, (name) =>
        name.toLowerCase().endsWith(".mobileprovision")
      );

      if (!p12Path) {
        safeUnlink(ipaPath);
        safeUnlink(zipPath);
        safeRemoveDir(tempCertDir);
        return res.status(400).json({
          success: false,
          error: "Không tìm thấy file .p12 trong ZIP."
        });
      }

      if (!mobileProvisionPath) {
        safeUnlink(ipaPath);
        safeUnlink(zipPath);
        safeRemoveDir(tempCertDir);
        return res.status(400).json({
          success: false,
          error: "Không tìm thấy file .mobileprovision trong ZIP."
        });
      }

      const outputBase = `signed_${Date.now()}`;
      const outputIpaName = `${outputBase}.ipa`;
      const outputPlistName = `${outputBase}.plist`;
      const outputIpaPath = path.join(FILES_DIR, outputIpaName);
      const outputPlistPath = path.join(FILES_DIR, outputPlistName);

      const cmd =
        `"${ZSIGN_PATH}" ` +
        `-k "${p12Path}" ` +
        `-p "${p12Password.replace(/"/g, '\\"')}" ` +
        `-m "${mobileProvisionPath}" ` +
        `-o "${outputIpaPath}" ` +
        `"${ipaPath}"`;

      exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
        safeUnlink(ipaPath);
        safeUnlink(zipPath);
        safeRemoveDir(tempCertDir);

        if (err) {
          console.error("zsign failed:", stderr || stdout || err.message);
          return res.status(500).json({
            success: false,
            error: "Sign lỗi. Kiểm tra lại p12, mật khẩu và mobileprovision."
          });
        }

        const ipaUrl = `${BASE_URL}/files/${outputIpaName}`;
        const plistUrl = `${BASE_URL}/files/${outputPlistName}`;
        const installUrl =
          `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;

        const plistContent = makePlist({
          ipaUrl,
          bundleId: ipaMeta.bundleId,
          version: ipaMeta.version,
          title: ipaMeta.title
        });

        fs.writeFileSync(outputPlistPath, plistContent);

        return res.json({
          success: true,
          ipa: ipaUrl,
          plist: plistUrl,
          install: installUrl,
          metadata: ipaMeta
        });
      });
    } catch (e) {
      console.error("server error:", e);
      safeUnlink(ipaPath);
      safeUnlink(zipPath);
      safeRemoveDir(tempCertDir);

      return res.status(500).json({
        success: false,
        error: "Lỗi xử lý file, phân tích IPA hoặc giải nén ZIP."
      });
    }
  }
);

app.use((err, req, res, next) => {
  console.error("middleware error:", err);
  return res.status(400).json({
    success: false,
    error: err.message || "Request lỗi."
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
