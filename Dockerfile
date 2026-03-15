FROM ubuntu:20.04

# Chống hỏi múi giờ khi cài đặt
ENV DEBIAN_FRONTEND=noninteractive

# Cài đặt các công cụ build và Node.js
RUN apt-get update && apt-get install -y \
    git build-essential libssl-dev curl zip unzip nodejs npm

# Build zSign từ nguồn chính thức
RUN git clone https://github.com/zhlynn/zsign.git \
    && cd zsign && g++ *.cpp -lcrypto -O3 -o zsign \
    && mv zsign /usr/local/bin/

WORKDIR /app

# Copy và cài đặt thư viện
COPY package*.json ./
RUN npm install

# Copy toàn bộ code vào container
COPY . .

# Tạo thư mục tạm để xử lý file
RUN mkdir -p uploads

EXPOSE 10000
CMD ["node", "server.js"]
