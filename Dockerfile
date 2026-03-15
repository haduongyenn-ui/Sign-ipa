FROM ubuntu:20.04

# Chống hỏi múi giờ khi cài đặt
ENV DEBIAN_FRONTEND=noninteractive

# Cài đặt các công cụ build, OpenSSL và Node.js
RUN apt-get update && apt-get install -y \
    git build-essential libssl-dev curl zip unzip nodejs npm

# Build zSign (Sửa lỗi đường dẫn file .cpp)
RUN git clone https://github.com/zhlynn/zsign.git && \
    cd zsign && \
    g++ *.cpp common/*.cpp -lcrypto -O3 -o zsign && \
    mv zsign /usr/local/bin/ && \
    cd .. && rm -rf zsign

WORKDIR /app

# Copy khai báo thư viện và cài đặt
COPY package*.json ./
RUN npm install

# Copy toàn bộ mã nguồn
COPY . .

# Tạo thư mục chứa file tạm
RUN mkdir -p uploads

EXPOSE 10000
CMD ["node", "server.js"]
