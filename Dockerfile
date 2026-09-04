FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Electron is a devDependency (desktop builds only) — skip its binary download in container builds
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/boot.js"]
