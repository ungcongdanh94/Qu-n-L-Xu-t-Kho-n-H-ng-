FROM node:20-bookworm-slim

WORKDIR /app

# Cai cong cu build vi better-sqlite3 can compile native module.
# --fix-missing + apt-get update lai truoc khi thu lai giup tang do on dinh neu gap loi mang/kho
# goi tam thoi (thay vi build that bai ngay lan dau).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    || (apt-get update && apt-get install -y --fix-missing --no-install-recommends python3 make g++) \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p storage/uploads storage/data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
