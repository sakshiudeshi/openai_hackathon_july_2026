FROM node:24-alpine

WORKDIR /app
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev"]
