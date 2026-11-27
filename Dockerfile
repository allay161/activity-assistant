# CloudBase 云托管（Express 容器）构建文件
# 参考腾讯云官方 Node.js 快速开始：使用官方镜像 + 国内 npm 源 + 东八区时区

FROM node:22-alpine

# 设置东八区时区，避免飞书活动日期出现 8 小时偏差
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo Asia/Shanghai > /etc/timezone

ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=9000

WORKDIR /app

COPY scf/package*.json ./scf/

WORKDIR /app/scf
RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ && \
    npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

WORKDIR /app
COPY . .

EXPOSE 9000

CMD ["node", "scf/index.js"]
