import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.cfg import config as cfg


def create_app() -> FastAPI:
    app = FastAPI(
        title="Power Interview AI - Admin",
        description="Local admin dashboard API. Reads/writes the same MongoDB database as backend.",
        debug=cfg.DEBUG,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run("app.main:app", reload=cfg.DEBUG, host=cfg.HOST, port=cfg.PORT)
