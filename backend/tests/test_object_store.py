"""Storage boundaries use real Fernet bytes and local SDK-shaped streams.

No external bucket is contacted; these are not provider integration tests.
"""

import io

import pytest
from cryptography.fernet import InvalidToken

from backend import object_store
from backend.config import Settings


class MemoryBucket:
    def __init__(self):
        self.objects = {}
        self.body = None
        self.fail_read = False

    def put_object(self, **kwargs):
        self.objects[kwargs["Key"]] = kwargs["Body"]

    def get_object(self, **kwargs):
        class Stream(io.BytesIO):
            def read(stream, size=-1):
                if self.fail_read:
                    raise OSError("Synthetic object transport failure")
                return super().read(size)

        payload = self.objects[kwargs["Key"]]
        self.body = Stream(payload)
        return {"Body": self.body, "ContentLength": len(payload)}


@pytest.fixture
def store(tmp_path, monkeypatch):
    # Scale the production 50 MiB cap down to keep boundary tests lightweight.
    monkeypatch.setattr(object_store, "MAX_UPLOAD", 1024)
    return object_store.ObjectStore(Settings(data_dir=tmp_path))


@pytest.mark.parametrize("size", [1, 900, 1024])
def test_encrypted_s3_roundtrip_accounts_for_fernet_overhead(store, size):
    bucket = MemoryBucket()
    store.s3 = bucket
    payload = b"a" * size
    store.put("originals/boundary.enc", payload, encrypt=True)
    assert bucket.objects["originals/boundary.enc"] != payload
    assert store.get("originals/boundary.enc", decrypt=True) == payload
    assert bucket.body.closed, "S3 response streams must be released after reads."


def test_s3_stream_is_closed_even_when_the_transport_fails(store):
    bucket = MemoryBucket()
    store.s3 = bucket
    store.put("originals/read-error.enc", b"a", encrypt=True)
    bucket.fail_read = True
    with pytest.raises(OSError, match="transport failure"):
        store.get("originals/read-error.enc", decrypt=True)
    assert bucket.body.closed


@pytest.mark.parametrize("remote", [False, True])
def test_object_store_rejects_oversized_writes_before_persisting(store, remote):
    bucket = MemoryBucket()
    if remote:
        store.s3 = bucket
    with pytest.raises(ValueError, match="limit"):
        store.put("originals/too-large.enc", b"a" * 1025, encrypt=True)
    assert not bucket.objects
    assert not (store.root / "originals/too-large.enc").exists()


@pytest.mark.parametrize("remote", [False, True])
def test_oversized_or_replaced_stored_objects_are_bounded_on_read(store, remote):
    key = "originals/replaced.enc"
    if remote:
        bucket = MemoryBucket()
        bucket.objects[key] = b"a" * 2000
        store.s3 = bucket
    else:
        path = store._path(key)
        path.parent.mkdir(parents=True)
        path.write_bytes(b"a" * 2000)
    with pytest.raises(ValueError, match="limit"):
        store.get(key, decrypt=True)
    if remote:
        assert bucket.body.closed


@pytest.mark.parametrize("remote", [False, True])
def test_valid_but_oversized_plaintext_is_rejected_after_decryption(store, remote):
    key = "originals/oversized-plaintext.enc"
    payload = store.cipher.encrypt(b"a" * 1025)
    if remote:
        bucket = MemoryBucket()
        bucket.objects[key] = payload
        store.s3 = bucket
    else:
        path = store._path(key)
        path.parent.mkdir(parents=True)
        path.write_bytes(payload)
    with pytest.raises(ValueError, match="limit"):
        store.get(key, decrypt=True)
    if remote:
        assert bucket.body.closed


def test_corrupted_encrypted_object_is_not_returned_as_plaintext(store):
    store.put("originals/corrupt.enc", b"test payload", encrypt=True)
    path = store._path("originals/corrupt.enc")
    raw = bytearray(path.read_bytes())
    raw[len(raw) // 2] ^= 1
    path.write_bytes(bytes(raw))
    with pytest.raises(InvalidToken):
        store.get("originals/corrupt.enc", decrypt=True)
