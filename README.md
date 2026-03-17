# MongoDB Admin Panel (FastAPI + fastapi-mongo-admin)

A minimal FastAPI project that exposes a MongoDB admin UI using [`fastapi-mongo-admin`](https://pypi.org/project/fastapi-mongo-admin/).

## 🚀 Quick Start

1. Create a `.env` file (or set env vars) with your MongoDB connection:

```env
MONGO_URI=mongodb://localhost:27017
MONGO_DB=admin
```

2. Activate the virtual environment:

```powershell
.\.venv\Scripts\Activate.ps1
```

3. Run the app:

```powershell
uvicorn main:app --reload
```

4. Open the admin UI:

- API endpoints: `http://localhost:8000/admin`
- UI: `http://localhost:8000/admin-ui`

## 🧰 Tooling

- ✅ Linting: `ruff check .`
- ✅ Type checking: `mypy .`

## 🧩 Notes

- This project uses `loguru` for request logging.
- `fastapi-mongo-admin` supports auto-discovering Pydantic models; see `fastapi_mongo_admin.mount_admin_app` docs.

---

**Tip:** For production, add authentication (e.g., `require_auth=True`) and protect the admin UI.
