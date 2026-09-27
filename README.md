# Heimdell Forms Gateway

Private Node.js service for processing forms from the Greenfix Exterior Care and RemoteAbility websites.

## Security properties

- Binds to localhost and is intended to sit behind Nginx.
- Accepts only allowlisted form origins and known routes.
- Enforces a 64 KiB body limit, honeypot handling and IP rate limits.
- Does not store submissions on disk or include submitted values in logs.
- Keeps the Resend API key server-side.
- Returns success only after the email provider accepts the message.

## Required environment variables

See `.env.example`. Never commit real values.

## Checks

```sh
npm test
```

## Health endpoint

`GET /health` returns only `{"status":"ok"}`.
