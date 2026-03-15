const express = require('express');
const fileUpload = require('express-fileupload');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static('public'));
app.use(fileUpload({ 
    useTempFiles: true, 
    tempFileDir: '/tmp/',
    limits: { fileSize: 500 * 1024 * 1024 } // Giới hạn 500MB
}));

app.post('/sign', (req, res) => {
    if (!req.files || !req.files.ipa || !req.files.p12 || !req.files.prov) {
        return res.status(400).send('Vui lòng cung cấp đủ: IPA, P12, Provision.');
    }

    const sessionId = uuidv4();
    const workDir = path.join(__dirname, 'uploads', sessionId);
    fs.mkdirSync(workDir, { recursive: true });

    const ipaPath = path.join(workDir, 'original.ipa');
    const p12Path = path.join(workDir, 'cert.p12');
    const provPath = path.join(workDir, 'dev.mobileprovision');
    const outPath = path.join(workDir, 'signed.ipa');
    const password = req.body.password || '';

    // Di chuyển file vào thư mục xử lý
    req.files.ipa.mv(ipaPath, (err) => {
        req.files.p12.mv(p12Path, (err) => {
            req.files.prov.mv(provPath, (err) => {
                
                // Lệnh ký IPA
                const cmd = `zsign -k "${p12Path}" -p "${password}" -m "${provPath}" -o "${outPath}" "${ipaPath}"`;

                exec(cmd, (error, stdout, stderr) => {
                    console.log(stdout);
                    if (error) {
                        fs.rmSync(workDir, { recursive: true, force: true });
                        return res.status(500).send('Lỗi ký IPA: ' + stderr);
                    }

                    // Trả file và xóa ngay thư mục tạm
                    res.download(outPath, 'signed_by_gemini.ipa', () => {
                        try {
                            fs.rmSync(workDir, { recursive: true, force: true });
                            console.log(`Đã dọn dẹp phiên làm việc: ${sessionId}`);
                        } catch (e) { console.error(e); }
                    });
                });
            });
        });
    });
});

app.listen(PORT, () => console.log(`Hệ thống sẵn sàng tại port ${PORT}`));
