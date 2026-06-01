from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import battle, questions, sessions

app = FastAPI(title='game-service')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/health')
async def health():
    return {'status': 'ok', 'service': 'game-service'}


# Routes are mounted bare (e.g. /questions/random, /sessions); the frontend's
# Vite proxy supplies the /api/game namespace, matching the community-service
# convention.
app.include_router(questions.router)
app.include_router(sessions.router)
app.include_router(battle.router)
