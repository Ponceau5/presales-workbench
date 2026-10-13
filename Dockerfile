FROM node:22-alpine AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.12-slim AS backend
WORKDIR /app
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY public/overseas-cost-template.xlsx ./public/overseas-cost-template.xlsx
COPY src/lib/f7CostTemplateSchema.json ./src/lib/f7CostTemplateSchema.json
ENV PRESALES_DATA_DIR=/data PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000
CMD ["uvicorn","app:app","--app-dir","server","--host","0.0.0.0","--port","8000","--no-access-log"]

FROM nginx:stable-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /build/dist /usr/share/nginx/html
