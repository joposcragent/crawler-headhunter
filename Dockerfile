FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Reuse browsers pre-installed in base image instead of downloading them
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 8080

CMD ["node", "dist/index.js"]
