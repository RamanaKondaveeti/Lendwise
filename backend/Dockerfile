FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db
USER node
EXPOSE 5000
CMD ["npm", "start"]
