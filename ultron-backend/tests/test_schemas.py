from __future__ import annotations

import pytest
from pydantic import ValidationError

from ultron_backend.schemas import ChatTurn


def test_chat_turn_accepts_bounded_supported_image_data_urls():
    payload = ChatTurn(
        message="Describe this image",
        attachments=[{"name": "cat.png", "data_url": "data:image/png;base64,YQ=="}],
    )
    assert payload.attachments[0].name == "cat.png"
    assert payload.attachments[0].data_url.endswith("YQ==")


@pytest.mark.parametrize(
    "data_url",
    [
        "https://example.com/cat.png",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,not-valid-base64!",
        "data:image/png;base64,",
    ],
)
def test_chat_turn_rejects_unsafe_or_invalid_image_data_urls(data_url):
    with pytest.raises(ValidationError):
        ChatTurn(message="Describe this image", attachments=[{"name": "cat", "data_url": data_url}])


def test_chat_turn_rejects_more_than_five_images():
    image = {"name": "cat.png", "data_url": "data:image/png;base64,YQ=="}
    with pytest.raises(ValidationError):
        ChatTurn(message="Describe these", attachments=[image] * 6)
