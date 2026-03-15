FROM ubuntu:20.04

# Chống hỏi múi giờ và các xác nhận khi cài đặt
ENV DEBIAN_FRONTEND=noninteractive

# 1. Cài đặt các công cụ build, thư viện mã hóa OpenSSL và Node.js
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    libssl-dev \
    curl \
    zip \
    unzip \
    nodejs \
    npm

# 2. Build zSign (Sửa lỗi thiếu file Header .h bằng cách chỉ định Include Path)
RUN git clone https://github.com/zhlynn/zsign.git && \
    cd zsign && \
    g++ $(find . -name "*.cpp") \
    -I./src \
    -I./common \
    -I./src/common \
    -I. \
    -lcrypto -O3 -o zsign && \
    mv zsign /usr/local/bin/ && \
    cd .. && rm -rf zsign

# 3. Thiết lập thư mục làm việc cho ứng dụng Node.js
WORKDIR /app

# 4. Copy file cấu hình thư viện và cài đặt dependencies
COPY package*.json ./
RUN npm install

# 5. Copy toàn bộ mã nguồn vào trong container
COPY . .

# 6. Tạo thư mục 'uploads' để lưu trữ IPA và phân quyền
RUN mkdir -p uploads && chmod 777 uploads

# 7. Port mặc định cho Render Web Service
EXPOSE 10000

# 8. Lệnh khởi chạy server
CMD ["node", "server.js"]
