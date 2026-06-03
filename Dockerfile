FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git \
    g++ \
    make \
    pkg-config \
    libssl-dev \
    libminizip-dev \
    unzip \
    zip \
    libplist-utils \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

RUN git clone https://github.com/zhlynn/zsign.git zsign-src && \
    cd zsign-src/build/linux && \
    make clean && make && \
    cp ../../bin/zsign /app/zsign && \
    chmod +x /app/zsign

EXPOSE 3000

CMD ["node", "server.js"]
