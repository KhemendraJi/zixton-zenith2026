# CivicSense

CivicSense is a hackathon-ready civic issue reporting and operations dashboard. Citizens submit problems with an optional location and photo; the backend provides category and priority suggestions. Administrators can review, filter, route, and update each report.

## Stack

- React + Vite
- Tailwind CSS
- Express API
- JSON file datastore (`server/data/complaints.json`) and local image uploads (`server/uploads/`)

This backend was intentionally selected for speed: it needs no account, database provisioning, or connection string, making it ideal for a 10-hour demo. Replace the JSON store with Supabase/Firebase/MongoDB before a production deployment.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The API runs on `http://localhost:5000`; Vite forwards `/api` and `/uploads` requests automatically.

Run `npm run dev` from the project root and keep that terminal open while using the app. It starts both the frontend and API. The API creates `server/data/` and `server/uploads/` automatically; complaint data and uploaded photos are local to each clone and are not shared through GitHub.

## Useful commands

```bash
npm run build   # create a production frontend bundle in dist/
npm start       # run only the backend API
```

## API

- `GET /api/health` — basic health check
- `GET /api/complaints` — list complaints
- `POST /api/complaints` — submit a complaint (multipart, accepts up to three `photos`)
- `PATCH /api/complaints/:id` — save administrative review fields

## Demo notes

The automatic categorisation and priority score are transparent keyword heuristics intended for demonstration. The dashboard currently has no authentication; add role-based authentication, durable managed storage, file scanning, and stricter validation before production use.
