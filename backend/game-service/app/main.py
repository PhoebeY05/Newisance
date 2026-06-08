from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import admin, battle, questions, sessions, share, shop
from storage import LOCAL_MEDIA_DIR

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
app.include_router(admin.router)
app.include_router(share.router)
app.include_router(shop.router)

# Serve admin-uploaded question images. Stored as media_url="media_uploads/<file>",
# fetchable through the Vite proxy as /api/game/media_uploads/<file>.
LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount('/media_uploads', StaticFiles(directory=str(LOCAL_MEDIA_DIR)), name='media')
