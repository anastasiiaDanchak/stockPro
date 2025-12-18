# Етап збірки та встановлення залежностей
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Фінальний мінімальний образ
FROM node:20-alpine
WORKDIR /app

# Копіюємо лише необхідні файли з етапу build
COPY --from=build /app /app

EXPOSE 3000
CMD ["node", "index.js"]