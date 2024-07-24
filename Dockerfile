# Dockerfile for Node.js App
FROM node:alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . ./

EXPOSE 7000

CMD ["node", "index.js"]
