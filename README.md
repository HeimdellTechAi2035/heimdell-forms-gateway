# Heimdell Forms Gateway

Private Node.js service for processing forms from the Greenfix Exterior Care and RemoteAbility websites.

## Security properties

- Binds to localhost and is intended to sit behind Nginx.
- Accepts only allowlisted form origins and known routes.
- Enforces a 64 KiB body limit, honeypot handling and IP rate limits.
- Does not store submissions on disk or include submitted values in logs.
- Keeps the Resend API key server-side.
- Returns success only after the email provider accepts the message.

In the Nginx location that proxies to the gateway on loopback, set
`proxy_set_header X-Forwarded-For $remote_addr;` or append the verified socket
peer with `$proxy_add_x_forwarded_for`. The gateway uses the final address
sent by Nginx. Keep the Node listener bound to loopback.

## Required environment variables

See `.env.example`. Never commit real values.

## Checks

```sh
npm test
```

## Health endpoint

`GET /health` returns only `{"status":"ok"}`.
