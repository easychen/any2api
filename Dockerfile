# 使用 Node.js 16 作为基础镜像
FROM node:16

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json 到工作目录
COPY api/package*.json ./

# 安装依赖
RUN npm install

# 复制应用程序代码到工作目录
COPY api .

# 暴露9000端口
EXPOSE 9000

# 运行应用程序
CMD [ "node", "/app/app.js" ]