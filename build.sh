#!/usr/bin/env bash
set -e

apt-get update
apt-get install -y git clang make libssl-dev zlib1g-dev unzip

if [ ! -d zsign-src ]; then
  git clone https://github.com/zhlynn/zsign.git zsign-src
fi

cd zsign-src
make
cp zsign ../zsign
cd ..
chmod +x zsign
