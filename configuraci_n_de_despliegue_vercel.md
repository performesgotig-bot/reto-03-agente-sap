{
  "version": 2,
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/src/server.ts"
    },
    {
      "source": "/(.*)",
      "destination": "/web/$1"
    }
  ]
}