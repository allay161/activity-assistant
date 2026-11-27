FROM ccr.ccs.tencentyun.com/library/node:18-alpine

WORKDIR /app

COPY scf/package*.json ./scf/

WORKDIR /app/scf
RUN npm install --production

COPY . .

EXPOSE 9000
CMD ["node", "index.js"]
