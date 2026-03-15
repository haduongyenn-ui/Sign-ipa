const express = require('express');
const fileUpload = require('express-fileupload');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static('public')); // Để chạy giao diện HTML
app.use(fileUpload({ useTempFiles: true, tempFileDir: '/tmp/' }));

app.post('/sign', (req, res) => {
    if (!req.files || !req.files.ipa || !req.files.p12 || !req.files.prov) {
        return res.status(400).send('Vui lòng tải lên đầy đủ các file (IPA, P12, Provision).');
    }

    const sessionId = uuidv4();
    const workDir = path.join(__dirname, 'uploads', sessionId);
    fs.mkdirSync(workDir, { recursive: true });

    const ipaPath = path.join(workDir, 'original.ipa');
    const p12Path = path.join(workDir, 'cert.p12');
    const provPath = path.join(workDir, 'dev.mobileprovision');
    const outPath = path.join(workDir, 'signed.ipa');
    const password = req.body.password || '';

    // Di chuyển file vào thư mục làm việc
    Promise.all([
        req.files.ipa.mv(ipaPath),
        req.files.p12.mv(p12Path),
        req.files.prov.mv(provPath)
    ]).then(() => {
        // Lệnh ký bằng zSign
        const cmd = `zsign -k "${p12Path}" -p "${password}" -m "${provPath}" -o "${outPath}" "${ipaPath}"`;

        exec(cmd, (err, stdout, stderr) => {
            console.log(stdout);
            if (err) {
                console.error(stderr);
                return res.status(500).send('Lỗi trong quá trình ký IPA.');
            }

            // Trả file về và xóa thư mục tạm sau khi tải xong
            res.download(outPath, 'signed_app.ipa', () => {
                fs.rmSync(workDir, { recursive: true, force: true });
            });
        });
    }).catch(err => res.status(500).send(err.message));
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
