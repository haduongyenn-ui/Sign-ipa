FROM node:22-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git \
    clang \
    make \
    libssl-dev \
    zlib1g-dev \
    unzip \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

RUN git clone https://github.com/zhlynn/zsign.git zsign-src && \
    cd zsign-src && \
    make && \
    cp zsign /app/zsign && \
    chmod +x /app/zsign

EXPOSE 3000

CMD ["node", "server.js"]
