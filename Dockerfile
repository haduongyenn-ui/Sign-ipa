FROM ubuntu:22.04

# Chống hỏi múi giờ và các xác nhận khi cài đặt
ENV DEBIAN_FRONTEND=noninteractive

# 1. Cài đặt công cụ build, OpenSSL 3.0, libzip và Node.js
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    libssl-dev \
    libzip-dev \
    curl \
    zip \
    unzip \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# 2. Build zSign (Đã hỗ trợ OpenSSL 3.0 và đầy đủ header)
RUN git clone https://github.com/zhlynn/zsign.git && \
    cd zsign && \
    g++ $(find . -name "*.cpp") \
    -I./src \
    -I./common \
    -I./src/common \
    -I. \
    -lcrypto -lzip -O3 -o zsign && \
    mv zsign /usr/local/bin/ && \
    cd .. && rm -rf zsign

# 3. Thiết lập thư mục làm việc
WORKDIR /app

# 4. Copy và cài đặt Node dependencies
COPY package*.json ./
RUN npm install

# 5. Copy toàn bộ mã nguồn
COPY . .

# 6. Tạo thư mục lưu trữ tạm và phân quyền
RUN mkdir -p uploads && chmod 777 uploads

# 7. Port mặc định của Render
EXPOSE 10000

# 8. Khởi chạy server
CMD ["node", "server.js"]
