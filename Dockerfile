FROM python:3.12-alpine

WORKDIR /app

COPY index.html /app/site/index.html
COPY app.js /app/site/app.js
COPY styles.css /app/site/styles.css
COPY screenshot1.jpg /app/site/screenshot1.jpg
COPY server.py /app/server.py

ENV SITE_DIR=/app/site
ENV MAP_PATH=/data/ros/map.json
ENV HOST=0.0.0.0
ENV PORT=8090

EXPOSE 8090

CMD ["python", "/app/server.py"]
