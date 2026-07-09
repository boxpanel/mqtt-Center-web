FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY client/package.json ./client/

RUN npm install && npm run build --prefix client 2>/dev/null || true

COPY . .

RUN npm install --prefix client && npm run build --prefix client

RUN mkdir -p data

EXPOSE 8088

ENV PORT=8088
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
