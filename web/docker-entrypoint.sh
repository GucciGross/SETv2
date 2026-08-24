#!/bin/sh
# Optional TLS (SET_TLS=1): mobile browsers only allow microphone access on
# secure origins, so phones on the LAN need https for voice input. Generates a
# self-signed cert unless real ones are mounted at /etc/nginx/certs/.
set -e

if [ "$SET_TLS" != "1" ]; then
    exit 0
fi

mkdir -p /etc/nginx/certs
if [ ! -f /etc/nginx/certs/set.crt ] || [ ! -f /etc/nginx/certs/set.key ]; then
    echo "[set-tls] generating self-signed certificate (mount /etc/nginx/certs/set.{crt,key} to use your own)"
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -keyout /etc/nginx/certs/set.key \
        -out /etc/nginx/certs/set.crt \
        -subj "/CN=set.local" \
        -addext "subjectAltName=DNS:set.local,DNS:localhost,IP:127.0.0.1"
fi

cp /etc/nginx/nginx-tls.conf /etc/nginx/conf.d/default.conf
echo "[set-tls] HTTPS enabled — open https://<host>:<port> (accept the self-signed warning once)"
