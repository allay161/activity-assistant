# 使用官方 Node.js 18 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 把项目所有文件复制进去
COPY . .

# 进入 scf 目录安装依赖
WORKDIR /app/scf
RUN npm install --production

# 回到根目录
WORKDIR /app

# 暴露 9000 端口（对应你的 Express 代码）
EXPOSE 9000

# 启动你的后端服务
CMD ["node", "scf/index.js"]