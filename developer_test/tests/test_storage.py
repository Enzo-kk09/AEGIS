import sqlite3

import numpy as np
import pytest

from developer_test.storage import ProfileConflict, ProfileStore, StorageError, normalize_embedding


def vector(axis=0):
    value = np.zeros(128, dtype=np.float32)
    value[axis] = 1
    return value


def test_profiles_persist_only_embeddings_and_delete_cascades(tmp_path):
    path = tmp_path / "profiles.sqlite3"
    store = ProfileStore(path)
    first = store.add_profile("  Enzo  Teste ", [vector(), vector()])
    second = store.add_profile("Outra Pessoa", [vector(1)])
    expected_profiles = {first["id"]: first, second["id"]: second}
    assert {profile["id"]: profile for profile in store.list_profiles()} == expected_profiles
    profiles, embeddings, owners = store.snapshot()
    assert len(profiles) == 2
    assert embeddings.shape == (3, 128)
    assert np.allclose(np.linalg.norm(embeddings, axis=1), 1)
    assert sorted(owners.tolist()) in ([0, 0, 1], [0, 1, 1])
    assert first["name"] == "Enzo Teste"
    assert {profile["id"]: profile for profile in ProfileStore(path).list_profiles()} == expected_profiles
    assert store.delete_profile(first["id"])
    assert not store.delete_profile(first["id"])
    assert len(store.snapshot()[1]) == 1
    with sqlite3.connect(path) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {"profiles", "embeddings"}
        assert connection.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0] == 1


def test_duplicate_name_duplicate_face_and_mixed_enrollment_are_atomic(tmp_path):
    store = ProfileStore(tmp_path / "profiles.sqlite3")
    store.add_profile("Enzo", [vector()])
    for name, values in [("eNzO", [vector(1)]), ("Outra identidade", [vector()]), ("Mistura", [vector(1), vector(2)])]:
        with pytest.raises(ProfileConflict):
            store.add_profile(name, values)
    assert len(store.list_profiles()) == 1
    assert len(store.snapshot()[1]) == 1


def test_deletion_erases_embedding_bytes_from_database(tmp_path):
    store = ProfileStore(tmp_path / "profiles.sqlite3")
    value = normalize_embedding(np.random.default_rng(42).normal(size=128))
    profile = store.add_profile("Teste", [value])
    stored = normalize_embedding(value).astype("<f4").tobytes()
    assert stored in store.path.read_bytes()
    store.delete_profile(profile["id"])
    assert stored not in store.path.read_bytes()


@pytest.mark.parametrize("value", [np.zeros(128), np.ones(127), np.full(128, np.nan), np.full(128, np.inf)])
def test_invalid_embeddings_rejected(value):
    with pytest.raises(ValueError):
        normalize_embedding(value)


@pytest.mark.parametrize("name", ["", " " * 5, "x" * 81])
def test_invalid_names_rejected(tmp_path, name):
    store = ProfileStore(tmp_path / "profiles.sqlite3")
    with pytest.raises(ValueError):
        store.add_profile(name, [vector()])
    assert store.list_profiles() == []


def test_snapshot_reuses_matrix_and_invalidates_on_local_and_external_changes(tmp_path):
    store = ProfileStore(tmp_path / "profiles.sqlite3")
    first = store.add_profile("Primeiro", [vector()])
    initial = store.snapshot()
    second = store.snapshot()
    assert initial[1] is second[1]
    assert initial[2] is second[2]
    second[0][0]["name"] = "Alterado pelo consumidor"
    assert store.snapshot()[0][0]["name"] == "Primeiro"
    with pytest.raises(ValueError):
        initial[1][0, 0] = 2
    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE profiles SET name = ? WHERE id = ?", ("Alterado no banco", first["id"]))
    assert store.snapshot()[0][0]["name"] == "Alterado no banco"
    assert store.list_profiles()[0]["name"] == "Alterado no banco"
    assert store.snapshot()[1] is not initial[1]
    store.delete_profile(first["id"])
    assert store.snapshot()[1].shape == (0, 128)
    assert store.list_profiles() == []
    store.close()


def test_corrupt_embedding_has_safe_error_and_profile_can_be_deleted(tmp_path):
    store = ProfileStore(tmp_path / "profiles.sqlite3")
    profile = store.add_profile("Teste", [vector()])
    store.snapshot()
    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE embeddings SET vector = ?", (np.full(128, np.nan, dtype=np.float32).tobytes(),))
    with pytest.raises(StorageError, match="dados inválidos"):
        store.snapshot()
    assert len(store.list_profiles()) == 1
    assert store.delete_profile(profile["id"])
    assert store.snapshot()[0] == []
    store.close()


def test_large_finite_embedding_is_normalized_without_float32_overflow():
    value = normalize_embedding(np.full(128, 1e38, dtype=np.float32))
    assert np.isfinite(value).all()
    assert float(np.linalg.norm(value.astype(np.float64))) == pytest.approx(1)


def test_closed_store_returns_domain_error(tmp_path):
    store = ProfileStore(tmp_path / "profiles.sqlite3")
    store.close()
    store.close()
    with pytest.raises(StorageError, match="indisponível"):
        store.list_profiles()
