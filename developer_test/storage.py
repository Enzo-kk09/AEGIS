import logging
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from .rules import MAX_REFERENCES
from .enrollment import compare_references


LOGGER = logging.getLogger("aegis.storage")


class ProfileConflict(ValueError):
    pass


class StorageError(RuntimeError):
    pass


def normalize_embedding(value):
    embedding = np.asarray(value, dtype=np.float32).reshape(-1)
    if embedding.size != 128 or not np.isfinite(embedding).all():
        raise ValueError("O modelo retornou um vetor facial inválido.")
    length = float(np.linalg.norm(embedding.astype(np.float64)))
    if not np.isfinite(length) or length < 1e-8:
        raise ValueError("O modelo retornou um vetor facial vazio.")
    return np.ascontiguousarray(embedding.astype(np.float64) / length, dtype=np.float32)


class ProfileStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._snapshot_cache = None
        self._snapshot_revision = None
        self._profiles_cache = None
        self._data_version = None
        self._database = sqlite3.connect(self.path, timeout=10, check_same_thread=False)
        self._database.row_factory = sqlite3.Row
        self._database.execute("PRAGMA foreign_keys = ON")
        self._database.execute("PRAGMA secure_delete = ON")
        self._database.execute("PRAGMA journal_mode = DELETE")
        with self._connection() as connection:
            connection.executescript(
                "CREATE TABLE IF NOT EXISTS profiles ("
                "id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, "
                "created_at TEXT NOT NULL);"
                "CREATE TABLE IF NOT EXISTS embeddings ("
                "profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, "
                "vector BLOB NOT NULL CHECK(length(vector) = 512));"
                "CREATE INDEX IF NOT EXISTS embedding_profile ON embeddings(profile_id);"
            )

    @contextmanager
    def _connection(self):
        with self._lock:
            if self._database is None:
                raise StorageError("O banco de perfis está indisponível. Reinicie o serviço.")
            try:
                with self._database:
                    yield self._database
            except sqlite3.Error as error:
                LOGGER.error("Falha na operação de perfis (%s).", type(error).__name__)
                raise StorageError("Não foi possível acessar os perfis. Verifique o banco local e reinicie o serviço.") from None

    def _refresh_cache(self, connection):
        version = connection.execute("PRAGMA data_version").fetchone()[0]
        if version != self._data_version:
            self._invalidate_cache()
            self._data_version = version

    def _invalidate_cache(self):
        self._snapshot_cache = None
        self._snapshot_revision = None
        self._profiles_cache = None

    def close(self):
        with self._lock:
            if self._database is not None:
                self._database.close()
                self._database = None
                self._invalidate_cache()

    def __del__(self):
        database = getattr(self, "_database", None)
        if database is not None:
            database.close()

    @staticmethod
    def _read_vector(blob):
        try:
            return normalize_embedding(np.frombuffer(blob, dtype="<f4"))
        except (ValueError, TypeError):
            LOGGER.error("O banco contém um vetor facial inválido.")
            raise StorageError("Um perfil contém dados inválidos. Remova esse cadastro e envie as imagens novamente.") from None

    def list_profiles(self):
        with self._lock, self._connection() as connection:
            self._refresh_cache(connection)
            if self._profiles_cache is not None:
                return [profile.copy() for profile in self._profiles_cache]
            rows = connection.execute(
                "SELECT p.id, p.name, p.created_at, COUNT(e.profile_id) AS samples "
                "FROM profiles p LEFT JOIN embeddings e ON e.profile_id = p.id "
                "GROUP BY p.id ORDER BY p.created_at, p.id"
            ).fetchall()
            self._profiles_cache = [dict(row) for row in rows]
            return [profile.copy() for profile in self._profiles_cache]

    def snapshot(self):
        with self._lock, self._connection() as connection:
            self._refresh_cache(connection)
            if self._snapshot_cache is not None:
                profiles, matrix, owners = self._snapshot_cache
                return [profile.copy() for profile in profiles], matrix, owners
            rows = connection.execute(
                "SELECT p.id, p.name, e.vector FROM embeddings e "
                "JOIN profiles p ON p.id = e.profile_id ORDER BY p.id"
            ).fetchall()
            profiles = []
            indices = {}
            vectors = []
            owners = []
            for row in rows:
                if row["id"] not in indices:
                    indices[row["id"]] = len(profiles)
                    profiles.append({"id": row["id"], "name": row["name"]})
                vectors.append(self._read_vector(row["vector"]))
                owners.append(indices[row["id"]])
            matrix = np.stack(vectors) if vectors else np.empty((0, 128), dtype=np.float32)
            owners = np.asarray(owners, dtype=np.int32)
            matrix.setflags(write=False)
            owners.setflags(write=False)
            self._snapshot_cache = profiles, matrix, owners
            # An opaque label identifies a snapshot, without hashing biometric
            # vectors or exporting persistent profile identifiers.
            self._snapshot_revision = secrets.token_hex(8)
            return [profile.copy() for profile in profiles], matrix, owners

    def snapshot_with_revision(self):
        with self._lock:
            snapshot=self.snapshot()
            return snapshot,self._snapshot_revision

    def add_profile(self, name, embeddings):
        name = " ".join(name.split())
        if not name or len(name) > 80 or any(ord(character) < 32 for character in name):
            raise ValueError("Informe um nome entre 1 e 80 caracteres.")
        if not 1 <= len(embeddings) <= MAX_REFERENCES:
            raise ValueError(f"Envie entre 1 e {MAX_REFERENCES} imagens por cadastro.")
        vectors = np.stack([normalize_embedding(value) for value in embeddings])
        if not compare_references(vectors)['consistency']['passed']:
            raise ProfileConflict("As imagens não parecem pertencer à mesma pessoa. Use fotos nítidas do mesmo rosto.")
        with self._lock, self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM profiles WHERE name_key = ?", (name.casefold(),)).fetchone():
                raise ProfileConflict("Já existe um perfil com esse nome.")
            existing = connection.execute("SELECT vector FROM embeddings").fetchall()
            if existing:
                known = np.stack([self._read_vector(row["vector"]) for row in existing])
                if compare_references(vectors,known)['gallery']['similar_to_existing']:
                    raise ProfileConflict("Esse rosto é semelhante a um perfil já cadastrado. Remova o cadastro anterior para refazê-lo.")
            profile = {
                "id": uuid.uuid4().hex,
                "name": name,
                "samples": len(vectors),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            connection.execute(
                "INSERT INTO profiles(id, name, name_key, created_at) VALUES (?, ?, ?, ?)",
                (profile["id"], name, name.casefold(), profile["created_at"]),
            )
            connection.executemany(
                "INSERT INTO embeddings(profile_id, vector) VALUES (?, ?)",
                [(profile["id"], vector.astype("<f4").tobytes()) for vector in vectors],
            )
            self._invalidate_cache()
            return profile

    def delete_profile(self, profile_id):
        with self._lock, self._connection() as connection:
            deleted = connection.execute("DELETE FROM profiles WHERE id = ?", (profile_id,)).rowcount > 0
            if deleted:
                self._invalidate_cache()
            return deleted
