FROM registry.cn-hangzhou.aliyuncs.com/library/node:18-alpine

WORKDIR /app

COPY scf/package*.json ./scf/

WORKDIR /app/scf
RUN npm config set registry shturl.cc/4m4ErzsUpUAq2xlHtJ3T
RUN npm install --production

COPY . .

EXPOSE 9000
CMD ["node", "index.js"]
