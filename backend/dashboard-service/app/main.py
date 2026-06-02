from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import dashboard

app = FastAPI(title='dashboard-service')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Routes are mounted bare (e.g. /trending); the frontend's Vite proxy supplies
# (and strips) the /api/dashboard namespace.
app.include_router(dashboard.router)


@app.get('/health')
async def health():
    return {'status': 'ok', 'service': 'dashboard-service'}
