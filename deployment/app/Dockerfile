FROM python:3.9

# RUN apt-get update && apt-get install -y iputils-ping

RUN mkdir /app
WORKDIR /app

COPY deployment/app /app

RUN pip install --no-cache-dir -r requirements.txt

RUN pip install websockets>=10.0

